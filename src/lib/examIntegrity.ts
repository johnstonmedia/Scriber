/**
 * Watches a live test's exam room for the things a browser is actually
 * allowed to tell us about — and is honest about the rest.
 *
 * What a web page CAN see: its own tab losing focus or being hidden, copy,
 * cut and paste against its own document, the context menu, and the key
 * combinations that open dev tools. It can also notice the viewport suddenly
 * gaining a large gap between its inner and outer size, which is what
 * docking dev tools looks like from the inside.
 *
 * What no web page can see, at any price: which other applications are open,
 * what the student's other tabs are, or what is on the rest of their screen.
 * That information is walled off from web content by the browser itself. The
 * only way to see it is for the student to share their screen, which is a
 * separate feature — not something this file can infer.
 */

import { useEffect, useRef } from 'react'
import { logIntegrityAlert, type IntegrityAlertType } from './testSession'

/** Two of the same event inside this window count once — one glance away, one alert. */
const DEDUPE_MS = 3000

export function useExamIntegrity({
  active,
  orgId,
  testId,
  uid,
  name,
  onLocalWarning,
}: {
  active: boolean
  orgId: string | null
  testId: string | null
  uid: string | null
  name: string
  onLocalWarning: (message: string) => void
}) {
  const lastByType = useRef<Partial<Record<IntegrityAlertType, number>>>({})

  useEffect(() => {
    if (!active || !orgId || !testId || !uid) return

    const report = (type: IntegrityAlertType, detail?: string) => {
      const now = Date.now()
      if (now - (lastByType.current[type] ?? 0) < DEDUPE_MS) return
      lastByType.current[type] = now
      void logIntegrityAlert(orgId, testId, { uid, name, type, detail }).catch(() => undefined)
    }

    const onVisibility = () => {
      if (document.hidden) {
        report('tab-hidden')
        onLocalWarning('You left the test tab. Your supervisor has been notified.')
      }
    }
    const onBlur = () => report('focus-lost')
    const onCopy = () => {
      report('copy')
      onLocalWarning('Copying is not allowed during a test.')
    }
    const onCut = () => report('cut')
    const onPaste = () => {
      report('paste')
      onLocalWarning('Pasting is not allowed during a test.')
    }
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      report('context-menu')
    }

    // Blocking these does not make dev tools unreachable — the menu bar still
    // opens them, and nothing in a browser can stop that. It raises the
    // effort, and more usefully, it tells the supervisor someone tried.
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const ctrlish = event.ctrlKey || event.metaKey
      const isDevtools =
        key === 'f12' ||
        (ctrlish && event.shiftKey && ['i', 'j', 'c'].includes(key)) ||
        (ctrlish && key === 'u')
      if (isDevtools) {
        event.preventDefault()
        report('devtools-shortcut', event.key)
        onLocalWarning('That is not available during a test.')
        return
      }
      if (ctrlish && ['c', 'x', 'v'].includes(key)) {
        event.preventDefault()
        report(key === 'c' ? 'copy' : key === 'x' ? 'cut' : 'paste')
        onLocalWarning('Copying and pasting are not allowed during a test.')
      }
    }

    // Docked dev tools shrink the viewport without changing the window, which
    // is the one signal available from inside the page. Undocked dev tools in
    // their own window are invisible to this, so it is a hint for the
    // supervisor, never a verdict.
    const checkViewport = () => {
      const gap = Math.max(window.outerWidth - window.innerWidth, window.outerHeight - window.innerHeight)
      if (gap > 220) report('devtools-suspected', `viewport gap ${Math.round(gap)}px`)
    }
    const viewportTimer = window.setInterval(checkViewport, 4000)

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      window.clearInterval(viewportTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [active, orgId, testId, uid, name, onLocalWarning])
}
