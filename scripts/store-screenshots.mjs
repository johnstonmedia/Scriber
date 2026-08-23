/**
 * The screenshot the Chrome Web Store listing needs.
 *
 * The store requires at least one 1280×800 image, and the one that argues
 * best for an extension asking for the `tabs` permission is the thing the
 * permission is actually for: a supervisor's monitor showing that a student
 * has another site open. A reviewer looking for "does the single purpose
 * match what it does" can see it in one image.
 *
 * Everything here is seeded demo data with invented names. Never point this
 * at real students.
 *
 * Needs: emulators and the dev server. Output: dist-extension/store/.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'

const OUT = 'dist-extension/store'
mkdirSync(OUT, { recursive: true })

const stamp = Date.now()
const teacherEmail = `shots-teacher${stamp}@northside.test`
const orgId = `shots-org-${stamp}`
const classId = 'shots-class'
const testId = 'shots-test'

const adminApp = initAdminApp({ projectId: 'demo-scriber' }, `shots-${stamp}`)
const db = getAdminFirestore(adminApp)
const adminAuth = getAdminAuth(adminApp)

const teacher = await adminAuth.createUser({
  email: teacherEmail,
  password: 'practice123',
  displayName: 'R. Whitfield',
  emailVerified: true,
})

await db.doc(`users/${teacher.uid}`).set({
  email: teacherEmail,
  name: 'R. Whitfield',
  createdAt: new Date().toISOString(),
})

await db.doc(`organisations/${orgId}`).set({
  name: 'Northside High School',
  createdBy: teacher.uid,
  createdAt: new Date().toISOString(),
  slug: null,
  settings: { defaultRuleProfile: 'strict', allowJoinRequests: true, identifyBy: 'examNumber' },
  branding: { accentColor: '#1F5FD8', tagline: 'Learning Support', logoDataUrl: null },
  plan: { kind: 'licensed', studentSeats: 50, expiresAt: null, setBy: 'demo', setAt: '' },
})
await db.doc(`organisations/${orgId}/members/${teacher.uid}`).set({
  uid: teacher.uid,
  orgName: 'Northside High School',
  email: teacherEmail,
  name: 'R. Whitfield',
  role: 'teacher',
  status: 'active',
  classIds: [classId],
  joinedAt: new Date().toISOString(),
})
await db.doc(`organisations/${orgId}/classes/${classId}`).set({
  name: 'Year 12 English Advanced',
  teacherIds: [teacher.uid],
  studentIds: [],
  createdAt: new Date().toISOString(),
})

const startedAt = Date.now()
await db.doc(`organisations/${orgId}/tests/${testId}`).set({
  orgId,
  classId,
  className: 'Year 12 English Advanced',
  paperId: null,
  title: 'Trial HSC — Paper 1',
  ruleProfile: 'strict',
  readingMinutes: 10,
  workingMinutes: 120,
  phase: 'working',
  phaseEndsAt: startedAt + 74 * 60_000,
  scheduledAt: startedAt,
  createdBy: teacher.uid,
  createdAt: new Date().toISOString(),
})

/**
 * Invented students, and deliberately not all in the same state: one clean,
 * one with another site open, one with no extension reporting at all. The
 * third matters — "unknown" is a real answer a supervisor needs, and showing
 * only green ticks would misrepresent what the extension does.
 */
const students = [
  {
    uid: 'demo-student-1',
    name: 'A. Okafor',
    wordCount: 412,
    preview: '…the composer positions the reader to see discovery as a loss as much as a finding.',
    extension: {
      // The reader in testSession.ts treats a record without `connected` as
      // no extension at all — deliberately, so a half-written document reads
      // as "unknown" rather than "clean".
      connected: true,
      focused: true,
      tabCount: 1,
      otherTabs: [],
      seenAt: new Date().toISOString(),
    },
  },
  {
    uid: 'demo-student-2',
    name: 'J. Marchetti',
    wordCount: 388,
    preview: '…memory is privileged over experience throughout the second stanza, where the speaker',
    extension: {
      connected: true,
      focused: false,
      tabCount: 3,
      otherTabs: [
        { title: 'discovery essay analysis - Google Search', host: 'www.google.com', active: true },
        { title: 'Trial HSC — Paper 1 · Scriber', host: 'northside.pracscriber.com', active: false },
      ],
      seenAt: new Date().toISOString(),
    },
  },
  {
    uid: 'demo-student-3',
    name: 'S. Naidoo',
    wordCount: 401,
    preview: '…the text resists an easy reading, and it is in that resistance that the composer',
    extension: null,
  },
]

for (const student of students) {
  await db.doc(`organisations/${orgId}/tests/${testId}/participants/${student.uid}`).set({
    uid: student.uid,
    name: student.name,
    status: 'active',
    wordCount: student.wordCount,
    preview: student.preview,
    updatedAt: new Date().toISOString(),
    paused: false,
    pauseEndsAt: null,
    pausedBy: null,
    attendance: 'present',
    sharing: true,
    extension: student.extension,
  })
}

// One integrity alert, because a supervisor's feed is never empty in a real
// room and an empty one looks like a feature that does nothing.
await db.collection(`organisations/${orgId}/tests/${testId}/alerts`).add({
  uid: 'demo-student-2',
  name: 'J. Marchetti',
  type: 'other-site',
  detail: 'Opened www.google.com',
  at: new Date().toISOString(),
})

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
// Exactly the store's required size — anything else is rejected or letterboxed.
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))

// The "install the extension" banner has no business in a screenshot whose
// whole subject is the extension.
await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
await page.evaluate(() => localStorage.setItem('scriber-extension-prompt-dismissed', 'yes'))
await page.getByLabel('Email').fill(teacherEmail)
await page.getByLabel('Password').fill('practice123')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 })

await page.goto(`http://localhost:5173/organisations/${orgId}/tests/${testId}`, {
  waitUntil: 'domcontentloaded',
})
await page.waitForSelector('text=J. Marchetti', { timeout: 30000 })
// Frame the student who actually has another site open — that row is the
// argument for the permission, and it starts below the fold.
await page.locator('.card', { hasText: 'J. Marchetti' }).first().scrollIntoViewIfNeeded()
// Back off far enough that the row above isn't sliced through its buttons.
await page.evaluate(() => window.scrollBy(0, -34))
// Let the live clock and the tab list settle before the shutter.
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/01-supervisor-monitor.png` })
console.log(`wrote ${OUT}/01-supervisor-monitor.png`)

// Only one image, deliberately. A listing is better served by a single
// screenshot that proves the single purpose than by a second one padding it
// out — the pairing panel in its unpaired state argues for nothing, and
// shows an account email besides.
await browser.close()
await adminApp.delete()
console.log('\n1280×800. Upload under Store listing → Graphics → Screenshots.')
