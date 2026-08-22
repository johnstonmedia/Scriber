/**
 * Which school this browser tab belongs to, decided by the address bar.
 *
 * A school gets its own subdomain — stpauls.pracscriber.com — so that what a
 * student sees is plainly their school's, and so that what is reachable from
 * where is obvious rather than a matter of trust. Everyone else uses
 * app.pracscriber.com, which is the same Scriber without any of the
 * organisation machinery.
 *
 * The host is resolved by the backend rather than here: an anonymous visitor
 * has no Firestore access, and giving them a way to enumerate every school on
 * the platform to answer one question would be the wrong trade. See
 * api/org-by-host.ts.
 */

import { signInWithCustomToken } from 'firebase/auth'
import { auth } from './firebase'

export type HostOrg = {
  id: string
  slug: string
  name: string
  branding: { accentColor: string; tagline: string; logoDataUrl: string | null }
}

/**
 * True when the address bar can carry a school at all. Local development and
 * Vercel preview builds run on a single host, so subdomain routing is simply
 * off there — everything behaves as the plain app, which is also what keeps
 * the end-to-end suite working against localhost.
 */
export function subdomainsAvailable(): boolean {
  const host = window.location.hostname
  if (host === 'localhost' || host.endsWith('.localhost') || /^\d+(\.\d+){3}$/.test(host)) return false
  if (host.endsWith('.vercel.app')) return false
  return host.split('.').length >= 3 || host.split('.').length === 2
}

/** pracscriber.com, from whatever host we're on. */
export function rootDomain(): string {
  return window.location.hostname.split('.').slice(-2).join('.')
}

export const orgUrl = (slug: string) => `https://${slug}.${rootDomain()}`
export const appUrl = () => `https://app.${rootDomain()}`

let pending: Promise<HostOrg | null> | undefined

/** Cached for the life of the page — the address bar does not change under us. */
export function resolveHostOrg(): Promise<HostOrg | null> {
  if (!pending) {
    pending = (async () => {
      if (!subdomainsAvailable()) return null
      try {
        const response = await fetch('/api/org-by-host')
        if (!response.ok) return null
        const data = (await response.json()) as { org: HostOrg | null }
        return data.org ?? null
      } catch {
        // A school's subdomain that can't reach the backend still has to load
        // — it just loads unbranded rather than not at all.
        return null
      }
    })()
  }
  return pending
}

// ------------------------------------------------------------- crossing over

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
