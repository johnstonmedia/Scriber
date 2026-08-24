/**
 * Two screenshots: the supervisor's monitor, and a student's own screen
 * mid-exam.
 *
 * Seeded directly rather than driven through the whole sign-up and
 * organisation flow — those paths already have suites proving they work, and
 * for a picture what matters is arriving at the right state reliably.
 *
 * Invented names throughout. Never point this at real students.
 *
 * Needs the emulators and the dev server. Output: dist-extension/store/.
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
const orgId = `shots-org-${stamp}`
const classId = 'shots-class'
const testId = 'shots-test'
const teacherEmail = `shots-teacher${stamp}@northside.test`
const studentEmail = `shots-student${stamp}@northside.test`

const adminApp = initAdminApp({ projectId: 'demo-scriber' }, `shots-${stamp}`)
const db = getAdminFirestore(adminApp)
const adminAuth = getAdminAuth(adminApp)

async function person(email, name) {
  const user = await adminAuth.createUser({ email, password: 'practice123', displayName: name, emailVerified: true })
  await db.doc(`users/${user.uid}`).set({ email, name, onboarded: true, createdAt: new Date().toISOString() })
  return user
}

const teacher = await person(teacherEmail, 'R. Whitfield')
const student = await person(studentEmail, 'A. Okafor')

await db.doc(`organisations/${orgId}`).set({
  name: 'Northside High School',
  createdBy: teacher.uid,
  createdAt: new Date().toISOString(),
  slug: null,
  settings: { defaultRuleProfile: 'assisted', allowJoinRequests: true, identifyBy: 'examNumber' },
  branding: { accentColor: '#1F5FD8', tagline: 'Learning Support', logoDataUrl: null },
  plan: { kind: 'licensed', studentSeats: 50, expiresAt: null, setBy: 'demo', setAt: '' },
})
for (const [user, name, role] of [
  [teacher, 'R. Whitfield', 'teacher'],
  [student, 'A. Okafor', 'student'],
]) {
  await db.doc(`organisations/${orgId}/members/${user.uid}`).set({
    uid: user.uid,
    orgName: 'Northside High School',
    email: user.email,
    name,
    role,
    status: 'active',
    classIds: [classId],
    joinedAt: new Date().toISOString(),
    examNumber: role === 'student' ? '90214' : null,
  })
}
await db.doc(`organisations/${orgId}/classes/${classId}`).set({
  name: 'Year 12 English Advanced',
  teacherIds: [teacher.uid],
  studentIds: [student.uid],
  createdAt: new Date().toISOString(),
})

const started = Date.now()
await db.doc(`organisations/${orgId}/tests/${testId}`).set({
  orgId,
  classId,
  className: 'Year 12 English Advanced',
  // The exam room only fetches the phase-gated paper when the test says it
  // has one, so this has to be set for the paper pane to render at all.
  paperId: 'shots-paper',
  title: 'Trial HSC — Paper 1',
  ruleProfile: 'assisted',
  readingMinutes: 10,
  workingMinutes: 120,
  phase: 'working',
  phaseEndsAt: started + 68 * 60_000,
  scheduledAt: started,
  createdBy: teacher.uid,
  createdAt: new Date().toISOString(),
})
// The paper itself lives in the phase-gated subcollection — a student can only
// read it once the test is running, which it is.
await db.doc(`organisations/${orgId}/tests/${testId}/secure/paper`).set({
  title: 'Trial HSC — Paper 1',
  // Questions, not raw text: the exam room renders an extracted list so a
  // class can be given a subset of a paper.
  questions: [
    {
      id: 'q1',
      index: 1,
      text:
        'Question 1 (20 marks)\n\nAnalyse how the composer represents discovery as something that unsettles as much as it reveals.\n\nIn your response, make detailed reference to your prescribed text.',
    },
    {
      id: 'q2',
      index: 2,
      text:
        'Question 2 (20 marks)\n\nTo what extent does the text privilege memory over lived experience?',
    },
  ],
  classQuestions: {},
})

/** Three students on the roster, in three different states. */
const others = [
  {
    uid: 'demo-marchetti',
    name: 'J. Marchetti',
    wordCount: 388,
    preview: '…memory is privileged over experience throughout the second stanza, where the speaker',
    extension: {
      connected: true,
      focused: false,
      tabCount: 3,
      otherTabs: [{ title: 'discovery essay - Google Search', host: 'www.google.com', active: true }],
      seenAt: new Date().toISOString(),
    },
  },
  {
    uid: 'demo-naidoo',
    name: 'S. Naidoo',
    wordCount: 401,
    preview: '…the text resists an easy reading, and it is in that resistance that the composer',
    extension: null,
  },
]
for (const p of others) {
  await db.doc(`organisations/${orgId}/tests/${testId}/participants/${p.uid}`).set({
    uid: p.uid,
    name: p.name,
    status: 'active',
    wordCount: p.wordCount,
    preview: p.preview,
    updatedAt: new Date().toISOString(),
    paused: false,
    pauseEndsAt: null,
    pausedBy: null,
    attendance: 'present',
    sharing: true,
    extension: p.extension,
  })
}
await db.collection(`organisations/${orgId}/tests/${testId}/alerts`).add({
  uid: 'demo-marchetti',
  name: 'J. Marchetti',
  type: 'other-site',
  detail: 'Opened www.google.com',
  at: new Date().toISOString(),
})

