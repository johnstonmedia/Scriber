/**
 * Which school is this subdomain?
 *
 * stpauls.pracscriber.com has to know it belongs to St Paul's before anyone
 * signs in — the sign-in page itself carries the school's name and colours.
 * At that point the visitor has no Firebase session, so the browser cannot
 * read Firestore, and we would not want it to: resolving a subdomain must not
 * require handing an anonymous visitor the list of every school on Scriber.
 *
 * So this route answers exactly one question and returns exactly the public
 * facts needed to brand a login screen. Nothing here is sensitive; everything
 * beyond it still goes through security rules once the person signs in.
 */

import { db } from './_lib/admin.js'
import { slugFromHost } from './_lib/host.js'
import { HttpError, route } from './_lib/http.js'

export default route('GET', async (req) => {
  const raw = typeof req.query.host === 'string' ? req.query.host : req.headers.host
  if (typeof raw !== 'string') throw new HttpError(400, 'no-host')

  const slug = slugFromHost(raw)
  // Not an error — the generic app is a legitimate place to be.
  if (!slug) return { org: null }

  const mapping = await db().collection('orgSlugs').doc(slug).get()
  if (!mapping.exists) return { org: null }

  const orgId = String(mapping.get('orgId'))
  const org = await db().collection('organisations').doc(orgId).get()
  if (!org.exists) return { org: null }

  const branding = (org.get('branding') ?? {}) as Record<string, unknown>
  return {
    org: {
      id: orgId,
      slug,
      name: String(org.get('name') ?? ''),
      branding: {
        accentColor: typeof branding.accentColor === 'string' ? branding.accentColor : '#1F5FD8',
        tagline: typeof branding.tagline === 'string' ? branding.tagline : '',
        logoDataUrl: typeof branding.logoDataUrl === 'string' ? branding.logoDataUrl : null,
      },
    },
  }
})
