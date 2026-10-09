// Purga la caché de Cloudflare de alexgar.tech y www.alexgar.tech tras el
// despliegue (ver docs/deploy.md). Solo por host: nunca purge_everything ni
// otros subdominios. Uso: CLOUDFLARE_ZONE_ID=… CLOUDFLARE_API_TOKEN=… node scripts/cloudflare-purge.mjs
import { pathToFileURL } from 'node:url';

export const PURGE_HOSTS = Object.freeze(['alexgar.tech', 'www.alexgar.tech']);

const API = 'https://api.cloudflare.com/client/v4';
const ZONE_ID = /^[0-9a-f]{32}$/;
const TOKEN = /^[\x21-\x7e]+$/; // ASCII imprimible sin espacios ni saltos de línea

export class PurgeError extends Error {}

class Transient extends Error {}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readConfig(env) {
  const zoneId = env.CLOUDFLARE_ZONE_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!zoneId) throw new PurgeError('Falta la variable CLOUDFLARE_ZONE_ID del repositorio. Ver docs/deploy.md.');
  if (!ZONE_ID.test(zoneId)) {
    throw new PurgeError('CLOUDFLARE_ZONE_ID debe ser el Zone ID de alexgar.tech: 32 caracteres hexadecimales en minúscula.');
  }
  if (!token) throw new PurgeError('Falta el secreto CLOUDFLARE_API_TOKEN del repositorio. Ver docs/deploy.md.');
  if (!TOKEN.test(token)) {
    throw new PurgeError('CLOUDFLARE_API_TOKEN contiene espacios, saltos de línea o caracteres no válidos.');
  }
  return { zoneId, token };
}

// Ejecuta fn con un límite de tiempo que también vale si fetch ignora el signal.
async function withTimeout(fn, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Transient(`sin respuesta en ${timeoutMs} ms (tiempo agotado)`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

function errorCodes(body) {
  const codes = Array.isArray(body?.errors)
    ? body.errors.map((e) => e?.code).filter((c) => Number.isInteger(c))
    : [];
  return codes.length ? ` (códigos de error de Cloudflare: ${codes.join(', ')})` : '';
}

function retryAfterMs(response) {
  const header = response.headers?.get?.('retry-after');
  if (!header || !/^\d+$/.test(header.trim())) return undefined;
  return Number(header.trim()) * 1000;
}

async function attempt({ fetch, url, token, timeoutMs }) {
  return withTimeout(async (signal) => {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ hosts: PURGE_HOSTS }),
        signal,
      });
    } catch (err) {
      throw new Transient(`error de red (${err?.name ?? 'Error'}: ${err?.message ?? err})`);
    }

    // Nunca se registra el cuerpo: solo el estado HTTP y los códigos de error.
    let body;
    try {
      body = JSON.parse(await response.text());
    } catch {
      body = undefined;
    }

    if (response.status === 429 || response.status >= 500) {
      const err = new Transient(`HTTP ${response.status}${errorCodes(body)}`);
      err.retryAfterMs = retryAfterMs(response);
      throw err;
    }
    if (!response.ok) throw new PurgeError(`Cloudflare respondió HTTP ${response.status}${errorCodes(body)}.`);
    if (body === undefined) throw new PurgeError(`Cloudflare respondió HTTP ${response.status} con JSON inválido.`);
    if (body?.success !== true) {
      throw new PurgeError(`Cloudflare respondió HTTP ${response.status} sin success: true${errorCodes(body)}.`);
    }
    return body;
  }, timeoutMs);
}

function bounded(name, value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} debe estar entre ${min} y ${max}`);
  }
}

export async function purgeCache({
  env = process.env,
  fetch = globalThis.fetch,
  sleep = defaultSleep,
  log = console.log,
  timeoutMs = 15_000,
  maxAttempts = 4,
  baseDelayMs = 2_000,
  maxDelayMs = 30_000,
} = {}) {
  bounded('maxAttempts', maxAttempts, 1, 10);
  bounded('timeoutMs', timeoutMs, 1, 120_000);
  bounded('baseDelayMs', baseDelayMs, 0, 60_000);
  bounded('maxDelayMs', maxDelayMs, 0, 120_000);

  const { zoneId, token } = readConfig(env);
  const redact = (text) => String(text).replaceAll(token, '***').replaceAll(zoneId, '<zone>');
  const url = `${API}/zones/${zoneId}/purge_cache`;

  for (let n = 1; ; n++) {
    try {
      const body = await attempt({ fetch, url, token, timeoutMs });
      const id = typeof body.result?.id === 'string' ? ` (id ${redact(body.result.id)})` : '';
      log(
        `Cloudflare aceptada la purga de ${PURGE_HOSTS.join(', ')}${id} en el intento ${n}. ` +
          'Aceptada no garantiza que todos los nodos ya la hayan aplicado; no afecta a la caché de los navegadores.',
      );
      return { attempts: n };
    } catch (err) {
      if (!(err instanceof Transient)) throw new PurgeError(redact(err.message));
      const reason = redact(err.message);
      if (n >= maxAttempts) {
        throw new PurgeError(`La purga de Cloudflare falló tras ${n} intentos: ${reason}.`);
      }
      const delay = Math.min(err.retryAfterMs ?? baseDelayMs * 2 ** (n - 1), maxDelayMs);
      log(`Intento ${n}/${maxAttempts} fallido (${reason}); reintento en ${delay} ms.`);
      await sleep(delay);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await purgeCache();
  } catch (err) {
    const message = err instanceof PurgeError ? err.message : 'Error inesperado al purgar la caché de Cloudflare.';
    console.log(`::error::${message} El sitio ya está publicado; solo ha fallado la purga. Ver docs/deploy.md.`);
    process.exitCode = 1;
  }
}
