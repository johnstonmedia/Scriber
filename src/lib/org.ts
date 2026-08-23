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
  getCountFromServer,
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
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth, db } from './firebase'
import { extractQuestions } from './questionExtract'
import type { ExtractedQuestion } from './questionSplit'
import { demoPlan, planOf, seatUsage, seatsFullMessage, type OrgPlan, type SeatUsage } from './seats'

export type OrgRole = 'student' | 'teacher' | 'admin'

export type Organisation = {
  id: string
  name: string
  createdAt: string
  createdBy: string
  /**
   * This school's own subdomain label — stpauls in stpauls.pracscriber.com.
   * Null until an admin claims one. Uniqueness is held by the orgSlugs
   * collection, not by this field.
   */
  slug: string | null
  settings: {
    defaultRuleProfile: 'strict' | 'assisted'
    allowJoinRequests: boolean
    /**
     * What goes at the top of a printed answer. Senior exams are marked
     * anonymously against an exam number, so that a marker holding a stack of
     * papers has nothing to identify the student by; younger years generally
     * hand back by name instead.
     */
    identifyBy: 'examNumber' | 'name'
  }
  /**
   * Shown to students on this org's own page and in a live test. No Storage
   * bucket exists, so a logo (if any) is a small image compressed to a data
   * URL and stored directly on this document — see MAX_LOGO_BYTES below.
   */
  branding: {
    accentColor: string
    tagline: string
    logoDataUrl: string | null
  }
  /** How many students this school is licensed for — see seats.ts. */
  plan: OrgPlan
}

/** A logo is embedded directly in the org document, so it has to stay tiny. */
export const MAX_LOGO_BYTES = 40_000

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
  /**
   * The number this student sits exams under. Set by staff — a student can
   * never set or change their own, since the whole point is that it ties a
   * paper to them without naming them.
   */
  examNumber: string | null
}

