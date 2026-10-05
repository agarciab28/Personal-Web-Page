import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('../index.html');
const manifest = JSON.parse(read('../public/img/favicon/site.webmanifest'));
const svg = read('../public/img/favicon/favicon.svg');

const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
const hrefs = links.map((l) => l.match(/href="([^"]+)"/)?.[1]);

test('index.html enlaza los favicons en orden', () => {
  const want = [
    '/img/favicon/favicon.ico',
    '/img/favicon/favicon-16x16.png',
    '/img/favicon/favicon-32x32.png',
    '/img/favicon/favicon.svg',
  ];
  const idx = want.map((h) => hrefs.indexOf(h));
  assert.ok(idx.every((i) => i >= 0), `faltan enlaces: ${idx}`);
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
  assert.match(links[idx[3]], /type="image\/svg\+xml"/);
  assert.match(links[idx[1]], /sizes="16x16"/);
  assert.match(links[idx[2]], /sizes="32x32"/);
  assert.ok(hrefs.includes('/img/favicon/apple-touch-icon.png'));
  const m = hrefs.indexOf('/img/favicon/site.webmanifest');
  assert.ok(m >= 0);
  assert.match(links[m], /rel="manifest"/);
});

test('todos los archivos referenciados existen', () => {
  for (const h of hrefs.filter((h) => h?.startsWith('/img/favicon/'))) {
    assert.ok(existsSync(new URL(`../public${h}`, import.meta.url)), h);
  }
});

test('manifest usa rutas /img/favicon/ y no declara fondo', () => {
  assert.equal(manifest.name, 'Alejandro García');
  assert.equal(manifest.short_name, 'ag.');
  assert.equal(manifest.theme_color, '#100c17');
  assert.ok(!('background_color' in manifest));
  assert.deepEqual(manifest.icons.map((i) => i.sizes), ['192x192', '512x512']);
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\/img\/favicon\/android-chrome-\d+x\d+\.png$/);
    assert.ok(existsSync(new URL(`../public${icon.src}`, import.meta.url)), icon.src);
  }
});

test('el SVG no tiene fondo, texto ni fuentes externas', () => {
  assert.ok((svg.match(/<path\b/g) ?? []).length >= 3);
  assert.doesNotMatch(svg, /<(rect|text|image|circle|style)\b|font-family|url\(/i);
  assert.match(svg, /fill="#f3edf9"/);
  assert.match(svg, /fill="#bd94f8"/);
});
