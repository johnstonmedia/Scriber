/**
 * Reading a school out of a hostname.
 *
 * Kept apart from the route that uses it because the reserved list below is
 * security-relevant — a school that managed to claim "app" or "api" would be
 * able to dress itself up as the platform — and that deserves direct tests
 * rather than only being exercised through a deployed function.
 */

/** Subdomains that belong to the platform, never to a school. */
export const RESERVED_SUBDOMAINS = new Set([
  'app',
  'www',
  'api',
  'admin',
  'help',
  'support',
  'status',
  'mail',
  'staging',
  'preview',
  'dev',
  'test',
])

/**
 * The school's slug in a hostname, or null when there isn't one.
 *
 * Null is the ordinary answer for the platform's own addresses — the apex,
 * app.*, localhost, an IP, or a Vercel preview URL — and means "show the
 * plain Scriber, not a school".
 */
export function slugFromHost(host: string): string | null {
  const clean = host.toLowerCase().split(':')[0]!.trim()
  if (!clean || clean === 'localhost' || clean.endsWith('.localhost')) return null
  if (/^\d+(\.\d+){3}$/.test(clean)) return null
  if (clean.endsWith('.vercel.app')) return null

  const labels = clean.split('.')
  // A bare apex (pracscriber.com) has two labels and no subdomain to read.
  if (labels.length < 3) return null

  const slug = labels[0]!
  if (RESERVED_SUBDOMAINS.has(slug)) return null
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(slug) ? slug : null
}

/**
 * Normalises what an admin typed into a usable subdomain label, or null if
 * nothing usable survives. Deliberately strict: this ends up in a hostname,
 * and a hostname that only mostly works is worse than a rejected one.
 */
export function normaliseSlug(input: string): string | null {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '')
  if (slug.length < 2) return null
  if (RESERVED_SUBDOMAINS.has(slug)) return null
  return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : null
}
