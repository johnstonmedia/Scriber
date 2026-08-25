/**
 * How long the writer takes to start writing.
 *
 * This is the complaint, measured. A student speaks; the clock starts at the
 * word leaving their mouth and stops when it appears on the page. Before the
 * streaming change nothing reached the writer until the recogniser finalised,
 * so this measured the recogniser's patience rather than the writer's — with
 * Chrome that is several seconds, and it is why the lag felt "glitchy" rather
 * than slow: it was not lag at a steady rate, it was nothing and then a lump.
 *
 * The fake recogniser here behaves the way Chrome does: interim results as the
 * words come, and a final one a long time afterwards. If the page waits for
 * the final, this test fails.
 *
 * Invented names throughout. Never point this at real students.
 *
 * Needs the emulators and the dev server.
 */
import { chromium } from 'playwright'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'

const APP = 'http://localhost:5173'
const stamp = Date.now()
const email = `latency${stamp}@northside.test`

const adminApp = initAdminApp({ projectId: 'demo-scriber' }, `latency-${stamp}`)
const db = getAdminFirestore(adminApp)
const adminAuth = getAdminAuth(adminApp)

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const user = await adminAuth.createUser({
  email,
  password: 'practice123',
  displayName: 'A. Okafor',
  emailVerified: true,
})
await db.doc(`users/${user.uid}`).set({
  email,
  name: 'A. Okafor',
  onboarded: true,
  createdAt: new Date().toISOString(),
})

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })

/**
 * A recogniser with Chrome's timing: interim results arrive as the words are
 * spoken, and the final one lands four seconds after the sentence is over.
 */
await context.addInitScript(() => {
  class FakeRecognition {
    start() {
      this.onstart?.()
    }
    stop() {
      this.onend?.()
    }
    abort() {}
    emit(text, isFinal) {
      this.onresult?.({
        resultIndex: 0,
        results: { length: 1, 0: { isFinal, length: 1, 0: { transcript: text, confidence: 1 } } },
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

const page = await context.newPage()
page.on('pageerror', (e) => console.log('    PAGEERROR:', e.message))

await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' })
await page.getByLabel('Email').fill(email)
await page.getByLabel('Password').fill('practice123')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 })

await page.goto(`${APP}/exam`, { waitUntil: 'domcontentloaded' })
// Free practice opens on a setup screen; the point of this test is the
// writing, so go straight to working time.
await page.getByRole('button', { name: 'Skip to working time' }).click({ timeout: 30000 })
await page.waitForSelector('.mic-button', { timeout: 30000 })
await page.getByRole('button', { name: 'Start dictating' }).click().catch(() => {})
await page.waitForFunction(() => !!window.__fakeRecognition, null, { timeout: 15000 })

console.log('\nhow long before the writer starts writing\n')

const WORDS = 'the composer positions discovery as a loss as much as a finding'.split(' ')

/**
 * Speak, and watch the page at the same time.
 *
 * Both have to happen inside one evaluate. Speaking is a three-second loop, so
 * an observer started after it would begin looking only once the sentence was
 * over — which is a stopwatch that cannot read anything below three seconds,
 * and would call the old behaviour a pass.
 */
const measured = await page.evaluate(async (words) => {
  /*
   * What the writer has actually written — not the placeholder, and not the
   * greyed-out live text. Both live in the same element, and either would
   * make this pass instantly while measuring nothing: the interim span in
   * particular appears the moment the student speaks, which is exactly the
   * thing this is supposed to be timing the alternative to.
   */
  const sheet = () => {
    const node = document.querySelector('.answer-sheet')
    if (!node) return null
    const copy = node.cloneNode(true)
    copy.querySelectorAll('.answer-placeholder, .interim, .awaiting-spelling').forEach((n) => n.remove())
    return copy
  }
  const start = performance.now()
  let firstWriteAt = -1
  const poll = setInterval(() => {
    if (firstWriteAt < 0 && (sheet()?.innerText ?? '').trim().length > 0) {
      firstWriteAt = performance.now() - start
    }
  }, 20)

  let said = ''
  for (const word of words) {
    said = said ? `${said} ${word}` : word
    window.__fakeRecognition.emit(said, false)
    await new Promise((resolve) => setTimeout(resolve, 260))
  }
  const spokenFor = performance.now() - start
  // Chrome finalises long after the fact. Nothing should be waiting on it.
  setTimeout(() => window.__fakeRecognition.emit(said, true), 4000)

  await new Promise((resolve) => setTimeout(resolve, 9000))
  clearInterval(poll)
  return { firstWriteAt, spokenFor, written: (sheet()?.innerText ?? '').trim() }
}, WORDS)

const firstWordMs = measured.firstWriteAt

check('the writer wrote something', firstWordMs > 0, `${Math.round(firstWordMs)}ms`)
// The words are spoken 260ms apart and three are held back for the recogniser
// to revise, so the earliest anything can be written is about 1040ms plus the
// writer's own 700ms reaction. Anything past four seconds means it waited for
// the final result, which is the bug.
check(
  'it started writing while the student was still speaking',
  firstWordMs > 0 && firstWordMs < 4000,
  `${Math.round(firstWordMs)}ms after the first word`,
)

// And it must not have waited for the final: the whole sentence takes ~3.4s to
// say, and the final lands 4s after that.
check(
  'it did not wait for the recogniser to finalise',
  firstWordMs > 0 && firstWordMs < measured.spokenFor,
  `${Math.round(firstWordMs)}ms, while the student was still on word ` +
    `${Math.max(1, Math.ceil((firstWordMs / measured.spokenFor) * WORDS.length))} of ${WORDS.length}`,
)

const written = measured.written
const heard = WORDS.join(' ')
check(
  'every word arrived exactly once, with none doubled by the final result',
  written.toLowerCase().replace(/[^a-z ]/g, '').trim() === heard,
  written,
)

await browser.close()
await adminApp.delete()

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\n`)
process.exit(failures === 0 ? 0 : 1)
