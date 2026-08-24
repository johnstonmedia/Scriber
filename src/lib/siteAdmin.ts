/**
 * Platform-wide administration — organisations and accounts, never content.
 *
 * A site admin can see that an organisation and its members exist, rename or
 * remove them, and trigger a password reset — the same things an org's own
 * admin can do, just across every organisation rather than one. They cannot
 * open a student's papers or dictated practice sessions: those collections
 * (users/{uid}/papers, users/{uid}/attempts) grant no site-admin access at
 * all in firestore.rules, on purpose.
 */

import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore'
import { db } from './firebase'
import { listMembers, listOrganisationDirectory, type Organisation } from './org'

export type AccountProfile = {
  uid: string
  email: string
  name: string
  createdAt: string
}

function isoOf(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  if (typeof value === 'string') return value
  return new Date().toISOString()
}

export async function isSiteAdmin(uid: string): Promise<boolean> {
  const snapshot = await getDoc(doc(db, 'siteAdmins', uid))
  return snapshot.exists()
}

export async function listSiteAdmins(): Promise<string[]> {
  const snapshot = await getDocs(collection(db, 'siteAdmins'))
  return snapshot.docs.map((d) => d.id)
}

/** Only an existing site admin can grant the role — enforced by the rules, not just this check. */
export async function grantSiteAdmin(uid: string): Promise<void> {
  await setDoc(doc(db, 'siteAdmins', uid), { grantedAt: new Date().toISOString() })
}

export async function revokeSiteAdmin(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'siteAdmins', uid))
}

const normaliseEmail = (email: string) => email.trim().toLowerCase()

/** Whether this email may create a new organisation — checked against the caller's own email. */
export async function canCreateOrg(email: string): Promise<boolean> {
  if (!email) return false
  const snapshot = await getDoc(doc(db, 'orgCreators', normaliseEmail(email)))
  return snapshot.exists()
}

export async function listOrgCreators(): Promise<string[]> {
  const snapshot = await getDocs(collection(db, 'orgCreators'))
  return snapshot.docs.map((d) => d.id)
}

/** Only an existing site admin can grant this — enforced by the rules, not just this check. */
export async function grantOrgCreator(email: string, grantedBy: string): Promise<void> {
  await setDoc(doc(db, 'orgCreators', normaliseEmail(email)), {
    email: normaliseEmail(email),
    grantedBy,
    grantedAt: new Date().toISOString(),
  })
}

export async function revokeOrgCreator(email: string): Promise<void> {
  await deleteDoc(doc(db, 'orgCreators', normaliseEmail(email)))
}

/**
 * Who may open the calibration tab.
 *
 * Teaching the writer somebody's speech is not finished work: it asks a
 * student to read aloud into a microphone and then changes how their exam
 * practice is punctuated, and getting it wrong is worse than not having it.
 * So it goes to people we have actually spoken to, one at a time, the same
 * way organisation creation does — an email on a list, granted by a site
 * admin, revocable.
 */
export async function canCalibrate(email: string): Promise<boolean> {
  if (!email) return false
  const snapshot = await getDoc(doc(db, 'calibrationTesters', normaliseEmail(email)))
  return snapshot.exists()
}

export async function listCalibrationTesters(): Promise<string[]> {
  const snapshot = await getDocs(collection(db, 'calibrationTesters'))
  return snapshot.docs.map((d) => d.id)
}

export async function grantCalibration(email: string, grantedBy: string): Promise<void> {
  await setDoc(doc(db, 'calibrationTesters', normaliseEmail(email)), {
    email: normaliseEmail(email),
    grantedBy,
    grantedAt: new Date().toISOString(),
  })
}

export async function revokeCalibration(email: string): Promise<void> {
  await deleteDoc(doc(db, 'calibrationTesters', normaliseEmail(email)))
}

export async function getAccountProfile(uid: string): Promise<AccountProfile | null> {
  const snapshot = await getDoc(doc(db, 'users', uid))
  if (!snapshot.exists()) return null
  const data = snapshot.data()
  return {
    uid,
    email: String(data.email ?? ''),
    name: String(data.name ?? ''),
    createdAt: isoOf(data.createdAt),
  }
}

export type OrganisationSummary = Organisation & { memberCount: number }

export async function listOrganisationsWithCounts(): Promise<OrganisationSummary[]> {
  const orgs = await listOrganisationDirectory()
  return Promise.all(
    orgs.map(async (org) => {
      const count = await getCountFromServer(collection(db, 'organisations', org.id, 'members'))
      return { ...org, memberCount: count.data().count }
    }),
  )
}

export async function deleteOrganisation(orgId: string): Promise<void> {
  // Firestore doesn't cascade-delete subcollections — members, classes,
  // invites and papers are removed first so nothing is left orphaned and
  // unreadable once the parent org doc is gone.
  const members = await listMembers(orgId)
  await Promise.all(members.map((m) => deleteDoc(doc(db, 'organisations', orgId, 'members', m.uid))))

  for (const sub of ['classes', 'invites', 'joinRequests', 'papers']) {
    const snapshot = await getDocs(collection(db, 'organisations', orgId, sub))
    await Promise.all(snapshot.docs.map((d) => deleteDoc(d.ref)))
  }

  await deleteDoc(doc(db, 'organisations', orgId))
}
