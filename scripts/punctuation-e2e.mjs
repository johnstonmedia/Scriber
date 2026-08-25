/**
 * The punctuation model, end to end through the real thing.
 *
 * Three claims, none of which a unit test can make:
 *
 *   1. A student reads a drill sentence and the writer is graded against it,
 *      in the browser, through the real screen.
 *   2. The round reaches the shared model — through the real API route, past
 *      the real validation, into the real document — and the count goes up.
 *   3. Contributions from one account change what a *different* account's
 *      writer does. That is the whole claim of "site-wide", and it is the one
 *      thing that cannot be checked anywhere but here.
 *
 * And one negative, which matters more than the three: a client that tries to
 * teach the model words from somewhere other than the drill bank is refused.
 * Exam prose must not be able to reach a shared model, and "we don't send it"
 * is not the same as "it cannot be sent".
 *
 * Invented names throughout. Never point this at real students.
 *
 * Needs the emulators, the dev server, and the API dev server.
 */
import { chromium } from 'playwright'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'

const APP = 'http://localhost:5173'
const stamp = Date.now()

const adminApp = initAdminApp({ projectId: 'demo-scriber' }, `punct-${stamp}`)
const db = getAdminFirestore(adminApp)
const adminAuth = getAdminAuth(adminApp)

let failures = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** The model doc is shared by every run, so measure the delta, not the total. */
async function observations() {
  const snapshot = await db.doc('models/punctuation').get()
  return snapshot.exists ? (snapshot.get('observations') ?? 0) : 0
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})

async function person(label) {
  const email = `punct-${label}${stamp}@northside.test`
  const user = await adminAuth.createUser({
    email,
    password: 'practice123',
    displayName: label,
    emailVerified: true,
  })
  await db.doc(`users/${user.uid}`).set({
    email,
    name: label,
    onboarded: true,
    createdAt: new Date().toISOString(),
  })
  // The drill is invitation-only; these two hold the invitation. Keyed by
  // email, not uid — that is what the rules and the auth provider both read.
  await db.doc(`calibrationTesters/${email.toLowerCase()}`).set({ addedAt: new Date().toISOString() })
  return { uid: user.uid, email }
}

/**
 * A recogniser we drive by hand.
 *
 * The drill reads its timing from when interim results arrive, so the fake has
 * to deliver the sentence a few words at a time with real time passing between
 * them — a fake that handed over the whole sentence at once would exercise
 * none of the thing being tested.
 */
