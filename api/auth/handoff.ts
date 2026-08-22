/**
 * Carrying a sign-in across subdomains.
 *
 * A Firebase Auth session belongs to one origin. app.pracscriber.com and
 * stpauls.pracscriber.com are different origins, so a student who signs in on
 * one is, as far as the browser is concerned, a stranger on the other — and
 * since Scriber sends people to their own school's subdomain automatically,
 * that would mean signing in twice to get where they were going.
 *
 * So the origin they are leaving asks here for a custom token, and the origin
 * they arrive at exchanges it for a session of its own. Only somebody who can
 * already prove they are signed in can obtain one, and it only ever names the
 * account that asked for it — this hands out nothing the caller did not
 * already have.
 *
 * The token travels in the URL fragment rather than the query string:
 * fragments are never sent to a server and so never reach an access log, and
 * the receiving page clears it as soon as it has been spent.
 */

import { getAuth } from 'firebase-admin/auth'
import { adminApp } from '../_lib/admin.js'
import { requireUser } from '../_lib/auth.js'
import { route } from '../_lib/http.js'

export default route('POST', async (req) => {
  const user = await requireUser(req)
  const token = await getAuth(adminApp()).createCustomToken(user.uid)
  return { token }
})
