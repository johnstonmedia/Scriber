/**
 * Proves the organisation/role rules actually hold — the highest-risk part of
 * the whole feature, since a mistake here leaks one school's data to another,
 * or lets a student grant themselves admin. Run the emulators first:
 *   npm run emulators
 */
import { initializeApp } from 'firebase/app'
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth'
import {
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { initializeApp as initAdminApp, cert as adminCert } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'

const PROJECT_ID = 'demo-scriber'

const app = initializeApp({ apiKey: 'demo', projectId: PROJECT_ID, appId: 'demo' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

// A second, rules-bypassing connection — exactly what a human operator does
// once, by hand, via the Firebase console, to seed the very first site admin.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const adminApp = initAdminApp({ projectId: PROJECT_ID }, 'admin-seed')
const adminDb = getAdminFirestore(adminApp)

const results = []
const check = (name, passed) => {
  results.push({ name, passed })
  console.log(`${passed ? '✓' : '✗ FAIL'}  ${name}`)
}

/**
 * Completes real email verification through the emulator's own oobCode
 * flow — the same mechanism a real "click the link in your email" does —
 * rather than trying to fake the emailVerified flag directly, which the
 * emulator refuses just like production does.
 */
async function verifyEmail(user) {
  const idToken = await user.getIdToken()
  await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'VERIFY_EMAIL', idToken }),
  })
  const oobCodes = await fetch(
    `http://127.0.0.1:9099/emulator/v1/projects/${PROJECT_ID}/oobCodes`,
  ).then((r) => r.json())
  const code = oobCodes.oobCodes.at(-1)?.oobCode
  if (!code) throw new Error(`no oobCode found for ${user.email}`)
  await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oobCode: code }),
  })
  await user.getIdToken(true)
}

/** Every account in this suite represents a real, completed sign-up — verified by default. */
async function account(email) {
  let user
  try {
    user = (await createUserWithEmailAndPassword(auth, email, 'practice123')).user
  } catch {
    user = (await signInWithEmailAndPassword(auth, email, 'practice123')).user
  }
  await verifyEmail(user)
  return user
}

async function denied(label, operation) {
  try {
    await operation()
    check(label, false)
  } catch (error) {
    const code = error?.code ?? ''
    check(label, code === 'permission-denied' || code === 'auth/insufficient-permission')
  }
}

