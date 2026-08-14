/**
 * Firestore and Storage access.
 *
 * Everything a student owns lives under their own user document:
 *
 *   users/{uid}
 *   users/{uid}/papers/{paperId}
 *   users/{uid}/attempts/{attemptId}
 *
 * which keeps the security rules to a single ownership check (see
 * firestore.rules). Uploaded papers go to storage under the same uid prefix.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from 'firebase/storage'
import { db, storage } from './firebase'

export type Paper = {
  id: string
  title: string
  subject: string | null
  year: number | null
  readingMinutes: number
  workingMinutes: number
  fileName: string
  mimeType: string
  byteSize: number
  storagePath: string
  downloadUrl: string
  createdAt: string
}

export type AttemptStats = {
  words?: number
  sentences?: number
  punctuationMarks?: number
  paragraphs?: number
  corrections?: number
  readBacks?: number
  assistedInsertions?: number
  commandCounts?: Record<string, number>
}

export type Attempt = {
  id: string
  paperId: string | null
  title: string
  ruleProfile: 'strict' | 'assisted'
  answerText: string
  atoms: unknown[]
  log: unknown[]
  stats: AttemptStats
  durationMs: number
  status: 'in_progress' | 'finished'
  createdAt: string
  updatedAt: string
}

const papersRef = (uid: string) => collection(db, 'users', uid, 'papers')
const attemptsRef = (uid: string) => collection(db, 'users', uid, 'attempts')

/** Firestore timestamps arrive as objects; the UI only ever wants a string. */
function isoOf(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  if (typeof value === 'string') return value
  return new Date().toISOString()
}

function toPaper(snapshot: QueryDocumentSnapshot<DocumentData>): Paper {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    title: String(data.title ?? 'Untitled paper'),
    subject: data.subject ?? null,
    year: data.year ?? null,
    readingMinutes: Number(data.readingMinutes ?? 5),
    workingMinutes: Number(data.workingMinutes ?? 120),
    fileName: String(data.fileName ?? ''),
    mimeType: String(data.mimeType ?? 'application/pdf'),
    byteSize: Number(data.byteSize ?? 0),
    storagePath: String(data.storagePath ?? ''),
    downloadUrl: String(data.downloadUrl ?? ''),
    createdAt: isoOf(data.createdAt),
  }
}

function toAttempt(snapshot: QueryDocumentSnapshot<DocumentData>): Attempt {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    paperId: data.paperId ?? null,
    title: String(data.title ?? 'Practice session'),
    ruleProfile: data.ruleProfile === 'assisted' ? 'assisted' : 'strict',
    answerText: String(data.answerText ?? ''),
    atoms: Array.isArray(data.atoms) ? data.atoms : [],
    log: Array.isArray(data.log) ? data.log : [],
    stats: (data.stats ?? {}) as AttemptStats,
    durationMs: Number(data.durationMs ?? 0),
    status: data.status === 'finished' ? 'finished' : 'in_progress',
    createdAt: isoOf(data.createdAt),
    updatedAt: isoOf(data.updatedAt),
  }
}

// ------------------------------------------------------------------- papers

export async function listPapers(uid: string): Promise<Paper[]> {
  const snapshot = await getDocs(query(papersRef(uid), orderBy('createdAt', 'desc')))
  return snapshot.docs.map(toPaper)
}

export async function getPaper(uid: string, paperId: string): Promise<Paper | null> {
  const snapshot = await getDoc(doc(db, 'users', uid, 'papers', paperId))
  if (!snapshot.exists()) return null
  return toPaper(snapshot as QueryDocumentSnapshot<DocumentData>)
}

export type PaperDraft = {
  title: string
  subject?: string
  year?: number
  readingMinutes: number
  workingMinutes: number
}

