/**
 * Organisations — schools using Scriber with multiple students and staff.
 *
 * A person can belong to several organisations at once, each with its own
 * role: 'student', 'teacher' or 'admin' (the org's own master admin, not to
 * be confused with the platform-wide site admin in auth.ts). Membership,
 * roles and everything an org manages lives under organisations/{orgId} —
 * see firestore.rules for exactly who can read and write what.
 *
 * A student's own solo practice (users/{uid}/papers, users/{uid}/attempts) is
 * completely untouched by any of this — joining an org only adds to what a
 * student can see, never takes away their private space.
 */

import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth, db, storage } from './firebase'
import type { ExtractedQuestion } from './questionSplit'

export type OrgRole = 'student' | 'teacher' | 'admin'

export type Organisation = {
  id: string
  name: string
  createdAt: string
  createdBy: string
  settings: {
    defaultRuleProfile: 'strict' | 'assisted'
    allowJoinRequests: boolean
  }
}

export type Membership = {
  orgId: string
  orgName: string
  uid: string
  email: string
  name: string
  role: OrgRole
  status: 'active'
  classIds: string[]
  joinedAt: string
}

export type Invite = {
  email: string
  role: OrgRole
  invitedBy: string
  createdAt: string
  status: 'pending' | 'accepted'
  /** Set when a teacher invites straight into one of their classes — folded into acceptance. */
  classId: string | null
}

export type OrgDomain = {
  domain: string
  orgId: string
  orgName: string
  addedBy: string
  addedAt: string
}

export type JoinRequest = {
  uid: string
  email: string
  name: string
  requestedAt: string
  status: 'pending' | 'approved' | 'denied'
}

export type OrgClass = {
  id: string
  name: string
  teacherIds: string[]
  studentIds: string[]
  createdAt: string
}

export type OrgPaper = {
  id: string
  title: string
  subject: string | null
  year: number | null
  readingMinutes: number
  workingMinutes: number
  classIds: string[]
  fileName: string
  mimeType: string
  byteSize: number
  storagePath: string
  uploadedBy: string
  createdAt: string
  /** Questions pattern-split out of the paper's text, if any were found. */
  questions: ExtractedQuestion[]
  /**
   * Which of those questions a given class is assigned. A class with no
   * entry here (or an empty one) sees the paper as a whole, same as before
   * this existed — assigning a subset is opt-in per class.
   */
  classQuestions: Record<string, string[]>
}

function isoOf(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  if (typeof value === 'string') return value
  return new Date().toISOString()
}

const orgDoc = (orgId: string) => doc(db, 'organisations', orgId)
const membersRef = (orgId: string) => collection(db, 'organisations', orgId, 'members')
const invitesRef = (orgId: string) => collection(db, 'organisations', orgId, 'invites')
const joinRequestsRef = (orgId: string) => collection(db, 'organisations', orgId, 'joinRequests')
const classesRef = (orgId: string) => collection(db, 'organisations', orgId, 'classes')
const orgPapersRef = (orgId: string) => collection(db, 'organisations', orgId, 'papers')
const orgDomainsRef = collection(db, 'orgDomains')

/** The part after @, lower-cased — the only thing that identifies a school's domain. */
export const emailDomain = (email: string) => email.trim().toLowerCase().split('@')[1] ?? ''

const normaliseEmail = (email: string) => email.trim().toLowerCase()

function toOrganisation(snapshot: QueryDocumentSnapshot<DocumentData>): Organisation {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    name: String(data.name ?? 'Untitled organisation'),
    createdAt: isoOf(data.createdAt),
    createdBy: String(data.createdBy ?? ''),
    settings: {
      defaultRuleProfile: data.settings?.defaultRuleProfile === 'assisted' ? 'assisted' : 'strict',
      allowJoinRequests: data.settings?.allowJoinRequests !== false,
    },
  }
}

