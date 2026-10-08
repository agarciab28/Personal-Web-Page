import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// DEPLOY_WORKFLOW permite ejecutar las pruebas contra otra versión del workflow
// (por ejemplo, la anterior al arreglo) para demostrar que fallan.
const workflowPath =
  process.env.DEPLOY_WORKFLOW ??
  fileURLToPath(new URL('../.github/workflows/deploy.yml', import.meta.url));
const workflow = readFileSync(workflowPath, 'utf8');

const indentOf = (line) => line.match(/^ */)[0].length;
const isBlank = (line) => /^\s*(#.*)?$/.test(line);
const scalar = (value) =>
  value.replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');

// Parser mínimo para la lista `steps:` de este workflow (sin dependencias).
function parseSteps(src) {
  const lines = src.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s+steps:\s*$/.test(l));
  assert.ok(start >= 0, 'el workflow no tiene "steps:"');
  const stepsIndent = indentOf(lines[start]);

  const chunks = [];
  for (const line of lines.slice(start + 1)) {
    if (!isBlank(line) && indentOf(line) <= stepsIndent) break;
    if (/^\s*- /.test(line) && indentOf(line) === stepsIndent + 2) {
      chunks.push([line.replace('- ', '  ')]);
    } else if (chunks.length) {
      chunks.at(-1).push(line);
    }
  }

  return chunks.map((chunk) => {
    const keyIndent = indentOf(chunk[0]);
    const step = { with: {}, env: {} };
    for (let i = 0; i < chunk.length; i++) {
      const line = chunk[i];
      if (isBlank(line) || indentOf(line) !== keyIndent) continue;
      const [, key, rest] = line.trim().match(/^([\w-]+):\s*(.*)$/);
      const body = [];
      while (i + 1 < chunk.length && (chunk[i + 1].trim() === '' || indentOf(chunk[i + 1]) > keyIndent)) {
        body.push(chunk[++i]);
      }
      if (key === 'run' && /^\|/.test(rest)) {
        const content = body.filter((l) => l.trim() !== '');
        const pad = Math.min(...content.map(indentOf));
        step.run = body.map((l) => l.slice(pad)).join('\n').trimEnd() + '\n';
      } else if (key === 'run') {
        step.run = scalar(rest) + '\n';
      } else if (key === 'with' || key === 'env') {
        for (const l of body) {
          if (isBlank(l)) continue;
          const [, k, v] = l.trim().match(/^([\w-]+):\s*(.*)$/);
          step[key][k] = scalar(v);
        }
      } else {
        step[key] = scalar(rest);
      }
    }
    return step;
  });
}

const steps = parseSteps(workflow);
const usesSsh = (step) => /\b(ssh|ssh-keyscan|rsync)\b/.test(step.run ?? '');
const tailscaleIndex = () => steps.findIndex((s) => /^tailscale\/github-action@/.test(s.uses ?? ''));

test('conecta el runner a la tailnet antes de cualquier operación SSH', () => {
  const firstSsh = steps.findIndex(usesSsh);
  assert.ok(firstSsh >= 0, 'no hay paso que use ssh/rsync');
  const ts = tailscaleIndex();
  assert.ok(ts >= 0, 'no existe paso tailscale/github-action: el runner público no alcanza el SSH privado');
  assert.ok(ts < firstSsh, 'el paso de Tailscale debe ejecutarse antes del primer ssh/ssh-keyscan/rsync');
});

// ── Estructura del workflow ────────────────────────────────────────────────

const stepNamed = (name) => {
  const step = steps.find((s) => s.name === name);
  assert.ok(step, `falta el paso "${name}"`);
  return step;
};

test('usa la acción oficial de Tailscale fijada por SHA con OIDC y tag propio', () => {
  const step = steps[tailscaleIndex()];
  assert.equal(step.uses, 'tailscale/github-action@d1b6cd204f8dceda5b3eaad7f1f767be390056cd');
  assert.deepEqual(step.with, {
    'oauth-client-id': '${{ vars.TS_CLIENT_ID }}',
    audience: '${{ vars.TS_AUDIENCE }}',
    tags: 'tag:personal-web-deploy',
    ping: '${{ vars.SSH_TAILSCALE_HOST }}',
  });
});

