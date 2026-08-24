/**
 * The platforms a school has connected, read from Firestore.
 *
 * Registration is a deliberate act by a Scriber admin — a platform we have
 * never heard of gets a refusal, not a guess. Keyed by issuer, because that is
 * what arrives on the login request before anything has been verified.
 */

import { db } from './admin.js'
import type { LtiPlatform } from './lti.js'

export async function findPlatform(
  issuer: string,
  clientIdHint?: string,
): Promise<LtiPlatform | null> {
  const snapshot = await db().collection('ltiPlatforms').where('issuer', '==', issuer).get()
  if (snapshot.empty) return null
  // One issuer can hold several client ids — a school running Scriber twice
  // on one Schoolbox. The hint disambiguates when the platform sends it.
  const docs = snapshot.docs
  const match =
    (clientIdHint && docs.find((d) => d.get('clientId') === clientIdHint)) ?? docs[0]
  if (!match) return null
  return {
    issuer: String(match.get('issuer')),
    clientId: String(match.get('clientId')),
    deploymentIds: (match.get('deploymentIds') as string[] | undefined) ?? [],
    authLoginUrl: String(match.get('authLoginUrl')),
    jwksUrl: String(match.get('jwksUrl')),
    orgId: String(match.get('orgId')),
  }
}
