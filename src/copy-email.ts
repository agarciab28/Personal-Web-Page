/* Copy-email control for the contact section. Dependencies are injected so it can be tested without a browser. */

const OK_DELAY = 60
const RESET_DELAY = 4000
const FAIL_MESSAGE = 'Could not copy. Select the email address and copy it manually.'

export function initCopyEmail(doc: Document = document, win: Window = window): (() => void) | null {
  const btn = doc.getElementById('copy-email')
  const status = doc.getElementById('copy-status')
  if (!btn || !status) return null
  const label = btn.querySelector('.btn-copy__text') as HTMLElement | null
  const email = btn.getAttribute('data-email') || ''
  if (!email) return null

  let showTimer: number | undefined
  let resetTimer: number | undefined

  function fallbackCopy(text: string): boolean {
    const active = doc.activeElement as HTMLElement | null
    const sel = doc.getSelection ? doc.getSelection() : null
    const saved: Range[] = []
    if (sel) for (let i = 0; i < sel.rangeCount; i++) saved.push(sel.getRangeAt(i))
    let ta: HTMLTextAreaElement | null = null
    let ok = false
    try {
      ta = doc.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.setAttribute('aria-hidden', 'true')
      ta.style.position = 'fixed'
      ta.style.top = '-1000px'
      ta.style.opacity = '0'
      doc.body.appendChild(ta)
      ta.select()
      ok = doc.execCommand('copy')
    } catch (_) {
      ok = false
    } finally {
      try {
        if (ta) doc.body.removeChild(ta)
      } catch (_) {
        /* already detached */
      }
      try {
        if (sel) {
          sel.removeAllRanges()
          saved.forEach((r) => sel.addRange(r))
        }
        if (active && typeof active.focus === 'function') active.focus({ preventScroll: true })
      } catch (_) {
        /* best effort */
      }
    }
    return ok
  }

  function report(ok: boolean) {
    win.clearTimeout(showTimer)
    win.clearTimeout(resetTimer)
    status!.textContent = ''
    /* Short delay so screen readers re-announce repeated messages */
    showTimer = win.setTimeout(() => {
      if (ok) {
        btn!.setAttribute('data-state', 'ok')
        if (label) label.textContent = 'Copied'
        status!.textContent = 'Email copied: ' + email
      } else {
        btn!.removeAttribute('data-state')
        if (label) label.textContent = 'Copy email'
        status!.textContent = FAIL_MESSAGE
      }
    }, OK_DELAY)
    resetTimer = win.setTimeout(() => {
      btn!.removeAttribute('data-state')
      if (label) label.textContent = 'Copy email'
      status!.textContent = ''
    }, RESET_DELAY)
  }

  function onClick() {
    const clip = win.navigator && win.navigator.clipboard
    if (clip && win.isSecureContext) {
      let p: Promise<void> | undefined
      try {
        p = Promise.resolve(clip.writeText(email))
      } catch (_) {
        report(fallbackCopy(email))
        return
      }
      p.then(
        () => report(true),
        () => report(fallbackCopy(email))
      )
    } else {
      report(fallbackCopy(email))
    }
  }

  btn.addEventListener('click', onClick)
  return () => {
    btn.removeEventListener('click', onClick)
    win.clearTimeout(showTimer)
    win.clearTimeout(resetTimer)
  }
}
