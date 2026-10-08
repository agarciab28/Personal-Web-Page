import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const TITLE = 'Alejandro García | Frontend Developer · Vue & TypeScript'
const DESC =
  'Frontend developer based in Monterrey, Mexico. Building web interfaces with Vue and TypeScript, with a focus on performance and maintainability.'
const escapeAmp = (s) => s.replace(/&/g, '&amp;')
const count = (s, re) => (s.match(re) || []).length

const html = read('../index.html')
const main = read('../src/main.ts')
const built = existsSync(new URL('../dist/index.html', import.meta.url)) ? read('../dist/index.html') : null

function checkHead(doc) {
  const titles = doc.match(/<title>([^<]*)<\/title>/g) || []
  assert.equal(titles.length, 1)
  assert.ok(titles[0] === `<title>${TITLE}</title>` || titles[0] === `<title>${escapeAmp(TITLE)}</title>`)
  assert.equal(count(doc, /<meta name="description"/g), 1)
  assert.ok(doc.includes(`<meta name="description" content="${DESC}">`))
  assert.equal(count(doc, /<link rel="canonical"/g), 1)
  assert.match(doc, /<link rel="canonical" href="https:\/\/alexgar\.tech\/">/)
}

test('source head has exact title, description and single canonical', () => checkHead(html))

test('built head has exact title, description and single canonical', { skip: !built }, () => checkHead(built))

test('visible H1 and analytics are preserved', () => {
  assert.match(html, /<h1 id="hero-title"><span class="ln"><span>Clear<\/span><\/span> <span class="ln"><span>interfaces\.<\/span><\/span> <span class="ln"><span>Thoughtful<\/span><\/span> <span class="ln"><span><em>code\.<\/em><\/span><\/span><\/h1>/)
  assert.match(html, /analytics\.alexgar\.tech\/script\.js/)
  assert.match(html, /favicon\.ico/)
})

test('main.ts does not mutate document.title', () => {
  assert.doesNotMatch(main, /document\.title|<title|querySelector\(['"]title/)
})

test('robots.txt is plain text with sitemap', () => {
  assert.equal(read('../public/robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://alexgar.tech/sitemap.xml\n')
})

test('sitemap.xml lists only the home page', () => {
  const xml = read('../public/sitemap.xml')
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/)
  assert.deepEqual(xml.match(/<loc>[^<]*<\/loc>/g), ['<loc>https://alexgar.tech/</loc>'])
  assert.doesNotMatch(xml, /lastmod|#/)
})

test('404.html is English, noindex, links home, not canonicalized', () => {
  const page = read('../public/404.html')
  assert.match(page, /<html lang="en"/)
  assert.match(page, /<meta name="robots" content="noindex">/)
  assert.match(page, /<a href="\/">/)
  assert.doesNotMatch(page, /rel="canonical"/)
  assert.doesNotMatch(page, /Firebase/)
})

test('build artifacts include robots, sitemap and 404', { skip: !built }, () => {
  for (const f of ['robots.txt', 'sitemap.xml', '404.html']) {
    assert.ok(existsSync(new URL(`../dist/${f}`, import.meta.url)), f)
    assert.equal(read(`../dist/${f}`), read(`../public/${f}`), `${f} must match the source`)
  }
})