function toMembership(snapshot: QueryDocumentSnapshot<DocumentData>, orgId?: string): Membership {
  const data = snapshot.data()
  return {
    orgId: orgId ?? snapshot.ref.parent.parent?.id ?? '',
    orgName: String(data.orgName ?? ''),
    uid: String(data.uid ?? snapshot.id),
    email: String(data.email ?? ''),
    name: String(data.name ?? ''),
    role: (data.role === 'admin' || data.role === 'teacher' ? data.role : 'student') as OrgRole,
    status: 'active',
    classIds: Array.isArray(data.classIds) ? data.classIds : [],
    joinedAt: isoOf(data.joinedAt),
  }
}

function toInvite(snapshot: QueryDocumentSnapshot<DocumentData>): Invite {
  const data = snapshot.data()
  return {
    email: String(data.email ?? snapshot.id),
    role: (data.role === 'admin' || data.role === 'teacher' ? data.role : 'student') as OrgRole,
    invitedBy: String(data.invitedBy ?? ''),
    createdAt: isoOf(data.createdAt),
    status: data.status === 'accepted' ? 'accepted' : 'pending',
    classId: typeof data.classId === 'string' ? data.classId : null,
  }
}

function toOrgDomain(snapshot: QueryDocumentSnapshot<DocumentData>): OrgDomain {
  const data = snapshot.data()
  return {
    domain: snapshot.id,
    orgId: String(data.orgId ?? ''),
    orgName: String(data.orgName ?? ''),
    addedBy: String(data.addedBy ?? ''),
    addedAt: isoOf(data.addedAt),
  }
}

function toJoinRequest(snapshot: QueryDocumentSnapshot<DocumentData>): JoinRequest {
  const data = snapshot.data()
  return {
    uid: String(data.uid ?? snapshot.id),
    email: String(data.email ?? ''),
    name: String(data.name ?? ''),
    requestedAt: isoOf(data.requestedAt),
    status: data.status === 'approved' || data.status === 'denied' ? data.status : 'pending',
  }
}

function toClass(snapshot: QueryDocumentSnapshot<DocumentData>): OrgClass {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    name: String(data.name ?? 'Untitled class'),
    teacherIds: Array.isArray(data.teacherIds) ? data.teacherIds : [],
    studentIds: Array.isArray(data.studentIds) ? data.studentIds : [],
    createdAt: isoOf(data.createdAt),
  }
}

function toOrgPaper(snapshot: QueryDocumentSnapshot<DocumentData>): OrgPaper {
  const data = snapshot.data()
  const questions: ExtractedQuestion[] = Array.isArray(data.questions)
    ? data.questions
        .filter((q: unknown): q is { id: unknown; index: unknown; text: unknown } => !!q && typeof q === 'object')
        .map((q: { id: unknown; index: unknown; text: unknown }) => ({
          id: String(q.id ?? ''),
          index: Number(q.index ?? 0),
          text: String(q.text ?? ''),
        }))
    : []
  const classQuestions: Record<string, string[]> =
    data.classQuestions && typeof data.classQuestions === 'object'
      ? Object.fromEntries(
          Object.entries(data.classQuestions as Record<string, unknown>).map(([classId, ids]) => [
            classId,
            Array.isArray(ids) ? ids.map(String) : [],
          ]),
        )
      : {}
  return {
    id: snapshot.id,
    title: String(data.title ?? 'Untitled paper'),
    subject: data.subject ?? null,
    year: data.year ?? null,
    readingMinutes: Number(data.readingMinutes ?? 5),
    workingMinutes: Number(data.workingMinutes ?? 120),
    classIds: Array.isArray(data.classIds) ? data.classIds : [],
    fileName: String(data.fileName ?? ''),
    mimeType: String(data.mimeType ?? 'application/pdf'),
    byteSize: Number(data.byteSize ?? 0),
    storagePath: String(data.storagePath ?? ''),
    uploadedBy: String(data.uploadedBy ?? ''),
    createdAt: isoOf(data.createdAt),
    questions,
    classQuestions,
  }
}

// -------------------------------------------------------------- creation

/**
 * Creates the org, then its first membership (the creator, as admin).
 *
 * Deliberately two sequential writes rather than a batch or transaction: the
 * bootstrap security rule for that first membership reads the org doc's
 * createdBy field to confirm the caller is who they say they are — and both
 * batched and transactional writes are validated against the state from
 * *before* any of their writes landed, so the member write would never see
 * the org doc that a batch/transaction claims to have "already" created in
 * the same round trip. A plain second write, after the first has actually
 * committed, is what the rule can see.
 */