export const ACCEPTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
]

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/** Uploads the file, then writes the metadata document. */
export async function createPaper(
  uid: string,
  file: File,
  draft: PaperDraft,
  onProgress?: (fraction: number) => void,
): Promise<Paper> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('Upload a PDF, image, or text file.')
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`That file is too large. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`)
  }

  const paperDoc = doc(papersRef(uid))
  // The name is only ever used as a storage segment, so strip path separators.
  const safeName = file.name.replace(/[/\\]/g, '_').slice(0, 120)
  const storagePath = `users/${uid}/papers/${paperDoc.id}/${safeName}`
  const objectRef = ref(storage, storagePath)

  const task = uploadBytesResumable(objectRef, file, { contentType: file.type })
  await new Promise<void>((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) =>
        onProgress?.(snapshot.totalBytes ? snapshot.bytesTransferred / snapshot.totalBytes : 0),
      reject,
      () => resolve(),
    )
  })

  const downloadUrl = await getDownloadURL(objectRef)

  await setDoc(paperDoc, {
    title: draft.title,
    subject: draft.subject ?? null,
    year: draft.year ?? null,
    readingMinutes: draft.readingMinutes,
    workingMinutes: draft.workingMinutes,
    fileName: safeName,
    mimeType: file.type,
    byteSize: file.size,
    storagePath,
    downloadUrl,
    createdAt: serverTimestamp(),
  })

  const created = await getDoc(paperDoc)
  return toPaper(created as QueryDocumentSnapshot<DocumentData>)
}

export async function deletePaper(uid: string, paper: Paper): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'papers', paper.id))
  if (paper.storagePath) {
    // The metadata is gone either way; a missing object must not fail the delete.
    await deleteObject(ref(storage, paper.storagePath)).catch(() => undefined)
  }
}

// ----------------------------------------------------------------- attempts

export async function listAttempts(uid: string): Promise<Attempt[]> {
  const snapshot = await getDocs(query(attemptsRef(uid), orderBy('createdAt', 'desc')))
  return snapshot.docs.map(toAttempt)
}

export async function getAttempt(uid: string, attemptId: string): Promise<Attempt | null> {
  const snapshot = await getDoc(doc(db, 'users', uid, 'attempts', attemptId))
  if (!snapshot.exists()) return null
  return toAttempt(snapshot as QueryDocumentSnapshot<DocumentData>)
}

export async function createAttempt(
  uid: string,
  draft: { paperId: string | null; title: string; ruleProfile: 'strict' | 'assisted' },
): Promise<string> {
  const attemptDoc = doc(attemptsRef(uid))
  await setDoc(attemptDoc, {
    paperId: draft.paperId,
    title: draft.title,
    ruleProfile: draft.ruleProfile,
    answerText: '',
    atoms: [],
    log: [],
    stats: {},
    durationMs: 0,
    status: 'in_progress',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return attemptDoc.id
}

/** Firestore rejects documents over 1 MiB; stay clear of the edge. */
const MAX_DOC_BYTES = 900_000

/**
 * A long exam answer carries a lot of detail. The finished text is what matters
 * most, so if a session grows past what a Firestore document holds, the replay
 * detail is dropped before the answer itself is ever at risk.
 */
export function trimForFirestore<T extends { answerText?: string; atoms?: unknown[]; log?: unknown[] }>(
  patch: T,
): { patch: T; trimmed: 'none' | 'log' | 'log-and-atoms' } {
  const size = (value: unknown) => new Blob([JSON.stringify(value ?? null)]).size

  if (size(patch) <= MAX_DOC_BYTES) return { patch, trimmed: 'none' }

  const withoutLog = { ...patch, log: [] }
  if (size(withoutLog) <= MAX_DOC_BYTES) return { patch: withoutLog, trimmed: 'log' }

  return { patch: { ...withoutLog, atoms: [] }, trimmed: 'log-and-atoms' }
}

export async function saveAttempt(
  uid: string,
  attemptId: string,
  patch: Partial<Omit<Attempt, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<{ trimmed: 'none' | 'log' | 'log-and-atoms' }> {
  const { patch: safePatch, trimmed } = trimForFirestore(patch)
  await updateDoc(doc(db, 'users', uid, 'attempts', attemptId), {
    ...safePatch,
    updatedAt: serverTimestamp(),
  })
  return { trimmed }
}

export async function deleteAttempt(uid: string, attemptId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'attempts', attemptId))
}
