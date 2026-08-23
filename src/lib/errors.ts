/**
 * What a user sees when something breaks, and what we see.
 *
 * Most people cannot act on "the query requires an index" or "permission
 * denied" — telling them to deploy a rules file is worse than telling them
 * nothing, because it reads as their fault. So a failure shows them a short
 * code and an offer to ask for help, and nothing else. The code is the
 * shared handle: they read it out, and the table below says what it means.
 *
 * The diagnosis stays here, out of the interface. `describe()` is for us —
 * it is never rendered to a user.
 */

import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

export type ErrorCode =
  | 'SCR-100'
  | 'SCR-101'
  | 'SCR-110'
  | 'SCR-200'
  | 'SCR-201'
  | 'SCR-210'
  | 'SCR-300'
  | 'SCR-301'
  | 'SCR-310'
  | 'SCR-400'
  | 'SCR-401'
  | 'SCR-410'
  | 'SCR-420'
  | 'SCR-500'
  | 'SCR-900'

const CAUSES: Record<ErrorCode, string> = {
  'SCR-100': 'Sign-in failed — bad credentials, or the account does not exist.',
  'SCR-101': 'Account creation failed — email already in use, or a weak password.',
  'SCR-110': 'Verification email could not be sent — likely rate-limited by Firebase Auth.',
  'SCR-200': 'Organisation state failed to load. Usually a missing Firestore index (members/invites) or rules not deployed.',
  'SCR-201': 'Organisation write refused. Caller lacks the role the rules require, or rules are not deployed.',
  'SCR-210': 'Join request query failed — the joinRequests composite index (status + requestedAt) is missing.',
  'SCR-300': 'Paper distribution failed — extraction produced no text, or the Firestore write was refused.',
  'SCR-301': 'A paper could not be loaded from Firestore.',
  'SCR-310': 'Logo could not be embedded — image too large after compression, or an unreadable format.',
  'SCR-400': 'Test session write failed — teacher role missing, or rules not deployed.',
  'SCR-401': 'Test paper unreadable. Expected before the teacher starts the test; a real fault if the test is running.',
  'SCR-410': 'Integrity alert could not be written — the alerts rule is missing or the student is no longer a member.',
  'SCR-420':
    'Extension pairing failed server-side. Almost always FIREBASE_SERVICE_ACCOUNT missing or malformed on the deployment, so requireUser cannot verify the ID token.',
  'SCR-500': 'A practice session could not be saved — Firestore unreachable or offline.',
  'SCR-900': 'Unclassified failure. Check the console trace attached to the report.',
}

/** For us, never for the interface. */
export const describe = (code: ErrorCode) => CAUSES[code]

export type AppError = {
  code: ErrorCode
  /** The underlying failure, kept for a support report — never displayed. */
  cause: unknown
}

export const appError = (code: ErrorCode, cause?: unknown): AppError => ({ code, cause })

/** The only sentence a user is shown. Deliberately says nothing about fixing it. */
export const userMessage = (code: ErrorCode) =>
  `Something went wrong on our end (${code}). You don't need to do anything — send a report and we'll look into it.`

/**
 * A user asking for help. Write-only from their side: they can file one and
 * never read the queue back (see firestore.rules), so a report is a way to
 * reach us, not a place anything is exposed.
 */
export async function submitSupportReport(report: {
  code: ErrorCode
  uid: string | null
  email: string | null
  path: string
  cause?: unknown
}): Promise<void> {
  await addDoc(collection(db, 'supportReports'), {
    code: report.code,
    diagnosis: CAUSES[report.code],
    uid: report.uid,
    email: report.email,
    path: report.path,
    detail: report.cause instanceof Error ? report.cause.message : report.cause ? String(report.cause) : null,
    userAgent: navigator.userAgent,
    at: serverTimestamp(),
  })
}
