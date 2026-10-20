/**
 * Taking words back, through the real page.
 *
 * Two corrections with very different reach, and the point is that a student
 * can tell them apart without being told:
 *
 *   - "scratch that" clears everything dictated since they last pressed Start
 *     dictating, and offers it back, because in a long sitting that command
 *     reaches a great deal.
 *   - Backspace takes back one word, in practice as well as in a live test.
 *     It used to be a live-test-only key, which left anybody practising on
 *     their own with no way to fix one word short of losing the whole run.
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
const email = `corrections${stamp}@northside.test`

const adminApp = initAdminApp({ projectId: 'demo-scriber' }, `corrections-${stamp}`)
const db = getAdminFirestore(adminApp)

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

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
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 })

await page.goto(`${APP}/exam`, { waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: 'Skip to working time' }).click({ timeout: 30000 })
await page.waitForSelector('.mic-button', { timeout: 30000 })

const sheet = () =>
  page.evaluate(() => {
    const node = document.querySelector('.answer-sheet')
    if (!node) return ''
    const copy = node.cloneNode(true)
    copy.querySelectorAll('.answer-placeholder, .interim, .awaiting-spelling').forEach((n) => n.remove())
    return (copy.innerText ?? '').trim()
  })

/** Say something, and wait for the writer to finish taking it down. */
async function say(text) {
  await page.evaluate((said) => {
    window.__fakeRecognition.emit(said, false)
    window.__fakeRecognition.emit(said, true)
  }, text)
  await page.waitForFunction(
    () => {
      const fill = document.querySelector('.load-bar-fill')
      return !fill || parseFloat(fill.style.width || '0') === 0
    },
    null,
    { timeout: 30000 },
  )
  await page.waitForTimeout(500)
}

const micOn = () => page.getByRole('button', { name: 'Start dictating' }).click()
const micOff = () => page.getByRole('button', { name: /Listening/ }).click()

console.log('\ntaking words back\n')

// ---- a first run, which must survive everything that follows

await micOn()
await page.waitForFunction(() => !!window.__fakeRecognition, null, { timeout: 15000 })
await say('the first run is safe')
await micOff()
check('the first run was written', (await sheet()).includes('first run is safe'), await sheet())

// ---- backspace, in free practice, outside a live test

await micOn()
await say('alpha beta gamma')
await page.locator('body').click({ position: { x: 5, y: 5 } })
await page.keyboard.press('Backspace')
await page.waitForTimeout(400)
const afterBackspace = await sheet()
check(
  'backspace takes back one word during individual practice',
  afterBackspace.endsWith('alpha beta'),
  afterBackspace,
)
check('backspace left the rest alone', afterBackspace.includes('first run is safe'))

// ---- scratch that, scoped to the run

await say('and then some more words to lose')
const beforeScratch = await sheet()
await say('scratch that')
const afterScratch = await sheet()

check(
  'scratch that cleared everything since the microphone started',
  !afterScratch.includes('alpha') && !afterScratch.includes('more words to lose'),
  afterScratch,
)
check(
  'scratch that did not reach into the earlier run',
  afterScratch.includes('first run is safe'),
  afterScratch,
)

// ---- and it can be undone

const undo = page.getByRole('button', { name: 'Put it back' })
check('it offers the words back', await undo.isVisible().catch(() => false))
await undo.click()
await page.waitForTimeout(400)
check(
  'putting it back restores exactly what was there',
  (await sheet()) === beforeScratch,
  await sheet(),
)

// ---- a new run narrows what the next scratch reaches

await micOff()
await micOn()
await say('only this much should go')
await say('scratch that')
const afterSecond = await sheet()
check(
  'starting again narrows what the next scratch takes',
  afterSecond === beforeScratch,
  afterSecond,
)

await browser.close()
await adminApp.delete()

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\n`)
process.exit(failures === 0 ? 0 : 1)
