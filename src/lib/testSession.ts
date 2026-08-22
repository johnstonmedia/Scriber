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
  limit,
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
import type { OrgPaper } from './org'
import type { ExtractedQuestion } from './questionSplit'

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
  /** Epoch ms this test is scheduled to run — null means no fixed time. */
  scheduledAt: number | null
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
  /** Set by a teacher, never the student themselves — see pauseParticipant. */
  paused: boolean
  /** Epoch ms the pause lifts on its own — null means it waits for the teacher to resume it manually. */
  pauseEndsAt: number | null
  pausedBy: string | null
  /** Whether this student's screen is being shared with the supervisor right now. */
  sharing: boolean
  /**
   * What the supervision extension can see and the page cannot: the other
   * tabs this student has open. Null when no extension is reporting — which
   * is itself worth showing a supervisor, since it means the tab list is
   * simply unknown rather than empty.
   */
  extension: {
    focused: boolean
    tabCount: number
    otherTabs: { title: string; host: string; active: boolean }[]
    seenAt: string | null
  } | null
}

/** How long before a test's scheduled time a student may enter the waiting room. */
export const JOIN_WINDOW_MS = 5 * 60_000

export type IntegrityAlertType =
  | 'tab-hidden'
  | 'focus-lost'
  | 'copy'
  | 'paste'
  | 'cut'
  | 'devtools-shortcut'
  | 'devtools-suspected'
  | 'context-menu'
  | 'screen-share-stopped'
  /** Raised by the supervision extension, which can see what the page cannot. */
  | 'other-tab-opened'

export type IntegrityAlert = {
  id: string
  uid: string
  name: string
  type: IntegrityAlertType
  detail: string | null
  at: string
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
/**
 * The test's paper, snapshotted into a doc security rules can gate on the
 * test's own phase — never the general org papers library, which any member
 * can read any time. See firestore.rules: unreadable by students until the
 * test leaves the lobby.
 */
const securePaperDoc = (orgId: string, testId: string) =>
  doc(db, 'organisations', orgId, 'tests', testId, 'secure', 'paper')
const alertsRef = (orgId: string, testId: string) =>
  collection(db, 'organisations', orgId, 'tests', testId, 'alerts')

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
    scheduledAt: typeof data.scheduledAt === 'number' ? data.scheduledAt : null,
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
    paused: data.paused === true,
    pauseEndsAt: typeof data.pauseEndsAt === 'number' ? data.pauseEndsAt : null,
    pausedBy: typeof data.pausedBy === 'string' ? data.pausedBy : null,
    sharing: data.sharing === true,
    extension: data.extension?.connected
      ? {
          focused: data.extension.focused === true,
          tabCount: Number(data.extension.tabCount ?? 0),
          otherTabs: Array.isArray(data.extension.otherTabs)
            ? data.extension.otherTabs.map((tab: Record<string, unknown>) => ({
                title: String(tab?.title ?? ''),
                host: String(tab?.host ?? ''),
                active: tab?.active === true,
              }))
            : [],
          seenAt: data.extension.seenAt ? isoOf(data.extension.seenAt) : null,
        }
      : null,
  }
}

function toIntegrityAlert(snapshot: QueryDocumentSnapshot<DocumentData>): IntegrityAlert {
  const data = snapshot.data()
  const knownTypes: IntegrityAlertType[] = [
    'tab-hidden',
    'focus-lost',
    'copy',
    'paste',
    'cut',
    'devtools-shortcut',
    'devtools-suspected',
    'context-menu',
    'screen-share-stopped',
    'other-tab-opened',
  ]
  return {
    id: snapshot.id,
    uid: String(data.uid ?? ''),
    name: String(data.name ?? ''),
    type: knownTypes.includes(data.type) ? data.type : 'focus-lost',
    detail: typeof data.detail === 'string' ? data.detail : null,
    at: isoOf(data.at),
  }
}

/**
 * Creates the test, then — if it has a paper — snapshots that paper's
 * questions into the test's own secure/paper document. The snapshot is the
 * point: students can read the org's papers library at any time, but a test's
 * questions have to stay unreadable until the teacher actually starts it,
 * which only a rule keyed off this test's own phase can enforce.
 */
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
    scheduledAt: number | null
  },
  paper?: OrgPaper | null,
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
  if (paper) {
    await setDoc(doc(db, ref.path, 'secure', 'paper'), {
      title: paper.title,
      questions: paper.questions,
      classQuestions: paper.classQuestions,
    })
  }
  const snapshot = await getDoc(ref)
  return toTestSession(snapshot as QueryDocumentSnapshot<DocumentData>)
}

