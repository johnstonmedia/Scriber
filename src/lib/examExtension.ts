/**
 * Talking to the supervision extension, if it's installed.
 *
 * The extension only reports while a test is being sat — outside one it knows
 * nothing and sends nothing. That boundary is drawn here: the exam room says
 * when a test starts and when it ends, and nothing else in the app ever
 * addresses the extension at all.
 *
 * Messages go through window.postMessage rather than chrome.runtime, because
 * a page can only address an extension it knows the ID of, and that ID
 * differs between a local build and the published one. The extension's
 * content script is already in both worlds and does the relaying.
 */

/**
 * Whether the extension is installed, read from the attribute its content
 * script sets on the document at load. Not a promise: by the time any exam
 * screen renders, document_start has long since run.
 */
export function extensionInstalled(): boolean {
  return typeof document !== 'undefined' && !!document.documentElement.dataset.scriberExtension
}

export function announceTestStart(orgId: string, testId: string): void {
  window.postMessage({ source: 'scriber-page', type: 'test-start', orgId, testId }, window.location.origin)
}

export function announceTestEnd(): void {
  window.postMessage({ source: 'scriber-page', type: 'test-end' }, window.location.origin)
}

/**
 * Asks Scriber's backend for a pairing code to type into the extension. The
 * extension cannot hold a Firebase session of its own, so this is how a
 * signed-in student vouches for it — see api/extension/pair-code.ts.
 */
export async function requestPairingCode(idToken: string): Promise<{ code: string; expiresAt: number }> {
  const response = await fetch('/api/extension/pair-code', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  })
  if (!response.ok) {
    throw new Error(await pairingFailure(response))
  }
  return (await response.json()) as { code: string; expiresAt: number }
}

/**
 * Pairs the extension without anybody typing anything.
 *
 * The code exists for the case where the extension is in a browser the
 * student isn't signed in on. When it's in *this* browser — which is the
 * normal case, since the exam room and the extension have to be in the same
 * browser to be worth anything — the page is already signed in, and asking
 * somebody to read six characters across from one panel to another is a step
 * that only ever exists to fail.
 *
 * So the page mints the code and spends it itself, then hands the resulting
 * token to the extension through the content script. That token is worth no
 * more than what the page already holds: any script running on this origin
 * has the student's Firebase ID token and could mint one anyway. It grants no
 * Firebase access of its own — it only lets the backend recognise which
 * student an extension report belongs to.
 */
export async function pairExtension(idToken: string): Promise<{ name: string }> {
  if (!extensionInstalled()) {
    throw new Error('The Scriber extension isn’t installed in this browser yet.')
  }

  const { code } = await requestPairingCode(idToken)
  const response = await fetch('/api/extension/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!response.ok) {
    throw new Error(await pairingFailure(response))
  }
  const issued = (await response.json()) as { token: string; uid: string; name: string }

  // The content script relays this to the background worker, which is the
  // only place the token comes to rest. Confirmation comes back as an event
  // rather than a return value, because the round trip crosses two worlds the
  // page cannot await across.
  const confirmed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('scriber:paired', onPaired)
      reject(new Error('The extension didn’t answer. Reload the page and try again.'))
    }, 5000)
    function onPaired() {
      clearTimeout(timer)
      window.removeEventListener('scriber:paired', onPaired)
      resolve()
    }
    window.addEventListener('scriber:paired', onPaired)
  })

  window.postMessage(
    { source: 'scriber-page', type: 'pair', token: issued.token },
    window.location.origin,
  )
  await confirmed
  return { name: issued.name }
}

/**
 * What went wrong, in words the person reading it can act on. A pairing
 * failure is nearly always one of two things — signed out, or the backend
 * isn't configured — and "try again in a moment" is useless advice for both.
 */
async function pairingFailure(response: Response): Promise<string> {
  if (response.status === 401 || response.status === 403) {
    return 'Your sign-in has expired. Sign out, sign back in, and try again.'
  }
  const detail = await response
    .json()
    .then((body: { message?: string }) => body.message)
    .catch(() => undefined)
  if (detail) return detail
  return response.status >= 500
    ? "Pairing is unavailable right now — that's on our side, not yours (SCR-420)."
    : 'Could not pair the extension just now. Try again in a moment.'
}
