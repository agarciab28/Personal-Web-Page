import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/assets/css/main.css', import.meta.url), 'utf8')
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

const URLS = {
  linkedin: 'https://www.linkedin.com/in/Alejandro-garcia-9b37ab142/',
  github: 'https://github.com/agarciab28',
  x: 'https://x.com/agarciab28',
  instagram: 'https://www.instagram.com/agarciab28',
}
const count = (s, re) => (s.match(re) || []).length
const section = html.slice(html.indexOf('<section class="contact-hub"'), html.indexOf('</main>'))

test('header has outlined Contact button and plain Technologies link', () => {
  assert.match(html, /<nav aria-label="Main navigation"><a class="nav-link" href="#tecnologias">Technologies<\/a><a class="nav-cta" href="#contacto">Contact<\/a><\/nav>/)
  assert.match(css, /header nav a\.nav-cta\{[^}]*border:1px solid var\(--accent\)[^}]*color:var\(--accent\)/)
  assert.match(css, /header nav a\.nav-cta:hover\{background:var\(--accent\)/)
})

test('hero has Find me on row after the existing actions, with exact links', () => {
  const hero = html.slice(html.indexOf('<div class="actions"'), html.indexOf('<div class="stage">'))
  assert.ok(hero.indexOf('class="actions"') < hero.indexOf('class="find-me"'))
  assert.match(hero, /Let's talk<\/a><a class="secondary" href="#tecnologias">Explore technologies<\/a>/)
  assert.match(hero, />Find me on</)
  assert.match(hero, new RegExp(`href="${URLS.linkedin}" target="_blank" rel="noopener noreferrer"`))
  assert.match(hero, new RegExp(`href="${URLS.github}" target="_blank" rel="noopener noreferrer"`))
  assert.equal(count(hero, /\(opens in a new tab\)/g), 2)
  assert.doesNotMatch(hero, /x\.com|instagram/)
})

test('bottom contact is native, full width, outside .wrap, after Technologies', () => {
  assert.ok(!/<iframe|srcdoc|data:text\/html/i.test(html))
  assert.equal(count(html, /id="contacto"/g), 1)
  assert.ok(html.indexOf('id="tecnologias"') < html.indexOf('id="contacto"'))
  assert.match(html, /<section class="contact-hub" id="contacto" aria-labelledby="contacto-title">/)
  const between = html.slice(html.indexOf('id="tecnologias"'), html.indexOf('id="contacto"'))
  assert.ok(count(between, /<div/g) < count(between, /<\/div>/g), '.wrap div closed before contact')
  assert.ok(!/<footer>/.test(html), 'old tiny footer removed')
  assert.ok(!/class="socials"/.test(html))
})

test('contact copy is exact', () => {
  for (const t of [
    'CONTACT &amp; SOCIALS',
    'A good connection starts with <em>hello.</em>',
    'Frontend, web performance and automation. If these topics interest you too, let’s talk.',
    'Get in touch', 'Email', 'agarciab28@gmail.com', 'Copy email',
    'Find me online', '4 networks',
    'LinkedIn', 'Professional connections', 'Alejandro García',
    'GitHub', 'Profile &amp; code', '@agarciab28',
    'Also on', 'Let’s talk tech', 'Instagram', 'A more personal side',
    'Alejandro García · Monterrey, Mexico', '<span>agarciab28</span>',
  ]) assert.ok(section.includes(t), 'missing: ' + t)
  assert.ok(!/→|←|↗|&rarr;|arrow/i.test(section))
})

test('all four public URLs, safe blank targets, mailto', () => {
  for (const u of Object.values(URLS)) assert.ok(section.includes(`href="${u}"`), u)
  const anchors = section.match(/<a [^>]*>/g)
  for (const a of anchors.filter((a) => /target="_blank"/.test(a))) assert.match(a, /rel="noopener noreferrer"/)
  assert.equal(count(section, /target="_blank"/g), 4)
  assert.equal(count(section, /\(opens in a new tab\)/g), 4)
  assert.ok(section.includes('href="mailto:agarciab28@gmail.com"'))
  assert.match(section, /<nav class="directory" aria-labelledby="dir-title">/)
  assert.match(section, /id="copy-status" role="status" aria-live="polite"/)
  assert.match(section, /<button class="btn-copy" type="button" id="copy-email" data-email="agarciab28@gmail.com">/)
})

test('contact css is scoped, uses Display font, resets nav display and is responsive', () => {
  const start = css.indexOf('.contact-hub{')
  assert.ok(start > 0)
  const block = css.slice(start)
  assert.match(block, /\.contact-hub\{[^}]*font-family:Display/)
  assert.match(css, /\.contact-hub \.directory\{[^}]*display:block/)
  assert.ok(!/@font-face\{font-family:["']?Poppins/.test(css))
  assert.match(css, /body\{[^}]*font-family:Body/)
  for (const sel of ['btn-primary', 'btn-copy', 'email__address', 'net', 'mini', 'find-me__link'])
    assert.match(css, new RegExp(`\\.${sel}\\{[^}]*min-height:(44|60|76)px`), sel + ' min-height')
  assert.match(block, /@media ?\(max-width:520px\)/)
  assert.match(block, /prefers-reduced-motion:reduce/)
  assert.ok(!/\bgreen\b/i.test(css))
  assert.ok(!/footer\{border-top/.test(css))
  assert.ok(!/\.socials/.test(css))
})

test('main.ts wires the copy handler and keeps existing behavior', () => {
  assert.match(main, /from '\.\/copy-email'/)
  for (const k of ['entrance()', 'setupReveal()', 'prefers-reduced-motion: reduce', 'pointermove', '[role="tab"]'])
    assert.ok(main.includes(k), k)
})

/* ---------- copy-email behavior ---------- */
const { initCopyEmail } = await import('../src/copy-email.ts').catch(() => ({}))

function makeEnv({ clipboard, secure = true, exec = () => true, noButton = false, noStatus = false } = {}) {
  const timers = []
  let now = 0
  const label = { textContent: 'Copy email' }
  const attrs = { 'data-email': 'agarciab28@gmail.com' }
  const listeners = {}
  const btn = {
    getAttribute: (k) => attrs[k] ?? null,
    setAttribute: (k, v) => { attrs[k] = v },
    removeAttribute: (k) => { delete attrs[k] },
    querySelector: (s) => (s === '.btn-copy__text' ? label : null),
    addEventListener: (t, f) => { listeners[t] = f },
  }
  const status = { textContent: '' }
  const log = []
  const ranges = ['range1']
  const sel = {
    get rangeCount() { return ranges.length },
    getRangeAt: (i) => ranges[i],
    removeAllRanges: () => { ranges.length = 0; log.push('clearSel') },
    addRange: (r) => { ranges.push(r); log.push('addRange:' + r) },
  }
  const focused = { focus: (o) => log.push('focus:' + JSON.stringify(o)) }
  const ta = { style: {}, setAttribute() {}, select: () => log.push('select'), value: '' }
  const doc = {
    activeElement: focused,
    getElementById: (id) => (id === 'copy-email' && !noButton ? btn : id === 'copy-status' && !noStatus ? status : null),
    createElement: () => ta,
    body: { appendChild: () => log.push('append'), removeChild: () => log.push('remove') },
    execCommand: (c) => { log.push('exec:' + c + ':' + ta.value); return exec() },
    getSelection: () => sel,
  }
  const win = {
    navigator: { clipboard },
    isSecureContext: secure,
    setTimeout: (f, ms) => { timers.push({ f, at: now + ms, id: timers.length + 1 }); return timers.length },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.dead = true },
  }
  const advance = (ms) => {
    now += ms
    for (const t of timers.filter((x) => !x.dead && x.at <= now)) { t.dead = true; t.f() }
  }
  return { doc, win, btn, label, status, attrs, listeners, log, ranges, advance, click: () => listeners.click(), tick: () => new Promise((r) => setImmediate(r)) }
}
const boot = (e) => initCopyEmail(e.doc, e.win)

test('copy: Clipboard API success announces and resets after 4s', async () => {
  const written = []
  const e = makeEnv({ clipboard: { writeText: async (t) => { written.push(t) } } })
  boot(e); e.click(); await e.tick()
  assert.deepEqual(written, ['agarciab28@gmail.com'])
  e.advance(60)
  assert.equal(e.status.textContent, 'Email copied: agarciab28@gmail.com')
  assert.equal(e.label.textContent, 'Copied')
  assert.equal(e.attrs['data-state'], 'ok')
  e.advance(4000)
  assert.equal(e.status.textContent, '')
  assert.equal(e.label.textContent, 'Copy email')
  assert.equal(e.attrs['data-state'], undefined)
})

test('copy: rejected clipboard promise falls back to execCommand', async () => {
  const e = makeEnv({ clipboard: { writeText: () => Promise.reject(new Error('denied')) } })
  boot(e); e.click(); await e.tick(); e.advance(60)
  assert.ok(e.log.includes('exec:copy:agarciab28@gmail.com'))
  assert.equal(e.status.textContent, 'Email copied: agarciab28@gmail.com')
})

test('copy: synchronous throw from writeText falls back', async () => {
  const e = makeEnv({ clipboard: { writeText: () => { throw new Error('sync') } } })
  boot(e); e.click(); await e.tick(); e.advance(60)
  assert.ok(e.log.includes('exec:copy:agarciab28@gmail.com'))
  assert.equal(e.status.textContent, 'Email copied: agarciab28@gmail.com')
})

test('copy: insecure context or no clipboard uses fallback, preserving focus and selection', async () => {
  for (const env of [makeEnv({ clipboard: undefined }), makeEnv({ clipboard: { writeText: async () => {} }, secure: false })]) {
    boot(env); env.click(); await env.tick(); env.advance(60)
    assert.ok(env.log.includes('exec:copy:agarciab28@gmail.com'))
    assert.ok(env.log.indexOf('remove') < env.log.indexOf('addRange:range1'), 'selection restored after removal')
    assert.ok(env.log.some((l) => l.startsWith('focus:')), 'focus restored')
    assert.deepEqual(env.ranges, ['range1'])
    assert.equal(env.status.textContent, 'Email copied: agarciab28@gmail.com')
  }
})

test('copy: failure announces manual-copy message and no ok state', async () => {
  for (const exec of [() => false, () => { throw new Error('x') }]) {
    const e = makeEnv({ clipboard: { writeText: () => Promise.reject(new Error('no')) }, exec })
    boot(e); e.click(); await e.tick(); e.advance(60)
    assert.equal(e.status.textContent, 'Could not copy. Select the email address and copy it manually.')
    assert.equal(e.attrs['data-state'], undefined)
    assert.equal(e.label.textContent, 'Copy email')
    assert.ok(e.log.includes('remove'), 'temp textarea always removed')
    assert.deepEqual(e.ranges, ['range1'])
  }
})

test('copy: repeated clicks reset the timer safely', async () => {
  const e = makeEnv({ clipboard: { writeText: async () => {} } })
  boot(e); e.click(); await e.tick(); e.advance(60)
  e.advance(3000)
  e.click(); await e.tick(); e.advance(60)
  e.advance(3000)
  assert.equal(e.status.textContent, 'Email copied: agarciab28@gmail.com')
  e.advance(1100)
  assert.equal(e.status.textContent, '')
})

test('copy: missing DOM is handled gracefully', () => {
  assert.equal(boot(makeEnv({ noButton: true })), null)
  assert.equal(boot(makeEnv({ noStatus: true, clipboard: undefined })), null)
})