export async function createOrganisation(
  uid: string,
  profile: { email: string; name: string },
  name: string,
): Promise<Organisation> {
  const org = orgDoc(crypto.randomUUID())
  await setDoc(org, {
    name: name.trim(),
    createdBy: uid,
    createdAt: serverTimestamp(),
    settings: { defaultRuleProfile: 'strict', allowJoinRequests: true },
  })
  try {
    await setDoc(doc(membersRef(org.id), uid), {
      uid,
      orgName: name.trim(),
      email: profile.email,
      name: profile.name,
      role: 'admin',
      status: 'active',
      classIds: [],
      joinedAt: serverTimestamp(),
    })
  } catch (error) {
    await deleteDoc(org)
    throw error
  }
  const created = await getDoc(org)
  return toOrganisation(created as QueryDocumentSnapshot<DocumentData>)
}

// ------------------------------------------------------------- membership

/** Every organisation this account belongs to, across all of them. */
export async function listMyMemberships(uid: string): Promise<Membership[]> {
  const snapshot = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', uid)))
  return snapshot.docs.map((d) => toMembership(d))
}

export async function getOrganisation(orgId: string): Promise<Organisation | null> {
  const snapshot = await getDoc(orgDoc(orgId))
  if (!snapshot.exists()) return null
  return toOrganisation(snapshot as QueryDocumentSnapshot<DocumentData>)
}

/** An admin renaming the org or changing its settings — the org doc itself, nothing else. */
export async function updateOrganisation(
  orgId: string,
  updates: { name?: string; settings?: Partial<Organisation['settings']> },
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (updates.name !== undefined) patch.name = updates.name.trim()
  if (updates.settings) {
    for (const [key, value] of Object.entries(updates.settings)) {
      patch[`settings.${key}`] = value
    }
  }
  if (Object.keys(patch).length === 0) return
  await updateDoc(orgDoc(orgId), patch)
}

/** For the "request to join" directory — every org a signed-in user may browse. */
export async function listOrganisationDirectory(): Promise<Organisation[]> {
  const snapshot = await getDocs(query(collection(db, 'organisations'), orderBy('name')))
  return snapshot.docs.map(toOrganisation)
}

export async function listMembers(orgId: string): Promise<Membership[]> {
  const snapshot = await getDocs(query(membersRef(orgId), orderBy('name')))
  return snapshot.docs.map((d) => toMembership(d, orgId))
}

export async function getMembership(orgId: string, uid: string): Promise<Membership | null> {
  const snapshot = await getDoc(doc(membersRef(orgId), uid))
  if (!snapshot.exists()) return null
  return toMembership(snapshot as QueryDocumentSnapshot<DocumentData>, orgId)
}

export async function updateMemberRole(orgId: string, uid: string, role: OrgRole): Promise<void> {
  await updateDoc(doc(membersRef(orgId), uid), { role })
}

export async function removeMember(orgId: string, uid: string): Promise<void> {
  await deleteDoc(doc(membersRef(orgId), uid))
}

/** The standard, secure way to reset someone's password: email them a link. */
export async function resetMemberPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email)
}

// ------------------------------------------------------------------ invites

export async function inviteMember(
  orgId: string,
  email: string,
  role: OrgRole,
  invitedBy: string,
  /** Set when a teacher invites straight from a class — folded in on acceptance. */
  classId?: string,
): Promise<void> {
  await setDoc(doc(invitesRef(orgId), normaliseEmail(email)), {
    email: normaliseEmail(email),
    role,
    invitedBy,
    createdAt: serverTimestamp(),
    status: 'pending',
    classId: classId ?? null,
  })
}

export async function listInvites(orgId: string): Promise<Invite[]> {
  const snapshot = await getDocs(query(invitesRef(orgId), orderBy('createdAt', 'desc')))
  return snapshot.docs.map(toInvite)
}

export async function revokeInvite(orgId: string, email: string): Promise<void> {
  await deleteDoc(doc(invitesRef(orgId), normaliseEmail(email)))
}