test('el job pide solo contents: read e id-token: write', () => {
  const block = workflow.match(/^ {4}permissions:\n((?: {6}.*\n)+)/m)?.[1] ?? '';
  const perms = Object.fromEntries(block.trim().split('\n').map((l) => l.trim().split(/:\s*/)));
  assert.deepEqual(perms, { contents: 'read', 'id-token': 'write' });
});

test('conserva los disparadores: push a master y ejecución manual', () => {
  assert.match(workflow, /^on:\n {2}push:\n {4}branches: \[master\]\n {2}workflow_dispatch:/m);
});

test('valida la configuración antes de Tailscale y de cualquier ssh', () => {
  const v = steps.indexOf(stepNamed('Validar configuración de despliegue'));
  assert.ok(v < tailscaleIndex());
  assert.ok(v < steps.findIndex(usesSsh));
});

test('nunca usa el SSH_HOST público ni interpola expresiones dentro de los scripts', () => {
  assert.doesNotMatch(workflow, /\bSSH_HOST\b/);
  for (const step of steps.filter((s) => s.run)) {
    assert.doesNotMatch(step.run, /\$\{\{/, `"${step.name}" interpola \${{ }} en el script`);
  }
  for (const name of ['Configurar la llave SSH', 'Publicar en el servidor']) {
    assert.equal(stepNamed(name).env.SSH_TAILSCALE_HOST, '${{ vars.SSH_TAILSCALE_HOST }}');
  }
});

test('conserva los comandos npm', () => {
  assert.equal(stepNamed('Instalar dependencias').run, 'npm i\n');
  assert.equal(stepNamed('Compilar').run, 'npm run build\n');
});

// ── Ejecución real de los scripts con HOME temporal ────────────────────────
// Solo se simulan ssh-keyscan y rsync, que necesitarían red.

const SECRET_KEY = [
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  'c2VjcmV0by1kZS1wcnVlYmE=',
  '-----END OPENSSH PRIVATE KEY-----',
].join('\n');

const BASE_ENV = {
  TS_CLIENT_ID: 'client-id-prueba',
  TS_AUDIENCE: 'audience-prueba',
  SSH_TAILSCALE_HOST: '100.124.13.38',
  SSH_PRIVATE_KEY: SECRET_KEY,
  SSH_USER: 'deploy',
  DEPLOY_PATH: '/var/www/personal-web',
};

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-wf-'));
  const home = join(dir, 'home');
  const bin = join(dir, 'bin');
  mkdirSync(home);
  mkdirSync(bin);
  const fake = (name, body) => {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  // FAKE_LOG recibe los argumentos (uno por línea); FAKE_MODE decide el resultado.
  fake('ssh-keyscan', [
    'printf "%s\\n" "$@" > "$FAKE_LOG"',
    'case "${FAKE_MODE:-ok}" in',
    '  ok) echo "|1|c2FsdA==|aGFzaA== ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPrueba" ;;',
    '  empty) exit 0 ;;',
    '  fail) echo "connect timed out" >&2; exit 1 ;;',
    'esac',
  ].join('\n'));
  fake('rsync', 'printf "%s\\n" "$@" > "$FAKE_LOG"');
  return { dir, home, bin, log: join(dir, 'fake.log') };
}

function runStep(name, overrides = {}, mode = 'ok') {
  const box = sandbox();
  const script = join(box.dir, 'step.sh');
  writeFileSync(script, stepNamed(name).run);
  const env = { ...BASE_ENV, ...overrides };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  // Igual que el shell por defecto de GitHub Actions en Linux.
  const res = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
    cwd: box.dir,
    encoding: 'utf8',
    env: { PATH: `${box.bin}:${process.env.PATH}`, HOME: box.home, FAKE_LOG: box.log, FAKE_MODE: mode, ...env },
  });
  const args = existsSync(box.log) ? readFileSync(box.log, 'utf8').trimEnd().split('\n') : null;
  return { ...res, out: res.stdout + res.stderr, args, box };
}

test('validación: pasa con toda la configuración presente', () => {
  const r = runStep('Validar configuración de despliegue');
  assert.equal(r.status, 0, r.out);
});

