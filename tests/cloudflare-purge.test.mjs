import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PURGE_HOSTS, purgeCache } from '../scripts/cloudflare-purge.mjs';

// Nunca se llama a la API real: fetch y sleep se inyectan siempre.
const ZONE_ID = '0123456789abcdef0123456789abcdef';
const TOKEN = 'tok-secreto-de-prueba-XYZ';
const ENV = { CLOUDFLARE_ZONE_ID: ZONE_ID, CLOUDFLARE_API_TOKEN: TOKEN };
const URL_OK = `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`;

const json = (status, body, headers = {}) => () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const OK = json(200, { success: true, errors: [], messages: [], result: { id: ZONE_ID } });

// fetch simulado: cada llamada consume la siguiente respuesta de la lista.
function mockFetch(...responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses[Math.min(calls.length, responses.length) - 1];
    return next(init);
  };
  return { fetch, calls };
}

function run(responses, overrides = {}) {
  const { fetch, calls } = mockFetch(...responses);
  const sleeps = [];
  const logs = [];
  const promise = purgeCache({
    env: ENV,
    fetch,
    sleep: async (ms) => { sleeps.push(ms); },
    log: (line) => logs.push(line),
    ...overrides,
  });
  return { promise, calls, sleeps, logs };
}

const noSecrets = (text) => {
  assert.ok(!text.includes(TOKEN), `el token aparece en: ${text}`);
};

test('purga solo alexgar.tech y www.alexgar.tech', () => {
  assert.deepEqual(PURGE_HOSTS, ['alexgar.tech', 'www.alexgar.tech']);
  assert.ok(Object.isFrozen(PURGE_HOSTS));
});

test('éxito: POST exacto a purge_cache con hosts y token Bearer', async () => {
  const r = run([OK]);
  const result = await r.promise;
  assert.equal(r.calls.length, 1);
  const [{ url, init }] = r.calls;
  assert.equal(url, URL_OK);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), { hosts: ['alexgar.tech', 'www.alexgar.tech'] });
  assert.ok(!init.body.includes('purge_everything'));
  assert.ok(init.signal instanceof AbortSignal, 'cada petición lleva un signal de timeout');
  assert.equal(result.attempts, 1);
  assert.equal(r.sleeps.length, 0);
  const out = r.logs.join('\n');
  assert.match(out, /aceptada/i);
  assert.match(out, /no garantiza/i);
  noSecrets(out);
});

for (const [name, env] of [
  ['falta CLOUDFLARE_ZONE_ID', { CLOUDFLARE_API_TOKEN: TOKEN }],
  ['CLOUDFLARE_ZONE_ID vacío', { ...ENV, CLOUDFLARE_ZONE_ID: '' }],
  ['falta CLOUDFLARE_API_TOKEN', { CLOUDFLARE_ZONE_ID: ZONE_ID }],
  ['CLOUDFLARE_API_TOKEN vacío', { ...ENV, CLOUDFLARE_API_TOKEN: '' }],
  ['token con salto de línea', { ...ENV, CLOUDFLARE_API_TOKEN: `${TOKEN}\n` }],
]) {
  test(`configuración: ${name} falla sin llamar a la API`, async () => {
    const r = run([OK], { env });
    await assert.rejects(r.promise, (err) => {
      assert.match(err.message, /CLOUDFLARE_(ZONE_ID|API_TOKEN)/);
      noSecrets(err.message);
      return true;
    });
    assert.equal(r.calls.length, 0);
  });
}

for (const bad of [
  '0123456789abcdef0123456789abcde', // 31
  '0123456789abcdef0123456789abcdef0', // 33
  '0123456789ABCDEF0123456789ABCDEF', // mayúsculas
  '0123456789abcdef0123456789abcdeg',
  ` ${ZONE_ID}`,
  `${ZONE_ID}\n`,
  '../../accounts/0123456789abcdef01',
]) {
  test(`configuración: rechaza zone ID inválido ${JSON.stringify(bad)}`, async () => {
    const r = run([OK], { env: { ...ENV, CLOUDFLARE_ZONE_ID: bad } });
    await assert.rejects(r.promise, /CLOUDFLARE_ZONE_ID.*32/);
    assert.equal(r.calls.length, 0);
  });
}

test('HTTP 200 con success:false falla sin reintentar y sin volcar el cuerpo', async () => {
  const body = { success: false, errors: [{ code: 1234, message: 'detalle-interno' }], messages: [] };
  const r = run([json(200, body)]);
  await assert.rejects(r.promise, (err) => {
    assert.match(err.message, /success/);
    assert.match(err.message, /1234/);
    assert.ok(!err.message.includes('detalle-interno'), 'no debe volcar el cuerpo');
    return true;
  });
  assert.equal(r.calls.length, 1);
  assert.ok(!r.logs.join('\n').includes('detalle-interno'));
});

test('success debe ser exactamente true', async () => {
  const r = run([json(200, { success: 'true' })]);
  await assert.rejects(r.promise, /success/);
  assert.equal(r.calls.length, 1);
});

test('JSON inválido falla sin reintentar y sin volcar el cuerpo', async () => {
  const r = run([json(200, '<html>no-es-json</html>')]);
  await assert.rejects(r.promise, (err) => {
    assert.match(err.message, /JSON/);
    assert.ok(!err.message.includes('no-es-json'));
    return true;
  });
  assert.equal(r.calls.length, 1);
});

