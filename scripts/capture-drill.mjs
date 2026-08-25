/**
 * Two pictures of the drill: the sentence waiting to be read, and the writer
 * being marked against it.
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
const email = `drill${stamp}@northside.test`
const adminApp = initAdminApp({ projectId: 'demo-scriber' }, `drill-${stamp}`)
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
})
await db.doc(`calibrationTesters/${email}`).set({ addedAt: new Date().toISOString() })

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})
const context = await browser.newContext({ viewport: { width: 1100, height: 900 } })
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
await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
await page.getByLabel('Email').fill(email)
await page.getByLabel('Password').fill('practice123')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 })

await page.goto('http://localhost:5173/calibrate', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.calibration-line', { timeout: 30000 })
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/drill-reading.png` })
console.log(`wrote ${OUT}/drill-reading.png`)

const words = (await page.locator('.calibration-line').first().innerText()).trim().split(/\s+/)
await page.getByRole('button', { name: /start listening|Read this one/ }).click()
await page.waitForFunction(() => !!window.__fakeRecognition, null, { timeout: 15000 })
await page.evaluate(async (list) => {
  let said = ''
  for (let i = 0; i < list.length; i++) {
    said = said ? `${said} ${list[i]}` : list[i]
    window.__fakeRecognition.emit(said, false)
    // A comma-length breath two-thirds through, a longer one at the end.
    const pause = i === Math.floor(list.length * 0.6) ? 520 : 140
    await new Promise((resolve) => setTimeout(resolve, i === list.length - 1 ? 900 : pause))
  }
  window.__fakeRecognition.emit(said, true)
}, words)
await page.getByRole('button', { name: 'Done reading' }).click()
await page.waitForSelector('text=Your writer wrote', { timeout: 20000 })
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/drill-marked.png`, fullPage: true })
console.log(`wrote ${OUT}/drill-marked.png`)

await browser.close()
await adminApp.delete()
