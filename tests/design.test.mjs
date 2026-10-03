import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('../index.html');
const css = read('../src/assets/css/main.css');
const js = read('../src/main.ts');

test('conserva el titular aprobado del diseño editorial', () => {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '';
  const text = h1.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(text, 'Clear interfaces. Thoughtful code.');
});

test('no existe interfaz de pausa ni código muerto asociado', () => {
  assert.doesNotMatch(html, /Pausar animaci|Reanudar animaci|id="motion"|aria-pressed/i);
  assert.doesNotMatch(css, /\.motion\b|\.paused\b/);
  assert.doesNotMatch(js, /paused|getElementById\('motion'\)|Pausar/);
});

test('conserva los destinos públicos exactos', () => {
  for (const href of [
    'https://github.com/agarciab28',
    'https://www.linkedin.com/in/Alejandro-garcia-9b37ab142/',
    'https://x.com/agarciab28',
    'https://www.instagram.com/agarciab28',
    'mailto:agarciab28@gmail.com',
  ]) {
    assert.ok(html.includes(`href="${href}"`), href);
  }
});

test('idioma, favicons y módulo principal', () => {
  assert.match(html, /<html[^>]*\blang="en"/);
  assert.match(html, /rel="icon"[^>]*href="\/img\/favicon\/favicon\.ico"/);
  assert.match(html, /rel="apple-touch-icon"[^>]*href="\/img\/favicon\/apple-touch-icon\.png"/);
  assert.match(html, /<script type="module" src="\/src\/main\.ts"><\/script>/);
});

test('sin marcas internas, de revisión, flechas ni verde', () => {
  assert.doesNotMatch(html, /Propuesta para revisi|No publicada/i);
  assert.doesNotMatch(css, /\.review\b/);
  assert.doesNotMatch(html, /Obsidian|Raspberry/i);
  assert.doesNotMatch(html, /[→←↗↑↓➜➔]/);
  assert.doesNotMatch(css, /#(?:0f0|00ff00)\b|\bgreen\b/i);
});

test('pestañas: cuatro tab con tabpanel relacionado', () => {
  const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
  assert.equal(tabs.length, 4);
  for (const tag of tabs) {
    const controls = tag.match(/aria-controls="([^"]+)"/)?.[1];
    const id = tag.match(/\sid="([^"]+)"/)?.[1];
    assert.ok(controls && id);
    const panel = html.match(new RegExp(`<section[^>]*id="${controls}"[^>]*>`))?.[0] ?? '';
    assert.match(panel, /role="tabpanel"/);
    assert.ok(panel.includes(`aria-labelledby="${id}"`));
  }
  assert.equal(tabs.filter((t) => t.includes('aria-selected="true"')).length, 1);
});

test('respeta prefers-reduced-motion sin animaciones infinitas', () => {
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(css, /infinite/);
  assert.match(js, /cancelAnimationFrame/);
  assert.match(js, /prefers-reduced-motion: reduce/);
});

test('los recursos referenciados existen', () => {
  assert.ok(existsSync(new URL('../src/assets/fonts/Poppins/Poppins-Regular.ttf', import.meta.url)));
  assert.ok(existsSync(new URL('../src/assets/fonts/OpenSans/OpenSans-Regular.ttf', import.meta.url)));
  assert.ok(existsSync(new URL('../src/assets/img/portrait.png', import.meta.url)), 'portrait.png');
  assert.ok(existsSync(new URL('../public/img/favicon/favicon.ico', import.meta.url)) || existsSync(new URL('../img/favicon/favicon.ico', import.meta.url)));
});
