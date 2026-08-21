/**
 * A live, teacher-run test: created for one class, joined by its students in
 * a waiting room, then moved through reading and working time together, on
 * the teacher's own clock — not each student's. Modelled after NAPLAN-style
 * administration: nobody moves past reading time early, and the teacher can
 * see who's ready and how each student's answer is coming along as they work.
 *
 * organisations/{orgId}/tests/{testId} holds the shared phase and its
 * deadline; organisations/{orgId}/tests/{testId}/participants/{uid} holds
 * each student's own readiness and live progress — visible to themselves and
 * to the teacher who created the test, never to classmates.
 */

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from './firebase'
import type { RuleProfile } from './ruleProfile'

export type TestPhase = 'lobby' | 'reading' | 'working' | 'finished'

export type TestSession = {
  id: string
  orgId: string
  classId: string
  className: string
  paperId: string | null
  title: string
  ruleProfile: RuleProfile
  readingMinutes: number
  workingMinutes: number
  phase: TestPhase
  /** Epoch ms the current phase (reading or working) ends — null in lobby. */
  phaseEndsAt: number | null
  createdBy: string
  createdAt: string
}

export type TestParticipantStatus = 'ready' | 'active' | 'finished'

export type TestParticipant = {
  uid: string
  name: string
  status: TestParticipantStatus
  wordCount: number
  /** The last ~200 characters the student has written, for the teacher's live view. */
  preview: string
  updatedAt: string
}

function isoOf(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  if (typeof value === 'string') return value
  return new Date().toISOString()
}

const testsRef = (orgId: string) => collection(db, 'organisations', orgId, 'tests')
const testDoc = (orgId: string, testId: string) => doc(db, 'organisations', orgId, 'tests', testId)
const participantsRef = (orgId: string, testId: string) =>
  collection(db, 'organisations', orgId, 'tests', testId, 'participants')
const participantDoc = (orgId: string, testId: string, uid: string) =>
  doc(db, 'organisations', orgId, 'tests', testId, 'participants', uid)

function toTestSession(snapshot: QueryDocumentSnapshot<DocumentData>): TestSession {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    orgId: String(data.orgId ?? snapshot.ref.parent.parent?.id ?? ''),
    classId: String(data.classId ?? ''),
    className: String(data.className ?? ''),
    paperId: typeof data.paperId === 'string' ? data.paperId : null,
    title: String(data.title ?? 'Test'),
    ruleProfile: data.ruleProfile === 'assisted' ? 'assisted' : 'strict',
    readingMinutes: Number(data.readingMinutes ?? 10),
    workingMinutes: Number(data.workingMinutes ?? 40),
    phase: ['lobby', 'reading', 'working', 'finished'].includes(data.phase) ? data.phase : 'lobby',
    phaseEndsAt: typeof data.phaseEndsAt === 'number' ? data.phaseEndsAt : null,
    createdBy: String(data.createdBy ?? ''),
    createdAt: isoOf(data.createdAt),
  }
}

function toTestParticipant(snapshot: QueryDocumentSnapshot<DocumentData>): TestParticipant {
  const data = snapshot.data()
  return {
    uid: String(data.uid ?? snapshot.id),
    name: String(data.name ?? ''),
    status: data.status === 'active' || data.status === 'finished' ? data.status : 'ready',
    wordCount: Number(data.wordCount ?? 0),
    preview: String(data.preview ?? ''),
    updatedAt: isoOf(data.updatedAt),
  }
}

export async function createTestSession(
  orgId: string,
  createdBy: string,
  test: {
    classId: string
    className: string
    paperId: string | null
    title: string
    ruleProfile: RuleProfile
    readingMinutes: number
    workingMinutes: number
  },
): Promise<TestSession> {
  const ref = doc(testsRef(orgId))
  await setDoc(ref, {
    orgId,
    ...test,
    phase: 'lobby',
    phaseEndsAt: null,
    createdBy,
    createdAt: serverTimestamp(),
  })
  const snapshot = await getDoc(ref)
  return toTestSession(snapshot as QueryDocumentSnapshot<DocumentData>)
}