export type Invite = {
  email: string
  role: OrgRole
  invitedBy: string
  createdAt: string
  status: 'pending' | 'accepted'
  /** Set when a teacher invites straight into one of their classes — folded into acceptance. */
  classId: string | null
  /**
   * The exam number this student will sit under, set at invite time so it is
   * in place before their first test. Security rules pin the membership's
   * number to this one, so a student can't accept an invite under a number
   * of their own choosing.
   */
  examNumber: string | null
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
  uploadedBy: string
  createdAt: string
  /**
   * The paper's own content, pattern-split into questions — this, not a
   * file, is what students actually see. Nothing about the original upload
   * is kept once this is extracted.
   */
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
    slug: typeof data.slug === 'string' && data.slug ? data.slug : null,
    settings: {
      defaultRuleProfile: data.settings?.defaultRuleProfile === 'assisted' ? 'assisted' : 'strict',
      allowJoinRequests: data.settings?.allowJoinRequests !== false,
      identifyBy: data.settings?.identifyBy === 'name' ? 'name' : 'examNumber',
    },
    branding: {
      accentColor: typeof data.branding?.accentColor === 'string' ? data.branding.accentColor : '#4f7cff',
      tagline: typeof data.branding?.tagline === 'string' ? data.branding.tagline : '',
      logoDataUrl: typeof data.branding?.logoDataUrl === 'string' ? data.branding.logoDataUrl : null,
    },
    plan: planOf(data),
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
    examNumber: typeof data.examNumber === 'string' && data.examNumber ? data.examNumber : null,
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
    examNumber: typeof data.examNumber === 'string' && data.examNumber ? data.examNumber : null,
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
  /**
   * A school starts on a demo unless a site admin licenses it here and now —
   * which is what happens when one is created straight from a demo request
   * that has already been agreed.
   */
  plan: OrgPlan = demoPlan(uid),
): Promise<Organisation> {
  const org = orgDoc(crypto.randomUUID())
  await setDoc(org, {
    name: name.trim(),
    createdBy: uid,
    createdAt: serverTimestamp(),
    slug: null,
    settings: { defaultRuleProfile: 'strict', allowJoinRequests: true, identifyBy: 'examNumber' },
    branding: { accentColor: '#1F5FD8', tagline: '', logoDataUrl: null },
    plan,
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
  updates: {
    name?: string
    settings?: Partial<Organisation['settings']>
    branding?: Partial<Organisation['branding']>
  },
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (updates.name !== undefined) patch.name = updates.name.trim()
  if (updates.settings) {
    for (const [key, value] of Object.entries(updates.settings)) {
      patch[`settings.${key}`] = value
    }
  }
  if (updates.branding) {
    for (const [key, value] of Object.entries(updates.branding)) {
      patch[`branding.${key}`] = value
    }
  }
  if (Object.keys(patch).length === 0) return
  await updateDoc(orgDoc(orgId), patch)
}

/**
 * Subdomain labels the platform keeps for itself. Mirrors the list the
 * backend enforces in api/_lib/host.ts — a school able to claim "api" or
 * "admin" could dress itself up as Scriber. Checked here too so an admin is
 * told no immediately rather than after a failed write.
 */
const RESERVED_SLUGS = new Set([
  'app', 'www', 'api', 'admin', 'help', 'support', 'status', 'mail', 'staging', 'preview', 'dev', 'test',
])

/** Turns what an admin typed into a label that will survive as a hostname. */
export function normaliseSlug(input: string): string | null {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '')
  if (slug.length < 2) return null
  if (RESERVED_SLUGS.has(slug)) return null
  return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : null
}

/**
 * Claims a subdomain for an organisation, releasing whatever it held before.
 *
 * Uniqueness lives in orgSlugs/{slug} rather than in a field on the org: a
 * document ID is the only thing Firestore can make unique across a
 * collection, so claiming one is a create that fails if somebody already
 * holds it. Passing null releases the current slug and claims nothing.
 */
export async function setOrgSlug(orgId: string, requested: string | null): Promise<string | null> {
  const current = (await getDoc(orgDoc(orgId))).get('slug') as string | undefined

  if (requested === null) {
    if (current) await deleteDoc(doc(db, 'orgSlugs', current))
    await updateDoc(orgDoc(orgId), { slug: null })
    return null
  }

  const slug = normaliseSlug(requested)
  if (!slug) {
    throw new Error('Use letters and numbers — at least two, and not a name Scriber reserves.')
  }
  if (slug === current) return slug

  const claim = doc(db, 'orgSlugs', slug)
  if ((await getDoc(claim)).exists()) {
    throw new Error(`${slug} is already taken by another organisation.`)
  }

  await setDoc(claim, { orgId, claimedAt: serverTimestamp() })
  try {
    await updateDoc(orgDoc(orgId), { slug })
  } catch (error) {
    await deleteDoc(claim)
    throw error
  }
  if (current) await deleteDoc(doc(db, 'orgSlugs', current)).catch(() => undefined)
  return slug
}

/** Staff assigning the number a student sits exams under. Never the student. */
export async function setExamNumber(orgId: string, uid: string, examNumber: string | null): Promise<void> {
  await updateDoc(doc(membersRef(orgId), uid), { examNumber: examNumber?.trim() || null })
}

/**
 * Compresses an image file client-side into a small data URL suitable for
 * embedding directly in the org document — there is no Storage bucket to
 * upload it to. Downscales to at most 160px on the long edge and re-encodes
 * as JPEG, which is normally enough to land well under MAX_LOGO_BYTES for a
 * simple logo; throws if it still doesn't fit.
 */
export async function compressLogo(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process that image.')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
  if (dataUrl.length > MAX_LOGO_BYTES) {
    throw new Error('That logo is too detailed to embed — try a simpler, smaller image.')
  }
  return dataUrl
}

/**
 * Every organisation on the platform. Used by the site admin console (which
 * genuinely needs to see everything) and as the backing data for a signed-in
 * user's org search — never rendered as a browsable list on its own, so
 * nobody can see who else is on Scriber just by looking.
 */
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
  // Staff don't take seats, so moving somebody down to student takes one.
  // Somebody who is already a student is holding theirs and doesn't need
  // another — checking would have them fail their own seat.
  const current = await getMembership(orgId, uid)
  if (current?.role !== 'student') await requireSeat(orgId, role)
  await updateDoc(doc(membersRef(orgId), uid), { role })
}

