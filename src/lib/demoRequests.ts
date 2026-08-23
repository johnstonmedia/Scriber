/**
 * A school asking to see Scriber properly.
 *
 * The form sits on the public site and is filled in by someone with no
 * account — a head of learning support, usually — so a request is written
 * straight to Firestore without signing in. That is safe because the
 * collection is write-only from outside: firestore.rules lets anyone create a
 * request with these fields and nothing else, and lets nobody but a site
 * admin read one back. Filing a request therefore exposes nothing, and the
 * queue is not browsable.
 *
 * Writing direct rather than through the API is deliberate. This is the first
 * thing a school ever touches, and it should keep working whenever Firestore
 * does, without depending on a serverless function being warm.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from './firebase'

export type DemoRequestStatus = 'new' | 'contacted' | 'approved' | 'declined'

export type DemoRequest = {
  id: string
  organisation: string
  contactName: string
  email: string
  role: string
  students: string
  message: string
  createdAt: string
  status: DemoRequestStatus
  /** Set once a site admin has turned this into a real organisation. */
  orgId: string | null
  handledBy: string | null
}

/**
 * Field limits, enforced again in firestore.rules. An unauthenticated write
 * path has to have a ceiling or it is free storage for anybody who finds it.
 */
export const DEMO_REQUEST_LIMITS = {
  organisation: 120,
  contactName: 120,
  email: 200,
  role: 120,
  students: 60,
  message: 1500,
} as const

const requestsRef = collection(db, 'demoRequests')

const isoOf = (value: unknown): string => {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return typeof value === 'string' ? value : new Date().toISOString()
}

function toRequest(snapshot: QueryDocumentSnapshot<DocumentData>): DemoRequest {
  const data = snapshot.data()
  const status = data.status
  return {
    id: snapshot.id,
    organisation: String(data.organisation ?? ''),
    contactName: String(data.contactName ?? ''),
    email: String(data.email ?? ''),
    role: String(data.role ?? ''),
    students: String(data.students ?? ''),
    message: String(data.message ?? ''),
    createdAt: isoOf(data.createdAt),
    status:
      status === 'contacted' || status === 'approved' || status === 'declined'
        ? status
        : 'new',
    orgId: typeof data.orgId === 'string' && data.orgId ? data.orgId : null,
    handledBy: typeof data.handledBy === 'string' && data.handledBy ? data.handledBy : null,
  }
}

export type DemoRequestDraft = {
  organisation: string
  contactName: string
  email: string
  role: string
  students: string
  message: string
}

/** Trimmed and clipped to the limits above before it leaves the browser. */
export function normaliseDraft(draft: DemoRequestDraft): DemoRequestDraft {
  const clip = (value: string, max: number) => value.trim().slice(0, max)
  return {
    organisation: clip(draft.organisation, DEMO_REQUEST_LIMITS.organisation),
    contactName: clip(draft.contactName, DEMO_REQUEST_LIMITS.contactName),
    email: clip(draft.email, DEMO_REQUEST_LIMITS.email).toLowerCase(),
    role: clip(draft.role, DEMO_REQUEST_LIMITS.role),
    students: clip(draft.students, DEMO_REQUEST_LIMITS.students),
    message: clip(draft.message, DEMO_REQUEST_LIMITS.message),
  }
}

/** The first three are what we actually need to get back to somebody. */
export function draftProblem(draft: DemoRequestDraft): string | null {
  if (!draft.organisation) return 'Please tell us which school or organisation this is for.'
  if (!draft.contactName) return 'Please tell us your name.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) return 'Please check that email address.'
  return null
}

export async function submitDemoRequest(draft: DemoRequestDraft): Promise<void> {
  const clean = normaliseDraft(draft)
  const problem = draftProblem(clean)
  if (problem) throw new Error(problem)
  await addDoc(requestsRef, {
    ...clean,
    status: 'new',
    orgId: null,
    handledBy: null,
    createdAt: serverTimestamp(),
  })
}

/** Site admin only — the rules refuse this read to everybody else. */
export async function listDemoRequests(): Promise<DemoRequest[]> {
  const snapshot = await getDocs(query(requestsRef, orderBy('createdAt', 'desc')))
  return snapshot.docs.map(toRequest)
}

export async function setDemoRequestStatus(
  id: string,
  status: DemoRequestStatus,
  handledBy: string,
  orgId?: string,
): Promise<void> {
  await updateDoc(doc(requestsRef, id), {
    status,
    handledBy,
    ...(orgId ? { orgId } : {}),
  })
}

export async function deleteDemoRequest(id: string): Promise<void> {
  await deleteDoc(doc(requestsRef, id))
}