async function allowed(label, operation) {
  try {
    await operation()
    check(label, true)
  } catch (error) {
    console.log(`   (error: ${error?.code ?? error})`)
    check(label, false)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Switching accounts and firing a Firestore request in the same tick can race
 * the SDK's own auth-token propagation, occasionally sending a request that
 * still carries the previous user's credentials. A short settle time after
 * every sign-in avoids that — cheap insurance for a script that switches
 * accounts this often.
 */
async function signInAs(email) {
  await signInWithEmailAndPassword(auth, email, 'practice123')
  await sleep(150)
}

// ---------------------------------------------------------------- accounts

const orgAdmin = await account('orgadmin@school.test')
const teacher = await account('teacher@school.test')
const student = await account('student@school.test')
const outsider = await account('outsider@school.test')
const rivalAdmin = await account('rivaladmin@rival.test')

// -------------------------------------------------------- org A: creation

await denied('a signed-in user with no org-creator grant cannot create an organisation', async () => {
  await signInAs('student@school.test')
  await setDoc(doc(db, 'organisations', 'blocked'), {
    name: 'Should not exist',
    createdBy: student.uid,
    createdAt: new Date().toISOString(),
    settings: {},
  })
})

// Granted exactly as a site admin would from the Site Admin console.
await adminDb.doc('orgCreators/orgadmin@school.test').set({
  email: 'orgadmin@school.test',
  grantedBy: 'test-harness',
  grantedAt: new Date().toISOString(),
})

await account('orgadmin@school.test')
await signInAs('orgadmin@school.test')
const orgAId = 'org-a'
await allowed('a granted org-creator can create an organisation and become its admin', async () => {
  await setDoc(doc(db, 'organisations', orgAId), {
    name: 'School A',
    createdBy: orgAdmin.uid,
    createdAt: new Date().toISOString(),
    settings: { defaultRuleProfile: 'strict', allowJoinRequests: true },
  })
  await setDoc(doc(db, 'organisations', orgAId, 'members', orgAdmin.uid), {
    uid: orgAdmin.uid,
    email: 'orgadmin@school.test',
    name: 'Org Admin',
    role: 'admin',
    status: 'active',
    classIds: [],
    joinedAt: new Date().toISOString(),
  })
})

await denied('creating an org for someone else as createdBy is refused', async () => {
  await signInAs('outsider@school.test')
  await setDoc(doc(db, 'organisations', 'spoofed'), {
    name: 'Spoofed org',
    createdBy: orgAdmin.uid, // not the caller
    createdAt: new Date().toISOString(),
    settings: {},
  })
})

// ---------------------------------------------------- email verification gate

const unverified = (
  await createUserWithEmailAndPassword(auth, 'unverified@school.test', 'practice123')
).user
await adminDb.doc('orgCreators/unverified@school.test').set({
  email: 'unverified@school.test',
  grantedBy: 'test-harness',
  grantedAt: new Date().toISOString(),
})
await denied('an unverified email cannot create an organisation, even with a creator grant', async () => {
  await signInWithEmailAndPassword(auth, 'unverified@school.test', 'practice123')
  await sleep(150)
  await setDoc(doc(db, 'organisations', 'unverified-org'), {
    name: 'Should not exist either',
    createdBy: unverified.uid,
    createdAt: new Date().toISOString(),
    settings: {},
  })
})
await denied('an unverified email cannot request to join an org', () =>
  setDoc(doc(db, 'organisations', orgAId, 'joinRequests', unverified.uid), {
    uid: unverified.uid,
    email: 'unverified@school.test',
    name: 'Unverified',
    requestedAt: new Date().toISOString(),
    status: 'pending',
  }),
)

// ------------------------------------------------------------- org domains

await signInAs('orgadmin@school.test')
await allowed("an org admin can register a domain for their own org", () =>
  setDoc(doc(db, 'orgDomains', 'school-a.test'), {
    orgId: orgAId,
    orgName: 'School A',
    addedBy: orgAdmin.uid,
    addedAt: new Date().toISOString(),
  }),
)

await denied("a non-admin cannot register a domain for an org they belong to", async () => {
  await signInAs('outsider@school.test')
  await setDoc(doc(db, 'orgDomains', 'sneaky.test'), {
    orgId: orgAId,
    orgName: 'School A',
    addedBy: outsider.uid,
    addedAt: new Date().toISOString(),
  })
})

const domainUnverified = (
  await createUserWithEmailAndPassword(auth, 'newkid@school-a.test', 'practice123')
).user
await denied("an unverified email cannot domain-auto-join even with a matching domain", async () => {
  await signInWithEmailAndPassword(auth, 'newkid@school-a.test', 'practice123')
  await sleep(150)
  await setDoc(doc(db, 'organisations', orgAId, 'members', domainUnverified.uid), {
    uid: domainUnverified.uid,
    orgName: 'School A',
    email: 'newkid@school-a.test',
    name: 'New Kid',
    role: 'student',
    status: 'active',
    classIds: [],
    joinedAt: new Date().toISOString(),
  })
})

await verifyEmail(domainUnverified)
// verifyEmail refreshed the token on this specific user-object reference,
// not on whatever auth.currentUser now points to after the re-sign-in
// inside the denied() check above — re-sign-in to pick up the fresh claim
// the way every other operation in this script does.
await signInAs('newkid@school-a.test')
await allowed('a verified email on a registered domain joins instantly, as a student', () =>
  setDoc(doc(db, 'organisations', orgAId, 'members', domainUnverified.uid), {
    uid: domainUnverified.uid,
    orgName: 'School A',
    email: 'newkid@school-a.test',
    name: 'New Kid',
    role: 'student',
    status: 'active',
    classIds: [],
    joinedAt: new Date().toISOString(),
  }),
)

await denied('domain auto-join refuses a role other than student', async () => {
  const other = (
    await createUserWithEmailAndPassword(auth, 'wannabeadmin@school-a.test', 'practice123')
  ).user
  await verifyEmail(other)
  await setDoc(doc(db, 'organisations', orgAId, 'members', other.uid), {
    uid: other.uid,
    orgName: 'School A',
    email: 'wannabeadmin@school-a.test',
    name: 'Wannabe Admin',
    role: 'admin',
    status: 'active',
    classIds: [],
    joinedAt: new Date().toISOString(),
  })
})

await account('nomatch@elsewhere.test')
await denied("a verified email whose domain isn't registered to any org cannot domain-auto-join", async () => {
  await signInAs('nomatch@elsewhere.test')
  await setDoc(doc(db, 'organisations', orgAId, 'members', auth.currentUser.uid), {
    uid: auth.currentUser.uid,
    orgName: 'School A',
    email: 'nomatch@elsewhere.test',
    name: 'No Match',
    role: 'student',
    status: 'active',
    classIds: [],
    joinedAt: new Date().toISOString(),
  })
})

// ----------------------------------------------------- invites & self-grant

await signInAs('orgadmin@school.test')
await allowed('org admin can invite a teacher', () =>
  setDoc(doc(db, 'organisations', orgAId, 'invites', 'teacher@school.test'), {
    email: 'teacher@school.test',
    role: 'teacher',
    invitedBy: orgAdmin.uid,
    createdAt: new Date().toISOString(),
    status: 'pending',
  }),
)

await denied('a student cannot invite themselves as admin', async () => {
  await signInAs('student@school.test')
  await setDoc(doc(db, 'organisations', orgAId, 'invites', 'student@school.test'), {
    email: 'student@school.test',
    role: 'admin',
    invitedBy: student.uid,
    createdAt: new Date().toISOString(),
    status: 'pending',
  })
})

await denied('nobody can create a membership without a matching invite', async () => {
  await signInAs('student@school.test')
  await setDoc(doc(db, 'organisations', orgAId, 'members', student.uid), {
    uid: student.uid,
    email: 'student@school.test',
    name: 'Student',
    role: 'student',
    status: 'active',
    classIds: [],
    joinedAt: new Date().toISOString(),
  })
})

await signInAs('teacher@school.test')
await denied('an invited teacher cannot grant themselves admin instead of the invited role', () =>
  setDoc(doc(db, 'organisations', orgAId, 'members', teacher.uid), {
    uid: teacher.uid,
    email: 'teacher@school.test',
    name: 'Teacher',
    role: 'admin', // invite says teacher
    status: 'active',
    classIds: [],
    joinedAt: new Date().toISOString(),
  }),
)

await allowed('an invited teacher can accept with the role the invite actually grants', () =>
  setDoc(doc(db, 'organisations', orgAId, 'members', teacher.uid), {
    uid: teacher.uid,
    email: 'teacher@school.test',
    name: 'Teacher',
    role: 'teacher',
    status: 'active',
    classIds: [],
    joinedAt: new Date().toISOString(),
  }),
)

// ------------------------------------------------------------- join request

await signInAs('student@school.test')
await allowed('a general user can request to join an org', () =>
  setDoc(doc(db, 'organisations', orgAId, 'joinRequests', student.uid), {
    uid: student.uid,
    email: 'student@school.test',
    name: 'Student',
    requestedAt: new Date().toISOString(),
    status: 'pending',
  }),
)

await denied('a student cannot approve their own join request', () =>
  updateDoc(doc(db, 'organisations', orgAId, 'joinRequests', student.uid), { status: 'approved' }),
)

await signInAs('orgadmin@school.test')
await allowed('an org admin can approve a join request and create the membership', async () => {
  await updateDoc(doc(db, 'organisations', orgAId, 'joinRequests', student.uid), {
    status: 'approved',
  })
  await setDoc(doc(db, 'organisations', orgAId, 'members', student.uid), {
    uid: student.uid,
    email: 'student@school.test',
    name: 'Student',
    role: 'student',
    status: 'active',
    classIds: [],
    joinedAt: new Date().toISOString(),
  })
})

// -------------------------------------------------------------- role misuse

await signInAs('student@school.test')
await denied('a student cannot promote themselves to admin', () =>
  updateDoc(doc(db, 'organisations', orgAId, 'members', student.uid), { role: 'admin' }),
)

await denied('a student cannot remove another member', () =>
  deleteDoc(doc(db, 'organisations', orgAId, 'members', teacher.uid)),
)

await denied('a student cannot read the org roster beyond their own record', () =>
  getDocs(collection(db, 'organisations', orgAId, 'members')),
)

// ------------------------------------------------------------------- classes

await signInAs('teacher@school.test')
await allowed('a teacher can create a class naming themselves', () =>
  setDoc(doc(db, 'organisations', orgAId, 'classes', 'class-1'), {
    name: 'Year 12 English',
    teacherIds: [teacher.uid],
    studentIds: [],
    createdAt: new Date().toISOString(),
    createdBy: teacher.uid,
  }),
)

await denied('a student cannot create a class', async () => {
  await signInAs('student@school.test')
  await setDoc(doc(db, 'organisations', orgAId, 'classes', 'class-2'), {
    name: 'Rogue class',
    teacherIds: [student.uid],
    studentIds: [],
    createdAt: new Date().toISOString(),
    createdBy: student.uid,
  })
})

// --------------------------------------------------------------- org papers

await signInAs('teacher@school.test')
await allowed('a teacher can create an org paper record', () =>
  setDoc(doc(db, 'organisations', orgAId, 'papers', 'paper-1'), {
    title: 'Trial paper',
    subject: null,
    year: null,
    readingMinutes: 5,
    workingMinutes: 40,
    classIds: [],
    fileName: 'trial.txt',
    mimeType: 'text/plain',
    byteSize: 10,
    storagePath: `organisations/${orgAId}/papers/paper-1/trial.txt`,
    uploadedBy: teacher.uid,
    createdAt: new Date().toISOString(),
  }),
)

await signInAs('student@school.test')
await allowed('an org member (student) can read a distributed paper', () =>
  getDoc(doc(db, 'organisations', orgAId, 'papers', 'paper-1')),
)
await denied('a student cannot upload an org paper themselves', () =>
  setDoc(doc(db, 'organisations', orgAId, 'papers', 'paper-2'), {
    title: 'Snuck in',
    classIds: [],
    createdAt: new Date().toISOString(),
    uploadedBy: student.uid,
  }),
)

// --------------------------------------------------- collection-group queries
//
// These are the queries listMyMemberships() and listMyPendingInvites() run —
// spanning every organisation at once, which nested match rules alone do NOT
// authorise (a real bug caught only by testing the actual query, not just
// get/write on individual documents).

await signInAs('teacher@school.test')
await allowed('a teacher can list the full org roster (scoped, not cross-org)', () =>
  getDocs(collection(db, 'organisations', orgAId, 'members')),
)

await signInAs('student@school.test')
await allowed("a collection-group query finds the student's own memberships", async () => {
  const snap = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', student.uid)))
  if (snap.size !== 1) throw new Error(`expected 1 membership, found ${snap.size}`)
})

// For list queries Firestore doesn't throw on a per-document denial the way
// it does for get/write — it just silently omits that document from the
// results. So the check here is that the row comes back empty, not that the
// call throws.
await signInAs('teacher@school.test')
try {
  const snap = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', student.uid)))
  check("a collection-group query cannot fetch someone else's memberships", snap.size === 0)
} catch {
  // A thrown permission-denied is an even stronger form of "cannot fetch" — also a pass.
  check("a collection-group query cannot fetch someone else's memberships", true)
}

await signInAs('orgadmin@school.test')
await setDoc(doc(db, 'organisations', orgAId, 'invites', 'lookup@school.test'), {
  email: 'lookup@school.test',
  role: 'student',
  invitedBy: orgAdmin.uid,
  createdAt: new Date().toISOString(),
  status: 'pending',
})
await account('lookup@school.test')
await signInAs('lookup@school.test')
await allowed('a collection-group query finds an invite addressed to this email', async () => {
  const snap = await getDocs(
    query(
      collectionGroup(db, 'invites'),
      where('email', '==', 'lookup@school.test'),
      where('status', '==', 'pending'),
    ),
  )
  if (snap.size !== 1) throw new Error(`expected 1 invite, found ${snap.size}`)
})

await signInAs('student@school.test')
try {
  const snap = await getDocs(
    query(
      collectionGroup(db, 'invites'),
      where('email', '==', 'lookup@school.test'),
      where('status', '==', 'pending'),
    ),
  )
  check("a collection-group invite query for someone else's email comes back empty", snap.size === 0)
} catch {
  check("a collection-group invite query for someone else's email comes back empty", true)
}

// ------------------------------------------------------------- cross-org isolation

await adminDb.doc('orgCreators/rivaladmin@rival.test').set({
  email: 'rivaladmin@rival.test',
  grantedBy: 'test-harness',
  grantedAt: new Date().toISOString(),
})
await signInAs('rivaladmin@rival.test')
const orgBId = 'org-b'
await setDoc(doc(db, 'organisations', orgBId), {
  name: 'School B',
  createdBy: rivalAdmin.uid,
  createdAt: new Date().toISOString(),
  settings: { defaultRuleProfile: 'strict', allowJoinRequests: true },
})
await setDoc(doc(db, 'organisations', orgBId, 'members', rivalAdmin.uid), {
  uid: rivalAdmin.uid,
  email: 'rivaladmin@rival.test',
  name: 'Rival Admin',
  role: 'admin',
  status: 'active',
  classIds: [],
  joinedAt: new Date().toISOString(),
})

await denied("school B's admin cannot touch school A's members", () =>
  updateDoc(doc(db, 'organisations', orgAId, 'members', student.uid), { role: 'teacher' }),
)
await denied("school B's admin cannot read school A's org papers unless also a member", () =>
  getDocs(collection(db, 'organisations', orgAId, 'papers')),
)
await denied("school B's admin cannot delete school A's organisation", () =>
  deleteDoc(doc(db, 'organisations', orgAId)),
)

// ------------------------------------------------------------------ site admin

await denied('a regular signed-in user cannot self-grant site admin', async () => {
  await signInAs('outsider@school.test')
  await setDoc(doc(db, 'siteAdmins', outsider.uid), { grantedAt: new Date().toISOString() })
})

// Seeded exactly as a human would via the Firebase console — the one
// legitimate way to create the very first site admin.
await adminDb.doc(`siteAdmins/${outsider.uid}`).set({ grantedAt: new Date().toISOString() })

await signInAs('outsider@school.test')
await allowed("a seeded site admin can read school A's member roster", () =>
  getDocs(collection(db, 'organisations', orgAId, 'members')),
)
await allowed("a site admin can read any account's profile", () =>
  getDoc(doc(db, 'users', student.uid)),
)
await denied("a site admin still cannot read a student's papers — content stays private", () =>
  getDocs(collection(db, 'users', student.uid, 'papers')),
)
await denied("a site admin still cannot read a student's practice sessions", () =>
  getDocs(collection(db, 'users', student.uid, 'attempts')),
)
await allowed('a site admin can grant the role to someone else', () =>
  setDoc(doc(db, 'siteAdmins', rivalAdmin.uid), { grantedAt: new Date().toISOString() }),
)

// ---------------------------------------- site admin acting as any org's admin
//
// The whole point of the role: a site admin can step into a school they've
// never joined and actually help — read its distributed papers, manage its
// classes — the same way that school's own admin could.

await allowed("a site admin can read school A's distributed papers without being a member", () =>
  getDocs(collection(db, 'organisations', orgAId, 'papers')),
)

await allowed("a site admin can rename a class in an org they've never joined", () =>
  updateDoc(doc(db, 'organisations', orgAId, 'classes', 'class-1'), { name: 'Year 12 English (renamed)' }),
)

await allowed('a site admin can create an organisation with no creator grant of their own', () =>
  setDoc(doc(db, 'organisations', 'site-admin-org'), {
    name: "Site admin's own org",
    createdBy: outsider.uid,
    createdAt: new Date().toISOString(),
    settings: {},
  }),
)

// ------------------------------------------------------------- org creators

await allowed('a granted org-creator can read their own grant', async () => {
  await signInAs('orgadmin@school.test')
  const snap = await getDoc(doc(db, 'orgCreators', 'orgadmin@school.test'))
  if (!snap.exists()) throw new Error('expected the grant to exist')
})

await denied("a signed-in user cannot read someone else's org-creator grant", () =>
  getDoc(doc(db, 'orgCreators', 'rivaladmin@rival.test')),
)

await denied('a non-site-admin cannot grant themselves org-creator access', async () => {
  await signInAs('student@school.test')
  await setDoc(doc(db, 'orgCreators', 'student@school.test'), {
    email: 'student@school.test',
    grantedBy: student.uid,
    grantedAt: new Date().toISOString(),
  })
})

await adminApp.delete()

const failed = results.filter((r) => !r.passed)
console.log(`\n${results.length - failed.length}/${results.length} org rule checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