export async function removeMember(orgId: string, uid: string): Promise<void> {
  await deleteDoc(doc(membersRef(orgId), uid))
}

/** The standard, secure way to reset someone's password: email them a link. */
export async function resetMemberPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email)
}

// -------------------------------------------------------------------- seats

/**
 * Counts the roster before letting anybody else in.
 *
 * Deliberately a live count rather than a running total kept on the
 * organisation document: a counter that drifted high would refuse seats a
 * school has actually paid for, and a support call about a school being
 * unable to add the students on its licence is a worse failure than the one
 * a counter would prevent. See seats.ts for what this does and does not
 * guarantee.
 */
export async function getSeatUsage(orgId: string, plan?: OrgPlan): Promise<SeatUsage> {
  const resolved = plan ?? (await getOrganisation(orgId))?.plan ?? planOf(null)
  // Uncapped organisations skip both counts entirely — there is nothing to
  // compare them against, and this runs on every invite screen.
  if (resolved.studentSeats === null) return seatUsage(resolved, 0, 0)
  const [members, invites] = await Promise.all([
    // One equality filter, which Firestore's automatic single-field index
    // already serves — no composite index to create, and nothing that can
    // fail in production while passing here.
    getCountFromServer(query(membersRef(orgId), where('role', '==', 'student'))),
    // Pending invites are read and filtered by role in memory rather than
    // counted with a second equality filter on the server. A two-filter count
    // would need a composite index, and the emulator never enforces a missing
    // one — so that class of mistake only ever surfaces in production, on a
    // path that decides whether a school can add a student. The documents are
    // bounded by the licence (150 at the very top tier), so reading them
    // costs nothing worth having that risk for.
    getDocs(query(invitesRef(orgId), where('status', '==', 'pending'))),
  ])
  const reserved = invites.docs.filter((d) => d.data().role === 'student').length
  return seatUsage(resolved, members.data().count, reserved)
}

/**
 * Thrown when a school is at its licensed number of students. Not an SCR
 * code: it is a true, actionable answer, not a fault, and the person reading
 * it can do something about it.
 */
export class SeatsFullError extends Error {
  readonly usage: SeatUsage
  constructor(usage: SeatUsage, orgName: string) {
    super(seatsFullMessage(usage, orgName))
    this.name = 'SeatsFullError'
    this.usage = usage
  }
}

/**
 * Refuses the write if admitting one more student would go over the licence.
 *
 * `holdsInvite` is for somebody accepting an invitation that already reserved
 * their seat: counting outstanding invites there would have them turned away
 * by their own, so only the roster is compared against the licence.
 */
async function requireSeat(
  orgId: string,
  role: OrgRole,
  options: { holdsInvite?: boolean } = {},
): Promise<void> {
  if (role !== 'student') return
  const org = await getOrganisation(orgId)
  if (!org || org.plan.studentSeats === null) return
  const usage = await getSeatUsage(orgId, org.plan)
  const full = options.holdsInvite ? usage.used >= org.plan.studentSeats : usage.full
  if (full) throw new SeatsFullError(usage, org.name)
}

/** Only a site admin may write a plan — firestore.rules refuses anyone else. */
export async function setOrgPlan(orgId: string, plan: OrgPlan): Promise<void> {
  await updateDoc(orgDoc(orgId), { plan })
}

// ------------------------------------------------------------------ invites

