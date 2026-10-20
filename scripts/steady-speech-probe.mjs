/**
 * What the writer does when the student never pauses.
 *
 * A diagnostic, not a feature test. Twenty words at a metronome-steady pace
 * with no silence anywhere in them: whatever the writer puts on the page is
 * punctuation it invented out of nothing, and the count is the size of the
 * problem.
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
const email = `steady${stamp}@northside.test`

const adminApp = initAdminApp({ projectId: 'demo-scriber' }, `steady-${stamp}`)
const db = getAdminFirestore(adminApp)

const user = await getAdminAuth(adminApp).createUser({
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
  // The profile where the writer is allowed to punctuate at all.
  settings: { ruleProfile: 'assisted' },
})

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await context.addInitScript(() => {
  class FakeRecognition {
    start() { this.onstart?.() }
    stop() { this.onend?.() }
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
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 }).catch(async () => {
  console.log('still on', page.url())
  console.log((await page.locator('body').innerText()).slice(0, 600))
  throw new Error('sign-in did not complete')
})

await page.goto(`${APP}/exam`, { waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: 'Skip to working time' }).click({ timeout: 30000 }).catch(async () => {
  console.log('url:', page.url())
  console.log((await page.locator('body').innerText()).slice(0, 800))
  throw new Error('no setup screen')
})
await page.waitForSelector('.mic-button', { timeout: 30000 })
await page.getByRole('button', { name: 'Start dictating' }).click().catch(() => {})
await page.waitForFunction(() => !!window.__fakeRecognition, null, { timeout: 15000 })

const WORDS =
  'the composer positions discovery as a loss as much as a finding and it is in that hesitation that the poem does its work'.split(
    ' ',
  )

console.log(`\nspeaking ${WORDS.length} words at a steady pace, with no pauses at all\n`)

await page.evaluate(() => { window.__scriberTiming = [] })
const written = await page.evaluate(async (words) => {
  const sheet = () => {
    const node = document.querySelector('.answer-sheet')
    if (!node) return ''
    const copy = node.cloneNode(true)
    copy.querySelectorAll('.answer-placeholder, .interim, .awaiting-spelling').forEach((n) => n.remove())
    return (copy.innerText ?? '').trim()
  }
  /*
   * Chrome does not hand over one word per update at a fixed rate. It hands
   * over one to four at a time, whenever its hypothesis firms up, so the
   * interval between updates is roughly the time those words took to say.
   * The student is speaking at a flat 300ms a word throughout — there is no
   * silence anywhere in this — but the deliveries are lumpy, which is the
   * only realistic part of the fake and the part that matters.
   */
  const PER_WORD = 300
  let said = ''
  let i = 0
  let lump = 1
  while (i < words.length) {
    const take = Math.min(lump, words.length - i)
    // Say the words first, then deliver them. The interval before a delivery
    // is the time spent saying what it contains — getting that backwards
    // makes the fake attribute each lump's speaking time to the next
    // delivery, which looks exactly like a pause and is not one.
    await new Promise((resolve) => setTimeout(resolve, take * PER_WORD))
    for (let k = 0; k < take; k++) said = said ? `${said} ${words[i + k]}` : words[i + k]
    i += take
    window.__fakeRecognition.emit(said, false)
    lump = (lump % 4) + 1
  }
  window.__fakeRecognition.emit(said, true)
  await new Promise((resolve) => setTimeout(resolve, 12000))
  return sheet()
}, WORDS)

const gaps = await page.evaluate(() => window.__scriberTiming ?? [])
console.log('deliveries (words / interval / perWord estimate / silence):')
for (const g of gaps) console.log(`  ${g.words}w  ${g.interval}ms  ~${g.perWord}ms/word  -> ${g.silence}ms`)
const marks = (written.match(/[.,?]/g) ?? []).length

// What the old measurement would have made of the same deliveries: the raw
// interval, with the speaking time left in. Printed so this test can be seen
// to have teeth rather than merely passing.
const COMMA = 350
const naive = gaps.filter((g) => g.interval >= COMMA).length

console.log(`\n${written}\n`)
console.log(`${marks} mark(s) invented where the student left no silence at all.`)
console.log(
  `(the raw intervals, which is what this used to read, would have put in ${naive}.)`,
)

await browser.close()
await adminApp.delete()

if (marks !== 0) process.exit(1)
if (naive === 0) {
  console.log('\nthis run was too gentle to prove anything — no interval even reached a comma')
  process.exit(1)
}
console.log('\nall checks passed')
