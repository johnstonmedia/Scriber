/**
 * Scriber's own public key, for a platform to verify what we send it.
 *
 * The private half lives in LTI_PRIVATE_KEY and never leaves the server. This
 * endpoint is deliberately public and unauthenticated — a public key that
 * needed a credential to fetch would defeat its own purpose, and a school's
 * platform fetches it before any trust relationship exists.
 */

import { createPublicKey } from 'node:crypto'
import { route } from '../_lib/http.js'
import { ltiKeyId, ltiPrivateKey } from '../_lib/ltiKeys.js'

export default route('GET', async () => {
  const publicJwk = createPublicKey(ltiPrivateKey()).export({ format: 'jwk' })
  return {
    keys: [{ ...publicJwk, kid: ltiKeyId(), alg: 'RS256', use: 'sig' }],
  }
})
