/**
 * Crossing between Scriber's origins without making anybody sign in twice.
 *
 * The address-bar reading itself lives in host.ts and is re-exported here, so
 * every existing import keeps working; what is genuinely this file's is the
 * handoff, which needs Firebase and therefore cannot be unit tested.
 */

import { signInWithCustomToken } from 'firebase/auth'
import { auth } from './firebase'

export * from './host'

const HANDOFF = 'handoff='

/**
 * Sends the signed-in person to another subdomain without making them sign in
 * again, by carrying a one-off token in the fragment. If anything goes wrong
 * we still navigate — arriving signed out is recoverable, being stuck is not.
 */
export async function goToOrigin(origin: string, path = '/'): Promise<void> {
  let fragment = ''
  try {
    const user = auth.currentUser
    if (user) {
      const response = await fetch('/api/auth/handoff', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      })
      if (response.ok) {
        const { token } = (await response.json()) as { token: string }
        fragment = `#${HANDOFF}${encodeURIComponent(token)}`
      }
    }
  } catch {
    // fall through and navigate unauthenticated
  }
  window.location.replace(`${origin}${path}${fragment}`)
}

/**
 * Spends a handoff token if this page was opened with one. Runs before the
 * app decides whether anybody is signed in, and clears the fragment
 * immediately either way so a reload can't replay it.
 */
export async function consumeHandoff(): Promise<void> {
  const hash = window.location.hash
  if (!hash.startsWith(`#${HANDOFF}`)) return
  const token = decodeURIComponent(hash.slice(HANDOFF.length + 1))
  history.replaceState(null, '', window.location.pathname + window.location.search)
  try {
    await signInWithCustomToken(auth, token)
  } catch {
    // An expired or already-spent token just means signing in normally.
  }
}