export type PendingInvite = Invite & { orgId: string; orgName: string }

/** Every organisation that has invited the signed-in account, by email. */
export async function listMyPendingInvites(email: string): Promise<PendingInvite[]> {
  const snapshot = await getDocs(
    query(
      collectionGroup(db, 'invites'),
      where('email', '==', normaliseEmail(email)),
      where('status', '==', 'pending'),
    ),
  )
  const invites = await Promise.all(
    snapshot.docs.map(async (d) => {
      const orgId = d.ref.parent.parent?.id ?? ''
      const org = await getOrganisation(orgId)
      return { ...toInvite(d), orgId, orgName: org?.name ?? 'An organisation' }
    }),
  )
  return invites
}

/** Accept an invite: create the membership, then mark the invite accepted. */
export async function acceptInvite(
  orgId: string,
  profile: { uid: string; email: string; name: string },
): Promise<void> {
  const invite = await getDoc(doc(invitesRef(orgId), normaliseEmail(profile.email)))
  if (!invite.exists() || invite.data().status !== 'pending') {
    throw new Error('That invitation is no longer available.')
  }
  const role = invite.data().role as OrgRole
  const classId = typeof invite.data().classId === 'string' ? (invite.data().classId as string) : null
  const org = await getOrganisation(orgId)

  const batch = writeBatch(db)
  batch.set(doc(membersRef(orgId), profile.uid), {
    uid: profile.uid,
    orgName: org?.name ?? '',
    email: profile.email,
    name: profile.name,
    role,
    status: 'active',
    classIds: [],
    joinedAt: serverTimestamp(),
  })
  batch.update(doc(invitesRef(orgId), normaliseEmail(profile.email)), { status: 'accepted' })
  await batch.commit()

  // A teacher inviting straight from a class carries that class along —
  // folded in as a second step, same as adding an existing member does.
  if (classId) {
    await addStudentToClass(orgId, classId, profile.uid).catch(() => undefined)
  }
}

// ---------------------------------------------------------------- domains

/**
 * An org can register several domains (or subdomains) against itself — a
 * school with separate student/staff domains, or a multi-campus group —
 * each pointing at the same org. Existence of a match is enough to join
 * instantly, no admin approval step: the trust decision already happened
 * when the org registered the domain.
 */
export async function findOrgByDomain(domain: string): Promise<OrgDomain | null> {
  if (!domain) return null
  const snapshot = await getDoc(doc(orgDomainsRef, domain))
  if (!snapshot.exists()) return null
  return toOrgDomain(snapshot as QueryDocumentSnapshot<DocumentData>)
}

export async function listOrgDomains(orgId: string): Promise<OrgDomain[]> {
  const snapshot = await getDocs(query(orgDomainsRef, where('orgId', '==', orgId)))
  return snapshot.docs.map(toOrgDomain)
}

export async function addOrgDomain(
  orgId: string,
  orgName: string,
  domain: string,
  addedBy: string,
): Promise<void> {
  await setDoc(doc(orgDomainsRef, domain.trim().toLowerCase()), {
    orgId,
    orgName,
    addedBy,
    addedAt: serverTimestamp(),
  })
}

export async function removeOrgDomain(domain: string): Promise<void> {
  await deleteDoc(doc(orgDomainsRef, domain))
}

/**
 * Joins the org registered against this account's email domain, as an
 * active student — the rules require a verified email for this, matching
 * every other organisation action.
 */
export async function joinByDomain(
  orgId: string,
  profile: { uid: string; email: string; name: string },
): Promise<void> {
  const org = await getOrganisation(orgId)
  await setDoc(doc(membersRef(orgId), profile.uid), {
    uid: profile.uid,
    orgName: org?.name ?? '',
    email: profile.email,
    name: profile.name,
    role: 'student',
    status: 'active',
    classIds: [],
    joinedAt: serverTimestamp(),
  })
}

// -------------------------------------------------------------- join requests

