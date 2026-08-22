/**
 * The Firebase Admin app, shared by every API route.
 *
 * The browser talks to Firestore directly for almost everything — security
 * rules are the authority there, and that hasn't changed. These routes exist
 * only for the handful of jobs a browser genuinely cannot do:
 *
 *  - answering before anyone is signed in (which school is this subdomain?),
 *  - trusting a caller that has no Firebase session at all (the extension).
 *
 * Serverless functions are reused between invocations, so initialise once and
 * hold it.
 */

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

let cached: App | undefined

function credentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is not set. Add the service account JSON to the ' +
        'Vercel project environment before deploying the API routes.',
    )
  }
  // Accept either the raw JSON or a base64 blob of it — pasting multi-line
  // JSON into a dashboard field goes wrong often enough to be worth allowing
  // both.
  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
  const parsed = JSON.parse(json) as { project_id: string; client_email: string; private_key: string }
  return cert({
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    // Dashboard env vars turn real newlines into the two characters \ and n.
    privateKey: parsed.private_key.replace(/\\n/g, '\n'),
  })
}

export function adminApp(): App {
  if (cached) return cached
  cached = getApps()[0] ?? initializeApp({ credential: credentials() })
  return cached
}

export function db(): Firestore {
  return getFirestore(adminApp())
}