// ------------------------------------------------------------------ capture

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen',
  ],
})

async function signedInPage(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  // A controllable stand-in for the Web Speech API — the student needs words
  // on the page, and there is no microphone here.
  await context.addInitScript(() => {
    class FakeRecognition {
      start() { this.onstart?.() }
      stop() { this.onend?.() }
      abort() {}
      say(text) {
        this.onresult?.({
          resultIndex: 0,
          results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: text, confidence: 1 } } },
        })
      }
    }
    window.SpeechRecognition = class {
      constructor() {
        const instance = new FakeRecognition()
        window.__fakeRecognition = instance
        return instance
      }
    }
    localStorage.setItem('scriber-extension-prompt-dismissed', 'yes')
  })
  await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('practice123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 })
  return page
}

// ---- the student, mid-exam

const studentPage = await signedInPage(studentEmail)
await studentPage.goto(`http://localhost:5173/exam?org=${orgId}&test=${testId}`, {
  waitUntil: 'domcontentloaded',
})
await studentPage.getByRole('button', { name: 'Share my screen' }).click({ timeout: 20000 }).catch(() => {})
await studentPage.waitForSelector('.mic-button', { timeout: 30000 })
await studentPage.getByRole('button', { name: 'Start dictating' }).click().catch(() => {})
await studentPage.waitForFunction(() => !!window.__fakeRecognition, null, { timeout: 15000 }).catch(() => {})
for (const line of [
  'the composer positions discovery as a loss as much as a finding comma',
  'and it is in that hesitation that the poem does its work full stop',
]) {
  await studentPage.evaluate((t) => window.__fakeRecognition?.say(t), line)
  // A real speaker leaves the writer time to catch up. Firing both lines back
  // to back outruns them on purpose, which is the engine working — and a poor
  // illustration of ordinary use.
  await studentPage.waitForTimeout(4000)
}
await studentPage.waitForTimeout(2500)
await studentPage.screenshot({ path: `${OUT}/student-exam-room.png` })
console.log(`wrote ${OUT}/student-exam-room.png`)

// ---- the supervisor

const teacherPage = await signedInPage(teacherEmail)
await teacherPage.goto(`http://localhost:5173/organisations/${orgId}/tests/${testId}`, {
  waitUntil: 'domcontentloaded',
})
await teacherPage.waitForSelector('text=J. Marchetti', { timeout: 30000 })
await teacherPage.waitForTimeout(2500)
await teacherPage.screenshot({ path: `${OUT}/supervisor-monitor.png`, fullPage: true })
console.log(`wrote ${OUT}/supervisor-monitor.png`)

await browser.close()
await adminApp.delete()
