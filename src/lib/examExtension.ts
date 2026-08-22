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
    throw new Error('Could not generate a pairing code just now. Try again in a moment.')
  }
  return (await response.json()) as { code: string; expiresAt: number }
}
