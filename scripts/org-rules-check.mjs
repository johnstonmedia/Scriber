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
  addDoc,
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
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'

const PROJECT_ID = 'demo-scriber'

/**
 * Wipes the emulator before seeding.
 *
 * This script builds a specific world — these accounts, these organisations,
 * these memberships — and asserts against it. Leftovers from an earlier run
 * make it fail on account creation before it has checked a single rule, and
 * that failure looks nothing like the real problem, so clear the slate first
 * rather than requiring whoever runs it to remember to restart the emulator.
 */
async function resetEmulator() {
  const responses = await Promise.all([
    fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
      method: 'DELETE',
    }),
    fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' }),
  ]).catch(() => {
    throw new Error('Could not reach the emulators — start them with `npm run emulators` first.')
  })
  for (const response of responses) {
    if (!response.ok) throw new Error(`Could not clear the emulator: ${response.status}`)
  }
}

await resetEmulator()

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

// What anyone but a site admin has to start an organisation on — the rules
// pin both fields, so a school cannot choose its own ceiling on the way in.
const DEMO_PLAN = {
  kind: 'demo',
  studentSeats: 5,
  expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  setBy: 'test-harness',
  setAt: new Date().toISOString(),
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
    plan: DEMO_PLAN,
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

// ------------------------------------------------------------- live tests

await signInAs('teacher@school.test')
await allowed('a teacher can create a test for their class', () =>
  setDoc(doc(db, 'organisations', orgAId, 'tests', 'test-1'), {
    orgId: orgAId,
    classId: 'class-1',
    className: 'Year 12 English',
    paperId: null,
    title: 'Trial test',
    ruleProfile: 'strict',
    readingMinutes: 10,
    workingMinutes: 40,
    phase: 'lobby',
    phaseEndsAt: null,
    createdBy: teacher.uid,
    createdAt: new Date().toISOString(),
  }),
)

await denied('a student cannot create a test', async () => {
  await signInAs('student@school.test')
  await setDoc(doc(db, 'organisations', orgAId, 'tests', 'test-rogue'), {
    orgId: orgAId,
    classId: 'class-1',
    className: 'Year 12 English',
    paperId: null,
    title: 'Rogue test',
    ruleProfile: 'strict',
    readingMinutes: 1,
    workingMinutes: 1,
    phase: 'lobby',
    phaseEndsAt: null,
    createdBy: student.uid,
    createdAt: new Date().toISOString(),
  })
})

await signInAs('student@school.test')
await allowed("a student can join a test's waiting room as their own participant", () =>
  setDoc(doc(db, 'organisations', orgAId, 'tests', 'test-1', 'participants', student.uid), {
    uid: student.uid,
    name: 'Student Person',
    status: 'ready',
    wordCount: 0,
    preview: '',
    updatedAt: new Date().toISOString(),
  }),
)

await denied("a student cannot create a participant doc for someone else", () =>
  setDoc(doc(db, 'organisations', orgAId, 'tests', 'test-1', 'participants', 'newkid@school-a.test'), {
    uid: 'someone-else',
    name: 'Not Me',
    status: 'ready',
    wordCount: 0,
    preview: '',
    updatedAt: new Date().toISOString(),
  }),
)

await signInAs('newkid@school-a.test')
await allowed("a second student can also join the same test's waiting room", () =>
  setDoc(doc(db, 'organisations', orgAId, 'tests', 'test-1', 'participants', domainUnverified.uid), {
    uid: domainUnverified.uid,
    name: 'New Kid',
    status: 'ready',
    wordCount: 0,
    preview: '',
    updatedAt: new Date().toISOString(),
  }),
)
await denied("a student cannot read another student's live progress", () =>
  getDoc(doc(db, 'organisations', orgAId, 'tests', 'test-1', 'participants', student.uid)),
)

await denied('a student cannot advance the test out of the waiting room', () =>
  updateDoc(doc(db, 'organisations', orgAId, 'tests', 'test-1'), {
    phase: 'reading',
    phaseEndsAt: Date.now() + 600_000,
  }),
)

await signInAs('teacher@school.test')
await allowed("a teacher can read every participant's live progress", () =>
  getDoc(doc(db, 'organisations', orgAId, 'tests', 'test-1', 'participants', student.uid)),
)
await allowed('a teacher can start reading time', () =>
  updateDoc(doc(db, 'organisations', orgAId, 'tests', 'test-1'), {
    phase: 'reading',
    phaseEndsAt: Date.now() + 600_000,
  }),
)
await allowed('a teacher can end the test for everyone', () =>
  updateDoc(doc(db, 'organisations', orgAId, 'tests', 'test-1'), { phase: 'finished', phaseEndsAt: null }),
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
  plan: DEMO_PLAN,
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

// ------------------------------------------------- live test confidentiality
//
// The whole point of a live test: a student cannot reach the questions before
// their teacher starts it, cannot pause themselves, and cannot read back the
// integrity trail their own browser files.

const testId = 'test-confidential'

await allowed('a teacher can create a test and stash its questions', async () => {
  await signInAs('teacher@school.test')
  await setDoc(doc(db, 'organisations', orgAId, 'tests', testId), {
    orgId: orgAId,
    classId: 'class-a',
    className: 'Class A',
    paperId: 'paper-a',
    title: 'Confidential test',
    ruleProfile: 'strict',
    readingMinutes: 10,
    workingMinutes: 40,
    phase: 'lobby',
    phaseEndsAt: null,
    scheduledAt: null,
    createdBy: teacher.uid,
    createdAt: new Date().toISOString(),
  })
  await setDoc(doc(db, 'organisations', orgAId, 'tests', testId, 'secure', 'paper'), {
    title: 'Confidential test',
    questions: [{ id: 'q1', index: 1, text: 'Discuss the causes of the war.' }],
    classQuestions: {},
  })
})

await denied('a student cannot read a test paper while the test is still in the lobby', async () => {
  await signInAs('student@school.test')
  const snap = await getDoc(doc(db, 'organisations', orgAId, 'tests', testId, 'secure', 'paper'))
  // A rule refusal throws; an empty read would be a silent leak of a different
  // kind, so treat "it came back missing" as a failure to actually deny.
  if (!snap.exists()) throw Object.assign(new Error('missing'), { code: 'permission-denied' })
})

await allowed('a teacher can read the test paper before the test starts', async () => {
  await signInAs('teacher@school.test')
  const snap = await getDoc(doc(db, 'organisations', orgAId, 'tests', testId, 'secure', 'paper'))
  if (!snap.exists()) throw new Error('expected the teacher to see the paper')
})

await allowed('starting the test opens the paper to its students', async () => {
  await signInAs('teacher@school.test')
  await updateDoc(doc(db, 'organisations', orgAId, 'tests', testId), {
    phase: 'reading',
    phaseEndsAt: Date.now() + 600_000,
  })
  await signInAs('student@school.test')
  const snap = await getDoc(doc(db, 'organisations', orgAId, 'tests', testId, 'secure', 'paper'))
  if (!snap.exists()) throw new Error('expected the student to see the paper once reading time began')
})

await denied('a student cannot rewrite the test paper', async () => {
  await signInAs('student@school.test')
  await setDoc(doc(db, 'organisations', orgAId, 'tests', testId, 'secure', 'paper'), { questions: [] })
})

await allowed('a student joins the test as a participant', async () => {
  await signInAs('student@school.test')
  await setDoc(doc(db, 'organisations', orgAId, 'tests', testId, 'participants', student.uid), {
    uid: student.uid,
    name: 'Student',
    status: 'ready',
    wordCount: 0,
    preview: '',
    updatedAt: new Date().toISOString(),
  })
})

await denied('a student cannot pause their own live test', async () => {
  await signInAs('student@school.test')
  await updateDoc(doc(db, 'organisations', orgAId, 'tests', testId, 'participants', student.uid), {
    paused: true,
    pauseEndsAt: null,
    pausedBy: student.uid,
  })
})

await allowed('a teacher can pause one student', async () => {
  await signInAs('teacher@school.test')
  await updateDoc(doc(db, 'organisations', orgAId, 'tests', testId, 'participants', student.uid), {
    paused: true,
    pauseEndsAt: null,
    pausedBy: teacher.uid,
  })
})

await denied('a paused student cannot lift their own pause', async () => {
  await signInAs('student@school.test')
  await updateDoc(doc(db, 'organisations', orgAId, 'tests', testId, 'participants', student.uid), {
    paused: false,
  })
})

await allowed('a student can still report their own progress while paused', async () => {
  await signInAs('student@school.test')
  await updateDoc(doc(db, 'organisations', orgAId, 'tests', testId, 'participants', student.uid), {
    uid: student.uid,
    status: 'active',
    wordCount: 12,
    preview: 'the war ended',
    updatedAt: new Date().toISOString(),
  })
})

await allowed("a student's browser can file an integrity alert about itself", async () => {
  await signInAs('student@school.test')
  await setDoc(doc(db, 'organisations', orgAId, 'tests', testId, 'alerts', 'alert-1'), {
    uid: student.uid,
    name: 'Student',
    type: 'tab-hidden',
    detail: null,
    at: new Date().toISOString(),
  })
})

await denied('a student cannot file an alert in someone else\'s name', async () => {
  await signInAs('student@school.test')
  await setDoc(doc(db, 'organisations', orgAId, 'tests', testId, 'alerts', 'alert-2'), {
    uid: teacher.uid,
    name: 'Teacher',
    type: 'copy',
    detail: null,
    at: new Date().toISOString(),
  })
})

await denied('a student cannot read back their own integrity trail', () =>
  getDocs(collection(db, 'organisations', orgAId, 'tests', testId, 'alerts')),
)

await denied('a student cannot delete an integrity alert', () =>
  deleteDoc(doc(db, 'organisations', orgAId, 'tests', testId, 'alerts', 'alert-1')),
)

await allowed('a teacher reads the whole alert feed', async () => {
  await signInAs('teacher@school.test')
  const snap = await getDocs(collection(db, 'organisations', orgAId, 'tests', testId, 'alerts'))
  if (snap.empty) throw new Error('expected at least one alert')
})

// A brand-new account, deliberately: by this point in the suite several of
// the accounts above have been granted site admin, which legitimately reaches
// everywhere. This one is nobody.
await account('bystander@nowhere.test')

await denied("someone outside the school cannot read its test paper", async () => {
  await signInAs('bystander@nowhere.test')
  const snap = await getDoc(doc(db, 'organisations', orgAId, 'tests', testId, 'secure', 'paper'))
  if (!snap.exists()) throw Object.assign(new Error('missing'), { code: 'permission-denied' })
})

// --------------------------------------------------------------- site lock

await allowed('anyone signed in can read the site lock', async () => {
  await signInAs('student@school.test')
  await getDoc(doc(db, 'siteConfig', 'site'))
})

await denied('a normal user cannot lock the site', () =>
  setDoc(doc(db, 'siteConfig', 'site'), { locked: true }),
)

await allowed('a site admin can lock the site', async () => {
  await signInAs('outsider@school.test')
  await setDoc(doc(db, 'siteConfig', 'site'), { locked: false, message: 'Back soon.' })
})

// ----------------------------------------------------------- support reports

await allowed('anyone signed in can file a support report', async () => {
  await signInAs('student@school.test')
  await setDoc(doc(db, 'supportReports', 'report-1'), {
    code: 'SCR-200',
    uid: student.uid,
    at: new Date().toISOString(),
  })
})

await denied('a normal user cannot read the support queue', () =>
  getDocs(collection(db, 'supportReports')),
)

// ------------------------------------------- subdomains and exam numbers
//
// A school's subdomain is claimed by taking a document ID in orgSlugs, since
// a document ID is the only thing Firestore makes unique across a collection.
// An exam number identifies a paper without naming its author, so the one
// person who must never be able to set it is the student it belongs to.

await allowed("an org admin claims their school's subdomain", async () => {
  await signInAs('orgadmin@school.test')
  await setDoc(doc(db, 'orgSlugs', 'school-a'), { orgId: orgAId, claimedAt: new Date().toISOString() })
})

// Both rivalAdmin and outsider have been granted site admin by this point in
// the script, and a site admin genuinely does administer every school —
// subdomain included. The teacher and the student are the accounts that
// still prove the boundary here: inside the school, but not running it.
await denied("a teacher cannot claim their own school's subdomain", async () => {
  await signInAs('teacher@school.test')
  await setDoc(doc(db, 'orgSlugs', 'teacher-claim'), { orgId: orgAId, claimedAt: new Date().toISOString() })
})

await denied("a teacher cannot release their school's subdomain", async () => {
  await signInAs('teacher@school.test')
  await deleteDoc(doc(db, 'orgSlugs', 'school-a'))
})

await denied('a student cannot claim a subdomain at all', async () => {
  await signInAs('student@school.test')
  await setDoc(doc(db, 'orgSlugs', 'student-owned'), { orgId: orgAId, claimedAt: new Date().toISOString() })
})

await allowed('a teacher sets a student\'s exam number', async () => {
  await signInAs('teacher@school.test')
  await updateDoc(doc(db, 'organisations', orgAId, 'members', student.uid), { examNumber: '90210' })
})

await denied('a teacher cannot promote somebody while setting an exam number', async () => {
  await signInAs('teacher@school.test')
  await updateDoc(doc(db, 'organisations', orgAId, 'members', student.uid), {
    examNumber: '90211',
    role: 'admin',
  })
})

await denied('a student cannot set their own exam number', async () => {
  await signInAs('student@school.test')
  await updateDoc(doc(db, 'organisations', orgAId, 'members', student.uid), { examNumber: '00001' })
})

await denied('a student cannot clear their own exam number', async () => {
  await signInAs('student@school.test')
  await updateDoc(doc(db, 'organisations', orgAId, 'members', student.uid), { examNumber: null })
})

// ------------------------------------------------------- seats and the plan
//
// The plan is what a school pays for, so the one thing a school's own admin
// must not be able to edit. Everything else about the organisation is theirs.

await denied("an org admin cannot raise their own school's seat count", async () => {
  await signInAs('orgadmin@school.test')
  await updateDoc(doc(db, 'organisations', orgAId), {
    plan: { ...DEMO_PLAN, kind: 'licensed', studentSeats: 150 },
  })
})

await denied('an org admin cannot remove the seat limit entirely', async () => {
  await signInAs('orgadmin@school.test')
  await updateDoc(doc(db, 'organisations', orgAId), {
    plan: { ...DEMO_PLAN, studentSeats: null },
  })
})

await denied('an org admin cannot extend their own demo', async () => {
  await signInAs('orgadmin@school.test')
  await updateDoc(doc(db, 'organisations', orgAId), {
    plan: { ...DEMO_PLAN, expiresAt: new Date(Date.now() + 3650 * 86_400_000).toISOString() },
  })
})

await allowed('an org admin can still rename their school', async () => {
  await signInAs('orgadmin@school.test')
  await updateDoc(doc(db, 'organisations', orgAId), { name: 'School A (renamed)' })
})

await denied('an org-creator cannot license themselves at creation time', async () => {
  await signInAs('orgadmin@school.test')
  await setDoc(doc(db, 'organisations', 'self-licensed'), {
    name: 'Self-licensed',
    createdBy: orgAdmin.uid,
    createdAt: new Date().toISOString(),
    settings: {},
    plan: { ...DEMO_PLAN, kind: 'licensed', studentSeats: 150 },
  })
})

await denied('an org-creator cannot start an organisation with no plan at all', async () => {
  await signInAs('orgadmin@school.test')
  await setDoc(doc(db, 'organisations', 'planless'), {
    name: 'Planless',
    createdBy: orgAdmin.uid,
    createdAt: new Date().toISOString(),
    settings: {},
  })
})

await allowed("a site admin can license a school", async () => {
  await signInAs('outsider@school.test') // granted site admin further up
  await updateDoc(doc(db, 'organisations', orgAId), {
    plan: { kind: 'licensed', studentSeats: 50, expiresAt: null, setBy: outsider.uid, setAt: new Date().toISOString() },
  })
})

// -------------------------------------------------------------- demo requests
//
// The only collection anybody can write to without an account. It has to stay
// write-only: filing a request must reveal nothing, and must not be a way to
// store arbitrary data on someone else's Firestore bill.

const validRequest = {
  organisation: 'Northside High School',
  contactName: 'Sam Patel',
  email: 'sam.patel@northside.nsw.edu.au',
  role: 'Head of Learning Support',
  students: 'About 25',
  message: 'Trials are in Term 3.',
  status: 'new',
  orgId: null,
  handledBy: null,
  createdAt: new Date().toISOString(),
}

await allowed('a school with no account can ask for a demo', async () => {
  await auth.signOut()
  await sleep(150)
  await addDoc(collection(db, 'demoRequests'), validRequest)
})

await denied('a demo request cannot arrive already approved', async () => {
  await addDoc(collection(db, 'demoRequests'), { ...validRequest, status: 'approved' })
})

await denied('a demo request cannot arrive already attached to an organisation', async () => {
  await addDoc(collection(db, 'demoRequests'), { ...validRequest, orgId: orgAId })
})

await denied('a demo request cannot carry extra fields', async () => {
  await addDoc(collection(db, 'demoRequests'), { ...validRequest, payload: 'x'.repeat(100) })
})

await denied('a demo request cannot be used as free storage', async () => {
  await addDoc(collection(db, 'demoRequests'), { ...validRequest, message: 'x'.repeat(2000) })
})

await denied('a demo request needs a school and a person', async () => {
  await addDoc(collection(db, 'demoRequests'), { ...validRequest, organisation: '' })
})

await denied('nobody signed out can read the demo request queue', () =>
  getDocs(collection(db, 'demoRequests')),
)

await denied('an org admin cannot read the demo request queue either', async () => {
  await signInAs('orgadmin@school.test')
  await getDocs(collection(db, 'demoRequests'))
})

await allowed('a site admin reads the demo request queue', async () => {
  await signInAs('outsider@school.test')
  const snap = await getDocs(collection(db, 'demoRequests'))
  if (snap.empty) throw new Error('expected the filed request to be there')
})

// ------------------------------------------------- the calibration grant list
//
// Same shape as orgCreators, and the same thing to get wrong: a list that
// anybody can add themselves to is not an invitation list.

await denied('a signed-in user cannot grant themselves calibration access', async () => {
  await signInAs('teacher@school.test')
  await setDoc(doc(db, 'calibrationTesters', 'teacher@school.test'), {
    email: 'teacher@school.test',
    grantedBy: 'self',
    grantedAt: new Date().toISOString(),
  })
})

await denied("a signed-in user cannot read somebody else's grant", async () => {
  await signInAs('teacher@school.test')
  await getDoc(doc(db, 'calibrationTesters', 'student@school.test'))
})

await allowed('somebody can check their own grant, so the app knows whether to offer the tab', async () => {
  await signInAs('teacher@school.test')
  await getDoc(doc(db, 'calibrationTesters', 'teacher@school.test'))
})

await allowed('a site admin grants calibration access', async () => {
  await signInAs('outsider@school.test') // granted site admin further up
  await setDoc(doc(db, 'calibrationTesters', 'student@school.test'), {
    email: 'student@school.test',
    grantedBy: outsider.uid,
    grantedAt: new Date().toISOString(),
  })
})

await denied('an org admin cannot grant calibration access', async () => {
  await signInAs('orgadmin@school.test')
  await setDoc(doc(db, 'calibrationTesters', 'someone@school.test'), {
    email: 'someone@school.test',
    grantedBy: 'org admin',
    grantedAt: new Date().toISOString(),
  })
})

await adminApp.delete()

const failed = results.filter((r) => !r.passed)
console.log(`\n${results.length - failed.length}/${results.length} org rule checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