export async function requestToJoin(
  orgId: string,
  profile: { uid: string; email: string; name: string },
): Promise<void> {
  await setDoc(doc(joinRequestsRef(orgId), profile.uid), {
    uid: profile.uid,
    email: profile.email,
    name: profile.name,
    requestedAt: serverTimestamp(),
    status: 'pending',
  })
}

export async function withdrawJoinRequest(orgId: string, uid: string): Promise<void> {
  await deleteDoc(doc(joinRequestsRef(orgId), uid))
}

export async function listJoinRequests(orgId: string): Promise<JoinRequest[]> {
  const snapshot = await getDocs(
    query(joinRequestsRef(orgId), where('status', '==', 'pending'), orderBy('requestedAt')),
  )
  return snapshot.docs.map(toJoinRequest)
}

export async function approveJoinRequest(
  orgId: string,
  request: JoinRequest,
  role: OrgRole = 'student',
): Promise<void> {
  const org = await getOrganisation(orgId)
  const batch = writeBatch(db)
  batch.set(doc(membersRef(orgId), request.uid), {
    uid: request.uid,
    orgName: org?.name ?? '',
    email: request.email,
    name: request.name,
    role,
    status: 'active',
    classIds: [],
    joinedAt: serverTimestamp(),
  })
  batch.update(doc(joinRequestsRef(orgId), request.uid), { status: 'approved' })
  await batch.commit()
}

export async function denyJoinRequest(orgId: string, uid: string): Promise<void> {
  await updateDoc(doc(joinRequestsRef(orgId), uid), { status: 'denied' })
}

// ---------------------------------------------------------------- classes

export async function createClass(orgId: string, name: string, teacherUid: string): Promise<OrgClass> {
  const classDoc = doc(classesRef(orgId))
  await setDoc(classDoc, {
    name: name.trim(),
    teacherIds: [teacherUid],
    studentIds: [],
    createdAt: serverTimestamp(),
    createdBy: teacherUid,
  })
  const created = await getDoc(classDoc)
  return toClass(created as QueryDocumentSnapshot<DocumentData>)
}

/** All classes a teacher or admin may manage — i.e. every class in the org. */
export async function listAllClasses(orgId: string): Promise<OrgClass[]> {
  const snapshot = await getDocs(query(classesRef(orgId), orderBy('name')))
  return snapshot.docs.map(toClass)
}

export async function getClass(orgId: string, classId: string): Promise<OrgClass | null> {
  const snapshot = await getDoc(doc(classesRef(orgId), classId))
  if (!snapshot.exists()) return null
  return toClass(snapshot as QueryDocumentSnapshot<DocumentData>)
}

/** Only the classes a student belongs to — matches what the rules allow them to read. */
export async function listMyClasses(orgId: string, uid: string): Promise<OrgClass[]> {
  const snapshot = await getDocs(
    query(classesRef(orgId), where('studentIds', 'array-contains', uid)),
  )
  return snapshot.docs.map(toClass)
}

export async function addStudentToClass(orgId: string, classId: string, uid: string): Promise<void> {
  const classSnap = await getDoc(doc(classesRef(orgId), classId))
  if (!classSnap.exists()) throw new Error('Class not found.')
  const studentIds = new Set(toClass(classSnap as QueryDocumentSnapshot<DocumentData>).studentIds)
  studentIds.add(uid)
  await updateDoc(doc(classesRef(orgId), classId), { studentIds: [...studentIds] })

  const memberSnap = await getDoc(doc(membersRef(orgId), uid))
  if (memberSnap.exists()) {
    const classIds = new Set(toMembership(memberSnap as QueryDocumentSnapshot<DocumentData>, orgId).classIds)
    classIds.add(classId)
    await updateDoc(doc(membersRef(orgId), uid), { classIds: [...classIds] })
  }
}

export async function removeStudentFromClass(orgId: string, classId: string, uid: string): Promise<void> {
  const classSnap = await getDoc(doc(classesRef(orgId), classId))
  if (!classSnap.exists()) return
  const studentIds = toClass(classSnap as QueryDocumentSnapshot<DocumentData>).studentIds.filter(
    (id) => id !== uid,
  )
  await updateDoc(doc(classesRef(orgId), classId), { studentIds })

  const memberSnap = await getDoc(doc(membersRef(orgId), uid))
  if (memberSnap.exists()) {
    const classIds = toMembership(memberSnap as QueryDocumentSnapshot<DocumentData>, orgId).classIds.filter(
      (id) => id !== classId,
    )
    await updateDoc(doc(membersRef(orgId), uid), { classIds })
  }
}