/** Every test ever run for a class, most recent first — the teacher's own list. */
export function subscribeClassTests(
  orgId: string,
  classId: string,
  cb: (tests: TestSession[]) => void,
): Unsubscribe {
  const q = query(testsRef(orgId), where('classId', '==', classId), orderBy('createdAt', 'desc'))
  return onSnapshot(q, (snapshot) => cb(snapshot.docs.map(toTestSession)))
}

/**
 * Every not-yet-finished test across every class a student belongs to, in
 * any of their organisations — the "upcoming tasks" the homepage surfaces.
 * One live query per organisation (classId 'in' covers every class within
 * it at once), merged as each updates.
 */
export function subscribeUpcomingTests(
  memberships: { orgId: string; orgName: string; classIds: string[] }[],
  cb: (tests: (TestSession & { orgName: string })[]) => void,
): Unsubscribe {
  const byOrg = new Map<string, (TestSession & { orgName: string })[]>()
  const emit = () => cb([...byOrg.values()].flat().filter((t) => t.phase !== 'finished'))
  const unsubs = memberships
    .filter((m) => m.classIds.length > 0)
    .map((m) => {
      const q = query(testsRef(m.orgId), where('classId', 'in', m.classIds.slice(0, 30)))
      return onSnapshot(q, (snapshot) => {
        byOrg.set(
          m.orgId,
          snapshot.docs.map((d) => ({ ...toTestSession(d), orgName: m.orgName })),
        )
        emit()
      })
    })
  return () => unsubs.forEach((unsub) => unsub())
}

export function subscribeTestSession(
  orgId: string,
  testId: string,
  cb: (test: TestSession | null) => void,
): Unsubscribe {
  return onSnapshot(testDoc(orgId, testId), (snapshot) =>
    cb(snapshot.exists() ? toTestSession(snapshot as QueryDocumentSnapshot<DocumentData>) : null),
  )
}

export function subscribeTestParticipants(
  orgId: string,
  testId: string,
  cb: (participants: TestParticipant[]) => void,
): Unsubscribe {
  const q = query(participantsRef(orgId, testId), orderBy('name'))
  return onSnapshot(q, (snapshot) => cb(snapshot.docs.map(toTestParticipant)))
}

/** A student arrives in the waiting room. */
export async function joinTestSession(
  orgId: string,
  testId: string,
  profile: { uid: string; name: string },
): Promise<void> {
  await setDoc(
    participantDoc(orgId, testId, profile.uid),
    { uid: profile.uid, name: profile.name, status: 'ready', wordCount: 0, preview: '', updatedAt: serverTimestamp() },
    { merge: true },
  )
}

export async function startReading(orgId: string, testId: string, readingMinutes: number): Promise<void> {
  await updateDoc(testDoc(orgId, testId), {
    phase: 'reading',
    phaseEndsAt: Date.now() + readingMinutes * 60_000,
  })
}

export async function startWorking(orgId: string, testId: string, workingMinutes: number): Promise<void> {
  await updateDoc(testDoc(orgId, testId), {
    phase: 'working',
    phaseEndsAt: Date.now() + workingMinutes * 60_000,
  })
}

export async function finishTestSession(orgId: string, testId: string): Promise<void> {
  await updateDoc(testDoc(orgId, testId), { phase: 'finished', phaseEndsAt: null })
}

/** Throttled by the caller — every ~8s while a student is actively working, not on every word. */
export async function updateTestProgress(
  orgId: string,
  testId: string,
  uid: string,
  progress: { wordCount: number; preview: string },
): Promise<void> {
  await setDoc(
    participantDoc(orgId, testId, uid),
    { status: 'active', ...progress, updatedAt: serverTimestamp() },
    { merge: true },
  )
}

export async function finishTestParticipant(orgId: string, testId: string, uid: string): Promise<void> {
  await updateDoc(participantDoc(orgId, testId, uid), { status: 'finished', updatedAt: serverTimestamp() })
}