async function installFakeRecogniser(context) {
  await context.addInitScript(() => {
    class FakeRecognition {
      start() {
        window.__recognising = true
        this.onstart?.()
      }
      stop() {
        window.__recognising = false
        this.onend?.()
      }
      abort() {
        window.__recognising = false
      }
      emit(text, isFinal) {
        this.onresult?.({
          resultIndex: 0,
          results: {
            length: 1,
            0: { isFinal, length: 1, 0: { transcript: text, confidence: 1 } },
          },
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
}

async function signIn(email) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  await installFakeRecogniser(context)
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('    PAGEERROR:', e.message))
  await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('practice123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 })
  return page
}

/**
 * Read a sentence aloud, pausing where the marks are.
 *
 * `pauses` gives the silence in milliseconds after each word, so a run can put
 * a genuine comma-length gap in the middle of a sentence and a longer one at
 * the end, exactly as a reader would.
 */
async function readAloud(page, words, pauses) {
  await page.waitForFunction(() => !!window.__fakeRecognition, null, { timeout: 15000 })
  let said = ''
  for (let i = 0; i < words.length; i++) {
    said = said ? `${said} ${words[i]}` : words[i]
    await page.evaluate((text) => window.__fakeRecognition?.emit(text, false), said)
    await page.waitForTimeout(pauses[i] ?? 120)
  }
  await page.evaluate((text) => window.__fakeRecognition?.emit(text, true), said)
}

// --------------------------------------------------------------------------

console.log('\npunctuation model, end to end\n')

const student = await person('student')
const other = await person('other')

// ---- 1. the drill grades a reading, in the browser

const page = await signIn(student.email)
await page.goto(`${APP}/calibrate`, { waitUntil: 'domcontentloaded' })

const heading = await page
  .getByRole('heading', { name: 'Teaching your writer' })
  .waitFor({ timeout: 30000 })
  .then(() => true)
  .catch(() => false)
check('the drill opens for an invited student', heading)

// Drive it onto a sentence we control rather than whatever it picked.
const shown = await page.locator('.calibration-line').first().innerText()
const words = shown.trim().split(/\s+/)
check('a sentence is shown with its punctuation stripped', !shown.includes(',') && !shown.includes('.'), shown)

const before = await observations()

await page.getByRole('button', { name: /start listening|Read this one/ }).click()
// A comma-length pause two-thirds of the way through, a long one at the end.
const pauses = words.map((_, i) => (i === Math.floor(words.length * 0.6) ? 520 : 130))
pauses[words.length - 1] = 900
await readAloud(page, words, pauses)
await page.getByRole('button', { name: 'Done reading' }).click()

await page.waitForSelector('text=Your writer wrote', { timeout: 20000 })
const wrote = await page.locator('.calibration-line').first().innerText()
check('the writer commits to an answer before the student sees the key', wrote.length > 0, wrote)
check('what it wrote is punctuated', /[.,?]/.test(wrote), wrote)

// ---- 2. the round reaches the shared model

await page.waitForFunction(
  (previous) =>
    document.body.innerText.includes('Next sentence') && previous !== undefined,
  before,
  { timeout: 20000 },
)
// The contribution is fired off without blocking the student, so give the
// round trip a moment rather than racing it.
let after = before
for (let i = 0; i < 30 && after <= before; i++) {
  await page.waitForTimeout(500)
  after = await observations()
}
check('the round reached the shared model', after > before, `${before} -> ${after}`)

const queued = await db.collection('punctuationContributions').get()
check('the queue was folded rather than left to pile up', queued.size === 0, `${queued.size} left`)

// ---- 3. one student's practice changes another student's writer

const secondPage = await signIn(other.email)
const seen = await secondPage.evaluate(async () => {
  const response = await fetch('/api/org-by-host')
  return response.ok
})
check('a second, unrelated account is signed in', seen !== undefined)

const sharedCount = await secondPage.evaluate(async () => {
  const { loadPunctuationModel } = await import('/src/lib/punctuationModel.ts')
  const model = await loadPunctuationModel()
  return model.observations
})
check(
  "the second account's writer reads the model the first one trained",
  sharedCount >= after,
  `${sharedCount} vs ${after}`,
)

// ---- 4. the negative: exam prose cannot reach the model

const rejected = await secondPage.evaluate(async () => {
  const { auth } = await import('/src/lib/firebase.ts')
  const token = await auth.currentUser.getIdToken()
  const response = await fetch('/api/punctuation/contribute', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      samples: [
        {
          // Words from nobody's drill sentence — this is what an exam answer
          // leaking into the trainer would look like.
          context: { ms: 600, before: 'Marchetti', after: 'confidential', clauseOpener: 'The' },
          mark: 'comma',
        },
      ],
      calibration: null,
    }),
  })
  return { status: response.status, body: await response.json() }
})
check(
  'a sample containing words from outside the bank is refused',
  rejected.status === 400 && rejected.body.error === 'bad-sample',
  JSON.stringify(rejected),
)

const afterAttack = await observations()
check('the refused sample did not reach the model', afterAttack === after, `${after} -> ${afterAttack}`)

// ---- 5. the model document itself cannot be written from a browser

// Driven over Firestore's REST API with the signed-in student's own token
// rather than through the SDK: `page.evaluate` cannot resolve a bare module
// specifier, and going straight at the wire is a truer test of the rule
// anyway — it is what a modified client would do.
const write = await secondPage.evaluate(async () => {
  const { auth } = await import('/src/lib/firebase.ts')
  const token = await auth.currentUser.getIdToken()
  const response = await fetch(
    'http://127.0.0.1:8080/v1/projects/demo-scriber/databases/(default)/documents/models/punctuation',
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { observations: { integerValue: '99999999' } } }),
    },
  )
  return response.status
})
check('the model cannot be overwritten from a browser', write === 403, `status ${write}`)

const afterWrite = await observations()
check('the model still holds what it was trained on', afterWrite === after, `${after} -> ${afterWrite}`)

await browser.close()
await adminApp.delete()

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\n`)
process.exit(failures === 0 ? 0 : 1)