export async function deleteClass(orgId: string, classId: string): Promise<void> {
  await deleteDoc(doc(classesRef(orgId), classId))
}

// ------------------------------------------------------- distributed papers

export const ORG_ACCEPTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
]
export const ORG_MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export type OrgPaperDraft = {
  title: string
  subject?: string
  year?: number
  readingMinutes: number
  workingMinutes: number
  classIds: string[]
  questions?: ExtractedQuestion[]
}

/**
 * Unlike a student's own papers, a distributed paper has to be reachable by
 * every student it's assigned to, so this one genuinely uploads to Cloud
 * Storage rather than staying local.
 */
export async function uploadOrgPaper(
  orgId: string,
  uploaderUid: string,
  file: File,
  draft: OrgPaperDraft,
): Promise<OrgPaper> {
  if (!ORG_ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('Upload a PDF, image, or text file.')
  }
  if (file.size > ORG_MAX_UPLOAD_BYTES) {
    throw new Error(`That file is too large. The limit is ${ORG_MAX_UPLOAD_BYTES / 1024 / 1024} MB.`)
  }

  const paperDoc = doc(orgPapersRef(orgId))
  const safeName = file.name.replace(/[/\\]/g, '_').slice(0, 120)
  const storagePath = `organisations/${orgId}/papers/${paperDoc.id}/${safeName}`

  await uploadBytes(ref(storage, storagePath), file, { contentType: file.type })

  await setDoc(paperDoc, {
    title: draft.title,
    subject: draft.subject ?? null,
    year: draft.year ?? null,
    readingMinutes: draft.readingMinutes,
    workingMinutes: draft.workingMinutes,
    classIds: draft.classIds,
    fileName: safeName,
    mimeType: file.type,
    byteSize: file.size,
    storagePath,
    uploadedBy: uploaderUid,
    createdAt: serverTimestamp(),
    questions: draft.questions ?? [],
    classQuestions: {},
  })

  const created = await getDoc(paperDoc)
  return toOrgPaper(created as QueryDocumentSnapshot<DocumentData>)
}

export async function listOrgPapers(orgId: string): Promise<OrgPaper[]> {
  const snapshot = await getDocs(query(orgPapersRef(orgId), orderBy('createdAt', 'desc')))
  return snapshot.docs.map(toOrgPaper)
}

export async function getOrgPaper(orgId: string, paperId: string): Promise<OrgPaper | null> {
  const snapshot = await getDoc(doc(orgPapersRef(orgId), paperId))
  if (!snapshot.exists()) return null
  return toOrgPaper(snapshot as QueryDocumentSnapshot<DocumentData>)
}

export async function orgPaperDownloadUrl(paper: OrgPaper): Promise<string> {
  return getDownloadURL(ref(storage, paper.storagePath))
}

export async function deleteOrgPaper(orgId: string, paper: OrgPaper): Promise<void> {
  await deleteDoc(doc(orgPapersRef(orgId), paper.id))
  await deleteObject(ref(storage, paper.storagePath)).catch(() => undefined)
}

/**
 * Assigns a specific subset of a paper's extracted questions to one class.
 * An empty list clears the assignment, returning that class to seeing the
 * whole paper.
 */
export async function setClassQuestions(
  orgId: string,
  paperId: string,
  classId: string,
  questionIds: string[],
): Promise<void> {
  const snapshot = await getDoc(doc(orgPapersRef(orgId), paperId))
  if (!snapshot.exists()) throw new Error('Paper not found.')
  const current = toOrgPaper(snapshot as QueryDocumentSnapshot<DocumentData>).classQuestions
  const next = { ...current }
  if (questionIds.length === 0) {
    delete next[classId]
  } else {
    next[classId] = questionIds
  }
  await updateDoc(doc(orgPapersRef(orgId), paperId), { classQuestions: next })
}