export async function inviteMember(
  orgId: string,
  email: string,
  role: OrgRole,
  invitedBy: string,
  /** Set when a teacher invites straight from a class — folded in on acceptance. */
  classId?: string,
  /** Assigned now so it is in place before the student's first test. */
  examNumber?: string | null,
): Promise<void> {
  // An outstanding invite already holds a seat, so the check happens here
  // rather than only on acceptance — a school should find out it is full
  // while inviting, not leave a student to discover it when they click join.
  await requireSeat(orgId, role)
  await setDoc(doc(invitesRef(orgId), normaliseEmail(email)), {
    email: normaliseEmail(email),
    role,
    invitedBy,
    createdAt: serverTimestamp(),
    status: 'pending',
    classId: classId ?? null,
    examNumber: examNumber?.trim() || null,
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
  // Rules require this to match the invite exactly — see firestore.rules.
  const examNumber = typeof invite.data().examNumber === 'string' ? (invite.data().examNumber as string) : null
  const org = await getOrganisation(orgId)
  // An invite issued while there was room can still outlive the seat, if the
  // school's licence was reduced or somebody else was admitted first.
  await requireSeat(orgId, role, { holdsInvite: true })

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
    examNumber,
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
  await requireSeat(orgId, 'student')
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
  await requireSeat(orgId, role)
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
/**
 * The classes a student is *in*. Not the ones a teacher runs — those are on
 * the class's teacherIds, and a teacher who called this would get an empty
 * list rather than an error. See listClassesITeach.
 */
export async function listMyClasses(orgId: string, uid: string): Promise<OrgClass[]> {
  const snapshot = await getDocs(
    query(classesRef(orgId), where('studentIds', 'array-contains', uid)),
  )
  return snapshot.docs.map(toClass)
}

/** The classes a teacher runs. An admin runs the whole organisation's. */
export async function listClassesITeach(orgId: string, uid: string, role: OrgRole): Promise<OrgClass[]> {
  const all = await listAllClasses(orgId)
  return role === 'admin' ? all : all.filter((c) => c.teacherIds.includes(uid))
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

// Only text-bearing formats — a distributed paper's content is its extracted
// text, not a file, so anything that can't be read as text (a scanned image,
// for instance) has nothing to distribute.
export const ORG_ACCEPTED_TYPES = ['application/pdf', 'text/plain']
export const ORG_MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export type OrgPaperDraft = {
  title: string
  subject?: string
  year?: number
  readingMinutes: number
  workingMinutes: number
  classIds: string[]
}

/**
 * A distributed paper's own file never reaches a server — its text is
 * extracted client-side and that's the entire distributed content, rendered
 * by the site itself (OrgPaperViewer). This keeps organisation distribution
 * on the same footing as a student's own solo papers: no Storage bucket, no
 * Blaze plan, nothing but Firestore and Auth.
 */
export async function distributeOrgPaper(
  orgId: string,
  uploaderUid: string,
  file: File,
  draft: OrgPaperDraft,
): Promise<OrgPaper> {
  if (!ORG_ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('Upload a PDF or text file.')
  }
  if (file.size > ORG_MAX_UPLOAD_BYTES) {
    throw new Error(`That file is too large. The limit is ${ORG_MAX_UPLOAD_BYTES / 1024 / 1024} MB.`)
  }

  const questions = await extractQuestions(file)
  if (questions.length === 0) {
    throw new Error(
      "Could not find any readable text in that file — it may be a scanned image. Try a text-based PDF or a .txt file.",
    )
  }

  const paperDoc = doc(orgPapersRef(orgId))
  await setDoc(paperDoc, {
    title: draft.title,
    subject: draft.subject ?? null,
    year: draft.year ?? null,
    readingMinutes: draft.readingMinutes,
    workingMinutes: draft.workingMinutes,
    classIds: draft.classIds,
    uploadedBy: uploaderUid,
    createdAt: serverTimestamp(),
    questions,
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

export async function deleteOrgPaper(orgId: string, paper: OrgPaper): Promise<void> {
  await deleteDoc(doc(orgPapersRef(orgId), paper.id))
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