for (const name of Object.keys(BASE_ENV)) {
  test(`validación: falla y nombra ${name} si falta, sin filtrar secretos`, () => {
    for (const value of [undefined, '']) {
      const r = runStep('Validar configuración de despliegue', { [name]: value });
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, new RegExp(`::error::.*\\b${name}\\b`));
      assert.ok(!r.out.includes('c2VjcmV0by1kZS1wcnVlYmE='), 'la llave aparece en el log');
    }
  });
}

test('llave SSH: escribe la llave y known_hosts del host de Tailscale con timeout acotado', () => {
  const r = runStep('Configurar la llave SSH');
  assert.equal(r.status, 0, r.out);
  const ssh = join(r.box.home, '.ssh');
  assert.equal(readFileSync(join(ssh, 'id_deploy'), 'utf8'), `${SECRET_KEY}\n`);
  assert.equal(statSync(join(ssh, 'id_deploy')).mode & 0o777, 0o600);
  assert.equal(statSync(ssh).mode & 0o777, 0o700);
  assert.match(readFileSync(join(ssh, 'known_hosts'), 'utf8'), /^\|1\|.* ssh-ed25519 /);
  assert.deepEqual(r.args, ['-T', '10', '-H', '100.124.13.38']);
  assert.ok(!r.out.includes('c2VjcmV0by1kZS1wcnVlYmE='), 'la llave aparece en el log');
});

test('llave SSH: normaliza una llave pegada con CRLF', () => {
  const r = runStep('Configurar la llave SSH', { SSH_PRIVATE_KEY: SECRET_KEY.replace(/\n/g, '\r\n') + '\r\n' });
  assert.equal(r.status, 0, r.out);
  const key = readFileSync(join(r.box.home, '.ssh', 'id_deploy'), 'utf8');
  assert.ok(!key.includes('\r'));
  assert.ok(key.startsWith(`${SECRET_KEY}\n`));
});

test('llave SSH: el contenido de la llave nunca se ejecuta como shell', () => {
  const r = runStep('Configurar la llave SSH', { SSH_PRIVATE_KEY: '$(touch pwned)`touch pwned2`' });
  assert.equal(r.status, 0, r.out);
  assert.ok(!existsSync(join(r.box.dir, 'pwned')) && !existsSync(join(r.box.dir, 'pwned2')));
});

for (const [mode, why] of [['empty', 'sin claves'], ['fail', 'con error']]) {
  test(`llave SSH: falla con diagnóstico accionable si ssh-keyscan termina ${why}`, () => {
    const r = runStep('Configurar la llave SSH', {}, mode);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /::error::ssh-keyscan .*tag:personal-web-deploy.*docs\/deploy\.md/);
    assert.ok(!existsSync(join(r.box.home, '.ssh', 'known_hosts')), 'known_hosts no debe quedar escrito');
    assert.ok(!r.out.includes('c2VjcmV0by1kZS1wcnVlYmE='), 'la llave aparece en el log');
  });
}

test('publicar: rsync --delete por la IP de Tailscale con ssh estricto y no interactivo', () => {
  const r = runStep('Publicar en el servidor');
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.args, [
    '-avz',
    '--delete',
    '-e',
    'ssh -i ~/.ssh/id_deploy -o StrictHostKeyChecking=yes -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=10',
    'dist/',
    'deploy@100.124.13.38:/var/www/personal-web/',
  ]);
});

test('publicar: el destino va entrecomillado y no ejecuta valores de la configuración', () => {
  const r = runStep('Publicar en el servidor', { DEPLOY_PATH: '/srv/$(touch pwned) web' });
  assert.equal(r.status, 0, r.out);
  assert.equal(r.args.at(-1), 'deploy@100.124.13.38:/srv/$(touch pwned) web/');
  assert.ok(!existsSync(join(r.box.dir, 'pwned')));
});

// ── Purga de caché de Cloudflare ───────────────────────────────────────────

const CF_PREFLIGHT = 'Validar configuración de Cloudflare';
const CF_PURGE = 'Purgar caché de Cloudflare';
const CF_TOKEN = 'cf-token-secreto-de-prueba';
const CF_ENV = { CLOUDFLARE_ZONE_ID: '0123456789abcdef0123456789abcdef', CLOUDFLARE_API_TOKEN: CF_TOKEN };
const CF_STEP_ENV = {
  CLOUDFLARE_ZONE_ID: '${{ vars.CLOUDFLARE_ZONE_ID }}',
  CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
};

