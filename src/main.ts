import './assets/css/main.css'
import { initCopyEmail } from './copy-email'

initCopyEmail()

const EASE = 'cubic-bezier(.16,1,.3,1)'
const root = document.documentElement
root.classList.add('js')

const reduced = matchMedia('(prefers-reduced-motion: reduce)')
const fine = matchMedia('(hover: hover) and (pointer: fine)')
const running = new Set<Animation>()
const pending = new Set<Element>()
let io: IntersectionObserver | null = null

function play(el: Element | null, kf: Keyframe[], opt: KeyframeAnimationOptions): Animation | null {
  if (!el || reduced.matches || typeof el.animate !== 'function') return null
  const a = el.animate(kf, opt)
  running.add(a)
  const done = () => running.delete(a)
  a.addEventListener('finish', done)
  a.addEventListener('cancel', done)
  return a
}

/* Parallax: dirigido por eventos, sin bucles */
const portrait = document.getElementById('portrait')
let raf = 0
let tx = 0
let ty = 0

function resetPar() {
  if (!portrait) return
  portrait.style.setProperty('--px', '0px')
  portrait.style.setProperty('--py', '0px')
}
function cancelPar() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}
function applyPar() {
  raf = 0
  if (reduced.matches || !portrait) return
  portrait.style.setProperty('--px', tx + 'px')
  portrait.style.setProperty('--py', ty + 'px')
}

/* Tabs */
const tabs = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'))
const list = document.getElementById('tablist')
const ind = document.getElementById('ind')
const stack = matchMedia('(max-width: 700px)')

function placeInd() {
  const t = tabs.find((x) => x.getAttribute('aria-selected') === 'true')
  if (!t || !ind || stack.matches) return
  ind.style.width = t.offsetWidth + 'px'
  ind.style.transform = 'translateX(' + t.offsetLeft + 'px)'
}

/* Al reducir movimiento: terminar animaciones, mostrar revelaciones pendientes, quitar parallax */
function applyReduced() {
  running.forEach((a) => {
    try {
      a.finish()
    } catch (_) {
      /* ya terminada */
    }
  })
  running.clear()
  if (io) {
    io.disconnect()
    io = null
  }
  pending.forEach((el) => el.classList.remove('pre'))
  pending.clear()
  cancelPar()
  resetPar()
  placeInd()
}
reduced.addEventListener('change', (e) => {
  if (e.matches) applyReduced()
})

function entrance() {
  document
    .querySelectorAll('h1 .ln>span')
    .forEach((el, i) =>
      play(el, [{ transform: 'translateY(112%)' }, { transform: 'translateY(0)' }], { duration: 900, delay: 120 + i * 120, easing: EASE, fill: 'backwards' })
    )
  document
    .querySelectorAll('[data-hero]')
    .forEach((el, i) =>
      play(el, [{ opacity: 0, translate: '0 14px' }, { opacity: 1, translate: '0 0' }], { duration: 800, delay: 500 + i * 120, easing: EASE, fill: 'backwards' })
    )
  play(document.querySelector('.p-solid'), [{ scale: '1 0' }, { scale: '1 1' }], { duration: 700, delay: 100, easing: EASE, fill: 'backwards' })
  play(document.querySelector('.p-outline'), [{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 600, easing: 'ease-out', fill: 'backwards' })
  play(document.querySelector('.portrait img'), [{ opacity: 0, translate: '0 12px' }, { opacity: 1, translate: '0 0' }], {
    duration: 800,
    delay: 750,
    easing: EASE,
    fill: 'backwards',
  })
}

/* Revelaciones al hacer scroll (una sola vez) */
function setupReveal() {
  if (reduced.matches || !('IntersectionObserver' in window)) return
  const observer = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return
        const el = e.target
        observer.unobserve(el)
        pending.delete(el)
        el.classList.remove('pre')
        play(el, [{ opacity: 0, translate: '0 24px' }, { opacity: 1, translate: '0 0' }], { duration: 900, easing: EASE })
      }),
    { threshold: 0.15 }
  )
  io = observer
  document.querySelectorAll('[data-reveal]').forEach((el) => {
    if (el.getBoundingClientRect().top < innerHeight * 0.9) return
    el.classList.add('pre')
    pending.add(el)
    observer.observe(el)
  })
}

addEventListener(
  'pointermove',
  (e: PointerEvent) => {
    if (reduced.matches || !fine.matches || e.pointerType === 'touch' || !portrait) return
    const b = portrait.getBoundingClientRect()
    if (e.clientY > b.bottom + 200 || e.clientY < b.top - 200) return
    tx = Math.max(-1, Math.min(1, (e.clientX - (b.left + b.width / 2)) / (innerWidth / 2))) * 14
    ty = Math.max(-1, Math.min(1, (e.clientY - (b.top + b.height / 2)) / (innerHeight / 2))) * 10
    if (!raf) raf = requestAnimationFrame(applyPar)
  },
  { passive: true }
)
document.addEventListener('pointerleave', () => {
  cancelPar()
  resetPar()
})

function orient() {
  if (list) list.setAttribute('aria-orientation', stack.matches ? 'vertical' : 'horizontal')
  placeInd()
}
stack.addEventListener('change', orient)
addEventListener('resize', placeInd)
if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeInd)

function select(tab: HTMLElement, focus: boolean) {
  tabs.forEach((t) => {
    const on = t === tab
    t.setAttribute('aria-selected', String(on))
    t.tabIndex = on ? 0 : -1
    const p = document.getElementById(t.getAttribute('aria-controls') || '')
    if (p) p.hidden = !on
  })
  placeInd()
  const panel = document.getElementById(tab.getAttribute('aria-controls') || '')
  if (panel) {
    panel
      .querySelectorAll('h3,.desc,.concepts')
      .forEach((el, i) =>
        play(el, [{ opacity: 0, translate: '0 10px' }, { opacity: 1, translate: '0 0' }], { duration: 450, delay: i * 50, easing: EASE, fill: 'backwards' })
      )
    panel
      .querySelectorAll('.names li')
      .forEach((li, i) =>
        play(li, [{ opacity: 0, translate: '0 14px' }, { opacity: 1, translate: '0 0' }], { duration: 500, delay: 80 + i * 40, easing: EASE, fill: 'backwards' })
      )
  }
  if (focus) tab.focus()
}

tabs.forEach((t, i) => {
  t.addEventListener('click', () => select(t, false))
  t.addEventListener('keydown', (e: KeyboardEvent) => {
    let n = i
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = tabs.length - 1
    else return
    e.preventDefault()
    select(tabs[n], true)
  })
})

/* Con JS activo, solo el panel seleccionado queda visible */
tabs.forEach((t) => {
  const p = document.getElementById(t.getAttribute('aria-controls') || '')
  if (p) p.hidden = t.getAttribute('aria-selected') !== 'true'
})

orient()
if (!reduced.matches) {
  entrance()
  setupReveal()
}