for (const status of [400, 401, 403, 404]) {
  test(`HTTP ${status} falla sin reintentar`, async () => {
    const r = run([json(status, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }), OK]);
    await assert.rejects(r.promise, (err) => {
      assert.match(err.message, new RegExp(`HTTP ${status}`));
      noSecrets(err.message);
      return true;
    });
    assert.equal(r.calls.length, 1);
    assert.equal(r.sleeps.length, 0);
  });
}

for (const status of [429, 500, 502, 503]) {
  test(`HTTP ${status} es transitorio: reintenta y acaba aceptada`, async () => {
    const r = run([json(status, { success: false }), OK]);
    const result = await r.promise;
    assert.equal(result.attempts, 2);
    assert.equal(r.calls.length, 2);
    assert.equal(r.sleeps.length, 1);
  });
}

test('reintentos acotados: 503 persistente agota los intentos con backoff creciente', async () => {
  const r = run([json(503, 'Service Unavailable')], { maxAttempts: 3, baseDelayMs: 100 });
  await assert.rejects(r.promise, /3 intentos.*HTTP 503/);
  assert.equal(r.calls.length, 3);
  assert.deepEqual(r.sleeps, [100, 200]);
});

test('429 respeta Retry-After pero con tope', async () => {
  const r = run([json(429, {}, { 'retry-after': '7' }), json(429, {}, { 'retry-after': '99999' }), OK], {
    maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 10_000,
  });
  await r.promise;
  assert.deepEqual(r.sleeps, [7000, 10_000]);
});

test('error de red: reintenta y agota sin filtrar el token', async () => {
  const r = run([() => { throw new TypeError(`fetch failed ${TOKEN}`); }], { maxAttempts: 3 });
  await assert.rejects(r.promise, (err) => {
    assert.match(err.message, /3 intentos/);
    noSecrets(err.message);
    return true;
  });
  assert.equal(r.calls.length, 3);
  noSecrets(r.logs.join('\n'));
});

test('timeout: aborta peticiones colgadas aunque fetch ignore el signal', async () => {
  const hang = () => new Promise(() => {});
  const r = run([hang], { maxAttempts: 2, timeoutMs: 20 });
  const started = Date.now();
  await assert.rejects(r.promise, /2 intentos.*tiempo/);
  assert.ok(Date.now() - started < 2000);
  assert.equal(r.calls.length, 2);
  for (const { init } of r.calls) assert.ok(init.signal.aborted);
});

test('timeout: también acota la lectura del cuerpo', async () => {
  const slowBody = () => ({ ok: true, status: 200, headers: new Headers(), text: () => new Promise(() => {}) });
  const r = run([slowBody, OK], { timeoutMs: 20 });
  const result = await r.promise;
  assert.equal(result.attempts, 2);
});

test('rechaza parámetros de reintento no acotados', async () => {
  for (const opts of [{ maxAttempts: 0 }, { maxAttempts: 11 }, { timeoutMs: 0 }, { timeoutMs: Infinity }]) {
    await assert.rejects(run([OK], opts).promise, RangeError);
  }
});

// ── CLI: se ejecuta el script real con fetch sustituido por --import ───────

const script = fileURLToPath(new URL('../scripts/cloudflare-purge.mjs', import.meta.url));

function cli(env, mockSource) {
  const dir = mkdtempSync(join(tmpdir(), 'cf-purge-'));
  const args = [];
  if (mockSource) {
    const mock = join(dir, 'mock.mjs');
    writeFileSync(mock, mockSource);
    args.push('--import', mock);
  } else {
    // Sin mock explícito, cualquier intento de red hace fallar la prueba.
    const guard = join(dir, 'guard.mjs');
    writeFileSync(guard, 'globalThis.fetch = () => { console.log("RED-NO-PERMITIDA"); process.exit(99); };');
    args.push('--import', guard);
  }
  const res = spawnSync(process.execPath, [...args, script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });
  return { ...res, out: res.stdout + res.stderr };
}

test('CLI: sin configuración sale con 1 y ::error:: antes de tocar la red', () => {
  const r = cli({});
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /::error::.*CLOUDFLARE_ZONE_ID/);
  assert.ok(!r.out.includes('RED-NO-PERMITIDA'));
});

test('CLI: zone ID inválido sale con 1 sin tocar la red', () => {
  const r = cli({ ...ENV, CLOUDFLARE_ZONE_ID: 'no-es-un-id' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /::error::.*CLOUDFLARE_ZONE_ID/);
  noSecrets(r.out);
});

test('CLI: éxito con fetch simulado sale con 0', () => {
  const mock = `globalThis.fetch = async (url, init) => {
    if (url !== ${JSON.stringify(URL_OK)}) process.exit(98);
    if (init.body !== JSON.stringify({ hosts: ['alexgar.tech', 'www.alexgar.tech'] })) process.exit(97);
    return new Response('{"success":true,"errors":[],"messages":[],"result":{"id":"x"}}', { status: 200 });
  };`;
  const r = cli(ENV, mock);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /aceptada/i);
  noSecrets(r.out);
});

test('CLI: 403 sale con 1 y ::error:: sin el token', () => {
  const mock = `globalThis.fetch = async () => new Response('{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}', { status: 403 });`;
  const r = cli(ENV, mock);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /::error::.*HTTP 403/);
  noSecrets(r.out);
});