test('Cloudflare: la validación previa es un paso propio antes de compilar y desplegar', () => {
  const pre = steps.indexOf(stepNamed(CF_PREFLIGHT));
  assert.notEqual(pre, steps.indexOf(stepNamed('Validar configuración de despliegue')));
  assert.ok(pre < steps.indexOf(stepNamed('Instalar dependencias')));
  assert.ok(pre < tailscaleIndex());
  assert.ok(pre < steps.findIndex(usesSsh));
  assert.deepEqual(stepNamed(CF_PREFLIGHT).env, CF_STEP_ENV);
});

test('Cloudflare: purga justo después de rsync, con semántica de éxito por defecto', () => {
  const purge = stepNamed(CF_PURGE);
  assert.equal(steps.indexOf(purge), steps.indexOf(stepNamed('Publicar en el servidor')) + 1);
  assert.equal(steps.at(-1), purge, 'la purga es el último paso');
  assert.equal(purge.if, undefined, 'sin if: (nada de always())');
  assert.equal(purge['continue-on-error'], undefined);
  assert.equal(purge.run, 'node scripts/cloudflare-purge.mjs\n');
  assert.deepEqual(purge.env, CF_STEP_ENV);
  const minutes = Number(purge['timeout-minutes']);
  assert.ok(minutes > 0 && minutes <= 5, 'timeout-minutes acotado');
  assert.doesNotMatch(workflow, /always\(\)|continue-on-error|purge_everything/);
});

test('Cloudflare: los demás pasos no reciben la configuración de Cloudflare', () => {
  for (const step of steps) {
    if (step.name === CF_PREFLIGHT || step.name === CF_PURGE) continue;
    assert.ok(!Object.values(step.env).some((v) => v.includes('CLOUDFLARE')), `"${step.name}" recibe Cloudflare`);
  }
});

test('Cloudflare: validación previa pasa con configuración correcta', () => {
  const r = runStep(CF_PREFLIGHT, CF_ENV);
  assert.equal(r.status, 0, r.out);
  assert.ok(!r.out.includes(CF_TOKEN));
});

for (const [why, overrides, pattern] of [
  ['falta la variable', { CLOUDFLARE_ZONE_ID: undefined }, /::error::.*variable CLOUDFLARE_ZONE_ID/],
  ['la variable está vacía', { CLOUDFLARE_ZONE_ID: '' }, /::error::.*variable CLOUDFLARE_ZONE_ID/],
  ['falta el secreto', { CLOUDFLARE_API_TOKEN: undefined }, /::error::.*secret CLOUDFLARE_API_TOKEN/],
  ['el secreto está vacío', { CLOUDFLARE_API_TOKEN: '' }, /::error::.*secret CLOUDFLARE_API_TOKEN/],
  ['el zone ID es corto', { CLOUDFLARE_ZONE_ID: '0123456789abcdef' }, /::error::.*CLOUDFLARE_ZONE_ID.*32/],
  ['el zone ID tiene mayúsculas', { CLOUDFLARE_ZONE_ID: '0123456789ABCDEF0123456789ABCDEF' }, /::error::.*CLOUDFLARE_ZONE_ID.*32/],
  ['el zone ID tiene salto de línea', { CLOUDFLARE_ZONE_ID: `${CF_ENV.CLOUDFLARE_ZONE_ID}\n` }, /::error::.*CLOUDFLARE_ZONE_ID.*32/],
  ['el zone ID intenta inyección', { CLOUDFLARE_ZONE_ID: '$(touch pwned)' }, /::error::.*CLOUDFLARE_ZONE_ID.*32/],
]) {
  test(`Cloudflare: validación previa falla si ${why}, sin filtrar valores`, () => {
    const r = runStep(CF_PREFLIGHT, { ...CF_ENV, ...overrides });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, pattern);
    assert.ok(!r.out.includes(CF_TOKEN), 'el token aparece en el log');
    assert.ok(!existsSync(join(r.box.dir, 'pwned')));
  });
}