export type SecureTestPaper = {
  title: string
  questions: ExtractedQuestion[]
  classQuestions: Record<string, string[]>
}

/**
 * The test's questions, readable only once the teacher has started the test
 * (enforced in firestore.rules, not here). Returns null while the test is
 * still in the lobby — a student's client genuinely never receives the text.
 */
export async function getSecureTestPaper(orgId: string, testId: string): Promise<SecureTestPaper | null> {
  const snapshot = await getDoc(securePaperDoc(orgId, testId))
  if (!snapshot.exists()) return null
  const data = snapshot.data()
  return {
    title: String(data.title ?? 'Test paper'),
    questions: Array.isArray(data.questions)
      ? data.questions.map((q: { id?: unknown; index?: unknown; text?: unknown }) => ({
          id: String(q.id ?? ''),
          index: Number(q.index ?? 0),
          text: String(q.text ?? ''),
        }))
      : [],
    classQuestions:
      data.classQuestions && typeof data.classQuestions === 'object'
        ? Object.fromEntries(
            Object.entries(data.classQuestions as Record<string, unknown>).map(([classId, ids]) => [
              classId,
              Array.isArray(ids) ? ids.map(String) : [],
            ]),
          )
        : {},
  }
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

/**
 * One student watching their own row. Deliberately not the roster query
 * above — a student may read only their own participant document, so the
 * roster's collection query would simply be refused for them.
 */
export function subscribeMyParticipant(
  orgId: string,
  testId: string,
  uid: string,
  cb: (participant: TestParticipant | null) => void,
): Unsubscribe {
  return onSnapshot(participantDoc(orgId, testId, uid), (snapshot) =>
    cb(snapshot.exists() ? toTestParticipant(snapshot as QueryDocumentSnapshot<DocumentData>) : null),
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

/** Whether this student's screen is reaching the supervisor right now. */
export async function setParticipantSharing(
  orgId: string,
  testId: string,
  uid: string,
  sharing: boolean,
): Promise<void> {
  await setDoc(participantDoc(orgId, testId, uid), { uid, sharing, updatedAt: serverTimestamp() }, { merge: true })
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

/**
 * A teacher pausing one student — a rest break, a question, a disruption at
 * their desk. Only staff can write this (see firestore.rules): a student
 * cannot pause their own live test, which is the whole point of it living on
 * the participant document rather than in their own browser.
 */
export async function pauseParticipant(
  orgId: string,
  testId: string,
  uid: string,
  by: string,
  minutes: number | null,
): Promise<void> {
  await updateDoc(participantDoc(orgId, testId, uid), {
    paused: true,
    pauseEndsAt: minutes === null ? null : Date.now() + minutes * 60_000,
    pausedBy: by,
  })
}

export async function resumeParticipant(orgId: string, testId: string, uid: string): Promise<void> {
  await updateDoc(participantDoc(orgId, testId, uid), { paused: false, pauseEndsAt: null, pausedBy: null })
}

/**
 * One integrity event from a student's own browser — a lost focus, a copy, a
 * devtools shortcut. Append-only by design: a student may add to their own
 * trail but can never read it back or clear it (see firestore.rules).
 */
export async function logIntegrityAlert(
  orgId: string,
  testId: string,
  alert: { uid: string; name: string; type: IntegrityAlertType; detail?: string },
): Promise<void> {
  await setDoc(doc(alertsRef(orgId, testId)), {
    uid: alert.uid,
    name: alert.name,
    type: alert.type,
    detail: alert.detail ?? null,
    at: serverTimestamp(),
  })
}

/** The teacher's live alert feed — newest first, most recent 50. */
export function subscribeIntegrityAlerts(
  orgId: string,
  testId: string,
  cb: (alerts: IntegrityAlert[]) => void,
): Unsubscribe {
  const q = query(alertsRef(orgId, testId), orderBy('at', 'desc'), limit(50))
  return onSnapshot(q, (snapshot) => cb(snapshot.docs.map(toIntegrityAlert)))
}
