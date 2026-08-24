/**
 * Which school this browser tab belongs to, decided by the address bar.
 *
 * Deliberately free of any Firebase import. Reading the address is pure
 * string work and the decisions it drives — what a visitor is shown, before
 * a single request — are exactly the ones worth unit testing. Anything that
 * needs a signed-in user lives in hostOrg.ts alongside the handoff.
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

/**
 * What this address is for.
 *
 *   marketing  pracscriber.com — the public site. Explains Scriber to
 *              somebody who has never seen it.
 *   app        app.pracscriber.com — the product itself, for people with no
 *              school. There is nothing to explain here; an anonymous visitor
 *              wants the sign-in page, not a pitch.
 *   org        stpauls.pracscriber.com — the product wearing a school's
 *              colours alongside Scriber's own.
 *
 * Local development has no subdomains, so it is 'marketing' and every route
 * stays reachable — which is also what keeps the end-to-end suite working.
 */
export type HostKind = 'marketing' | 'app' | 'org'

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
export function subdomainsAvailable(hostname: string = window.location.hostname): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || /^\d+(\.\d+){3}$/.test(host)) return false
  if (host.endsWith('.vercel.app')) return false
  return host.split('.').length >= 2
}

/** pracscriber.com, from whatever host we're on. */
export function rootDomain(hostname: string = window.location.hostname): string {
  return hostname.toLowerCase().split('.').slice(-2).join('.')
}

export const orgUrl = (slug: string) => `https://${slug}.${rootDomain()}`
export const appUrl = () => `https://app.${rootDomain()}`
export const marketingUrl = () => `https://${rootDomain()}`

/**
 * Where "Sign in" goes from the public site.
 *
 * Straight to the app's own origin, never to a sign-in form on
 * pracscriber.com. A Firebase session belongs to one origin, so signing in on
 * the marketing domain produces a session that the app domain cannot see —
 * which is why signing in there and then being moved across asked people to
 * do it twice. Sending them to the app first means the session is created
 * where it is going to be used.
 *
 * Locally there are no subdomains, so this stays a plain in-app route and the
 * end-to-end suite keeps working.
 */
export const loginUrl = (hostname: string = window.location.hostname) =>
  subdomainsAvailable(hostname) ? `https://app.${rootDomain(hostname)}/login` : '/login'

/** True when marketing, app and schools are genuinely separate origins. */
export const originsAreSeparate = subdomainsAvailable

/** The leftmost label, or null when the address has no subdomain to read. */
function subdomainLabel(hostname: string): string | null {
  if (!subdomainsAvailable(hostname)) return null
  const labels = hostname.toLowerCase().split('.')
  return labels.length >= 3 ? labels[0]! : null
}

/**
 * Decided from the address alone, so it is known before any network call —
 * routing cannot wait on Firestore to find out whether to show a sign-in page
 * or a sales pitch.
 */
export function hostKind(hostname: string = window.location.hostname): HostKind {
  const label = subdomainLabel(hostname)
  if (label === null) return 'marketing'
  if (label === 'app' || label === 'www') return 'app'
  return 'org'
}

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
