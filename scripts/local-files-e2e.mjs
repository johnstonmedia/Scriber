/**
 * Exam papers must live on the device, never in the cloud. Checks the file
 * survives a reload, that no Storage request is ever made, and that a paper
 * whose file is missing locally is shown as such and can be re-attached.
 */
import { chromium } from 'playwright'

const DIR = '/tmp/claude-0/-home-user-Scriber/97982e6f-b430-573d-adfc-9832e4c933b6/scratchpad'
const shot = (page, name) => page.screenshot({ path: `${DIR}/lf-${name}.png` })
const PAPER = Buffer.from(
  'Question 1 (20 marks)\n\nAnalyse how the composer represents discovery.\n',
)

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

const storageCalls = []
page.on('request', (r) => {
  if (/firebasestorage|storage\.googleapis/.test(r.url())) storageCalls.push(r.url())
})
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const email = `local${Date.now()}@school.nsw.edu.au`
// Signed out, / is the marketing page — sign-in lives at /login.
await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
await page.getByRole('tab', { name: 'Create account' }).click()
await page.getByLabel('Your name').fill('Alex Nguyen')
await page.getByLabel('Email').fill(email)
await page.getByLabel('Password').fill('practice123')
await page.getByRole('button', { name: 'Create account' }).click()
// A brand-new account lands on the one-time walkthrough first.
await page.waitForSelector('text=How will you be using Scriber?', { timeout: 20000 })
await page.getByRole('button', { name: 'Personal account' }).click()
await page.waitForSelector('text=Hello, Alex', { timeout: 20000 })

// --- add a paper -----------------------------------------------------------
await page.getByRole('button', { name: 'Upload a paper' }).click()
await page.setInputFiles('#file', {
  name: 'english-p1.txt',
  mimeType: 'text/plain',
  buffer: PAPER,
})
await page.fill('#title', '2023 English Advanced Paper 1')
await page.getByRole('button', { name: 'Add paper' }).click()
await page.waitForSelector('text=2023 English Advanced Paper 1', { timeout: 15000 })
await page.waitForSelector('text=On this device', { timeout: 10000 })
console.log('added: badge says "On this device"')
await shot(page, '01-library')

// --- it is genuinely in IndexedDB, not just in memory ----------------------
const stored = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const open = indexedDB.open('scriber-papers')
      open.onsuccess = () => {
        const tx = open.result.transaction('files', 'readonly')
        const all = tx.objectStore('files').getAll()
        all.onsuccess = () =>
          resolve(all.result.map((r) => ({ name: r.name, size: r.size, type: r.type })))
        all.onerror = () => resolve('error')
      }
      open.onerror = () => resolve('cannot open')
    }),
)
console.log('indexeddb:', JSON.stringify(stored))
if (!Array.isArray(stored) || stored.length !== 1) throw new Error('file not in IndexedDB')

// --- survives a reload and opens in the exam room --------------------------
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('text=On this device', { timeout: 20000 })
await page.getByRole('link', { name: 'Start practice' }).click()
await page.getByRole('button', { name: 'Skip to working time' }).click()
await page.waitForSelector('.pane-paper', { timeout: 15000 })
const shown = await page.locator('.pane-paper').innerText()
console.log('paper renders after reload:', shown.includes('Analyse how the composer'))
if (!shown.includes('Analyse how the composer')) throw new Error('paper did not render')
await shot(page, '02-exam-room')

// --- nothing ever went to Cloud Storage ------------------------------------
console.log('storage requests made:', storageCalls.length === 0 ? 'none' : storageCalls)
if (storageCalls.length) throw new Error('a Cloud Storage request was made')

// --- a second device: same account, empty IndexedDB ------------------------
const second = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const other = await second.newPage()
await other.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
await other.getByLabel('Email').fill(email)
await other.getByLabel('Password').fill('practice123')
await other.getByRole('button', { name: 'Sign in' }).click()
await other.waitForSelector('text=Hello, Alex', { timeout: 20000 })
await other.waitForSelector('text=2023 English Advanced Paper 1', { timeout: 15000 })

const elsewhere = await other.locator('text=File not on this device').count()
console.log('second device shows the paper but not the file:', elsewhere === 1)
if (elsewhere !== 1) throw new Error('cross-device state not shown')
await shot(other, '03-other-device')

// --- and the file can be put back there ------------------------------------
await other.setInputFiles('input[type=file][hidden]', {
  name: 'english-p1.txt',
  mimeType: 'text/plain',
  buffer: PAPER,
})
await other.waitForSelector('text=On this device', { timeout: 15000 })
console.log('re-attached on the second device: ok')
await shot(other, '04-reattached')

console.log('PAGE ERRORS:', errors.length ? errors.slice(0, 3) : 'none')
await browser.close()
