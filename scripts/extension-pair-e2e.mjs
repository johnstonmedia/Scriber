/**
 * Pairing the extension with nobody typing anything.
 *
 * extension-e2e covers the two endpoints; this covers the part that failed in
 * practice — the relay. A signed-in page mints a token and hands it across
 * two boundaries it cannot await through: page → content script → service
 * worker. Nothing about that is provable from an API test, so this loads the
 * real unpacked extension in a real browser and checks the token comes to
 * rest in the worker's own storage.
 *
 * Needs: emulators, the API dev server (npm run api), and the dev server.
 */
import { chromium } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'

const DIR = '/tmp/claude-0/-home-user-Scriber/97982e6f-b430-573d-adfc-9832e4c933b6/scratchpad'
const EXTENSION = resolve('extension')
const stamp = Date.now()
const email = `pair-e2e${stamp}@school.test`

const adminApp = initAdminApp({ projectId: 'demo-scriber' }, `pair-${stamp}`)
const adminDb = getAdminFirestore(adminApp)
const adminAuth = getAdminAuth(adminApp)

const results = []
const check = (name, passed, detail) => {
  results.push({ name, passed })
  console.log(`${passed ? '✓' : '✗ FAIL'}  ${name}${passed || !detail ? '' : ` — ${detail}`}`)
}

// An extension only loads into a persistent context — there is no way to
// attach one to an ordinary browser. Chromium's current headless mode does
// run MV3 service workers, so this needs no display.
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'scriber-ext-')), {
  executablePath: '/opt/pw-browsers/chromium',
  viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
})

const worker =
  context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 20000 }))
check('the extension service worker started', !!worker)

const page = context.pages()[0] ?? (await context.newPage())
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))

// ------------------------------------------------------------ 1. an account

await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
await page.getByRole('tab', { name: 'Create account' }).click()
await page.getByLabel('Your name').fill('Pair Tester')
await page.getByLabel('Email').fill(email)
await page.getByLabel('Password').fill('practice123')
await page.getByRole('button', { name: 'Create account' }).click()
await page
  .getByRole('button', { name: 'Personal account' })
  .click({ timeout: 30000 })
  .catch(async () => {
    await page.screenshot({ path: `${DIR}/pair-signup.png`, fullPage: true })
    throw new Error(`the account never reached the walkthrough — at ${page.url()}`)
  })
await page.waitForSelector('text=Hello, Pair', { timeout: 30000 })

const uid = (await adminAuth.getUserByEmail(email)).uid

// The pairing panel is only offered to somebody who belongs to a school,
// since a personal account never sits a supervised test. Seeded directly —
// the join flow is org-e2e's job, not this script's.
const orgId = `pair-org-${stamp}`
await adminDb.doc(`organisations/${orgId}`).set({
  name: `Pairing High ${stamp}`,
  createdBy: uid,
  createdAt: new Date().toISOString(),
  slug: null,
  settings: { defaultRuleProfile: 'strict', allowJoinRequests: true, identifyBy: 'examNumber' },
  branding: { accentColor: '#1F5FD8', tagline: '', logoDataUrl: null },
  plan: { kind: 'demo', studentSeats: 5, expiresAt: null, setBy: 'harness', setAt: '' },
})
await adminDb.doc(`organisations/${orgId}/members/${uid}`).set({
  uid,
  orgName: `Pairing High ${stamp}`,
  email,
  name: 'Pair Tester',
  role: 'student',
  status: 'active',
  classIds: [],
  joinedAt: new Date().toISOString(),
})

// ------------------------------------------------- 2. the page sees it there

await page.goto('http://localhost:5173/settings', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('text=Exam supervision', { timeout: 30000 })
const installedBadge = await page.locator('text=Extension installed').isVisible().catch(() => false)
check('the page can tell the extension is installed', installedBadge)

// ------------------------------------------------------ 3. pair, no typing

const pairButton = page.getByRole('button', { name: 'Pair this extension' })
await pairButton.waitFor({ state: 'visible', timeout: 20000 })
await pairButton.click()

const confirmed = await page
  .waitForSelector('text=Paired.', { timeout: 25000 })
  .then(() => true)
  .catch(() => false)
if (!confirmed) {
  await page.screenshot({ path: `${DIR}/pair-failed.png`, fullPage: true })
  const alert = await page.locator('.small', { hasText: /could not|expired|unavailable/i })
    .first()
    .innerText()
    .catch(() => '(no message)')
  check('pairing completes without a typed code', false, alert)
} else {
  check('pairing completes without a typed code', true)
}

// ------------------------- 4. the token came to rest where it has to be used

const stored = await worker.evaluate(async () => {
  const bag = await chrome.storage.local.get('token')
  return typeof bag.token === 'string' ? bag.token.length : 0
})
check('the service worker holds the token', stored > 20, `length ${stored}`)

// And the backend knows about it — hashed, never raw.
const tokens = await adminDb.collection('extensionTokens').where('uid', '==', uid).get()
check('the backend issued exactly one token for this student', tokens.size === 1, `saw ${tokens.size}`)
const holdsRaw = tokens.docs.some((d) => Object.values(d.data()).some((v) => typeof v === 'string' && v.length > 40))
check('the raw token is never stored', !holdsRaw)

// The code minted on the student's behalf must be spent, not left lying about
// for anyone who guesses it.
const leftovers = await adminDb.collection('extensionPairings').where('uid', '==', uid).get()
check('the pairing code was spent, not left outstanding', leftovers.empty, `${leftovers.size} left`)

await adminApp.delete()
await context.close()

const failed = results.filter((r) => !r.passed)
console.log(`\n${results.length - failed.length}/${results.length} pairing checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
