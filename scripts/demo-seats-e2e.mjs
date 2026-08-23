/**
 * Drives the commercial path through the real UI, end to end:
 *
 *   1. A school with no account fills in the demo form on the public site.
 *   2. A site admin sees the request, starts a demo, and the organisation is
 *      created on a five-student plan with the school's contact invited in as
 *      its admin.
 *   3. The school's admin accepts, and fills the demo: five students go in,
 *      the sixth is refused with a sentence they can act on — not an error.
 *   4. The site admin licenses the school to a tier, and the sixth student
 *      goes straight in.
 *
 * The cap is the point of the whole thing, so step 3 is the assertion that
 * matters: it has to hold from the browser, through the library, on a real
 * roster.
 *
 * Run with the emulators (auth, firestore) and the dev server up.
 */
import { chromium } from 'playwright'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
// Without this the Admin SDK reaches for real Google credentials the moment
// anything touches Auth, and fails long before it says why.
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'

const DIR = '/tmp/claude-0/-home-user-Scriber/97982e6f-b430-573d-adfc-9832e4c933b6/scratchpad'
const shot = (page, name) => page.screenshot({ path: `${DIR}/seats-${name}.png`, fullPage: true })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const stamp = Date.now()
const SCHOOL = `Seat Cap High ${stamp}`
const emails = {
  siteAdmin: `seats-siteadmin${stamp}@scriber.test`,
  schoolAdmin: `seats-head${stamp}@school.test`,
}

const adminApp = initAdminApp({ projectId: 'demo-scriber' }, `seats-${stamp}`)
const adminDb = getAdminFirestore(adminApp)
const adminAuth = getAdminAuth(adminApp)

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  return page
}

async function createAccount(page, email, name) {
  await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: 'Create account' }).click()
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('practice123')
  await page.getByRole('button', { name: 'Create account' }).click()
}

/**
 * Clears the one-time welcome walkthrough if it's showing. Tolerant on
 * purpose: where a new account lands depends on whether an invite is already
 * waiting for it, so both accounts here meet this at a different moment.
 */
async function clearWelcome(page) {
  // Wait on the button itself, not the heading: it takes a moment to render,
  // so an immediate check always misses it — and the walkthrough can move on
  // by itself, so everything here is best-effort.
  const choice = page.getByRole('button', { name: 'Personal account' })
  const showed = await choice
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false)
  if (!showed) return
  await choice.click({ timeout: 10000 }).catch(() => undefined)
  await page
    .waitForSelector('text=How will you be using Scriber?', { state: 'detached', timeout: 20000 })
    .catch(() => undefined)
}

/** Verifies through the emulator's own OOB endpoint, then signs back in. */
async function verifyEmail(page, email) {
  const signInResp = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'practice123', returnSecureToken: true }),
    },
  ).then((r) => r.json())
  await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'VERIFY_EMAIL', idToken: signInResp.idToken }),
  })
  const oobCodes = await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-scriber/oobCodes').then((r) =>
    r.json(),
  )
  const code = oobCodes.oobCodes.at(-1)?.oobCode
  if (!code) throw new Error(`no oobCode found for ${email}`)
  await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oobCode: code }),
  })
}

/**
 * A freshly created account is still signed in, and /login redirects a
 * signed-in visitor straight back out — so the session has to be dropped
 * before signing in again. signOut() is async: waiting for the very button
 * just clicked to disappear is the confirmation it actually landed.
 */
async function signOut(page) {
  const button = page.getByRole('button', { name: 'Sign out' })
  await button.click().catch(() => undefined)
  await button.waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined)
}

async function signIn(page, email) {
  await signOut(page)
  await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('practice123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 })
  await clearWelcome(page)
}

// -------------------------------------------- 1. a school asks for a demo

const publicPage = await newPage()
await publicPage.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await publicPage.getByLabel('School or organisation').fill(SCHOOL)
await publicPage.getByLabel('Your name').fill('Sam Patel')
await publicPage.getByLabel('Work email').fill(emails.schoolAdmin)
await publicPage.getByLabel('Your role').fill('Head of Learning Support')
await publicPage.getByLabel('Students with a writer provision').fill('About 25')
await publicPage.getByRole('button', { name: 'Request a demo' }).click()
await publicPage.waitForSelector("text=Thanks — that's with us.", { timeout: 15000 })
console.log('a school with no account asked for a demo')
await shot(publicPage, '01-requested')

// It has to be filed, and it has to be unreadable by the person who filed it.
const filed = await adminDb.collection('demoRequests').where('organisation', '==', SCHOOL).get()
if (filed.size !== 1) throw new Error(`expected exactly one filed request, saw ${filed.size}`)
if (filed.docs[0].data().status !== 'new') throw new Error('a filed request should start as new')

// ------------------------------------------ 2. a site admin starts the demo

const sitePage = await newPage()
await createAccount(sitePage, emails.siteAdmin, 'Site Admin')
await clearWelcome(sitePage)
await verifyEmail(sitePage, emails.siteAdmin)
const siteAdminUid = (await adminAuth.getUserByEmail(emails.siteAdmin)).uid
// Seeded exactly as a human would in the Firebase console — the one
// legitimate way the first site admin comes into being.
await adminDb.doc(`siteAdmins/${siteAdminUid}`).set({ grantedAt: new Date().toISOString() })

await signIn(sitePage, emails.siteAdmin)
await sitePage.goto('http://localhost:5173/admin', { waitUntil: 'domcontentloaded' })
await sitePage.waitForSelector('text=Demo requests', { timeout: 20000 }).catch(async () => {
  await shot(sitePage, '02a-no-queue')
  throw new Error('the site admin page never rendered the demo request queue')
})
const requestCard = sitePage.locator('div.stack.gap-2').filter({ hasText: SCHOOL })
await requestCard.waitFor({ state: 'visible', timeout: 20000 }).catch(async () => {
  await shot(sitePage, '02a-no-request')
  throw new Error(`the queue never showed the request from ${SCHOOL}`)
})
await requestCard.getByRole('button', { name: 'Start demo' }).click()
await requestCard
  .getByRole('link', { name: 'Open their organisation' })
  .waitFor({ timeout: 20000 })
  .catch(async () => {
    await shot(sitePage, '02b-start-failed')
    const alert = await sitePage.locator('.alert-error').first().innerText().catch(() => '(no alert)')
    throw new Error(`starting the demo never produced an organisation: ${alert}`)
  })
console.log('the site admin started a demo from the request')
await shot(sitePage, '02-demo-started')

const orgs = await adminDb.collection('organisations').where('name', '==', SCHOOL).get()
if (orgs.size !== 1) throw new Error(`expected the demo organisation to exist, saw ${orgs.size}`)
const orgId = orgs.docs[0].id
const plan = orgs.docs[0].data().plan
if (plan?.kind !== 'demo' || plan?.studentSeats !== 5) {
  throw new Error(`expected a 5-seat demo plan, saw ${JSON.stringify(plan)}`)
}
console.log('the organisation exists on a five-student demo plan:', orgId)

// The school's own contact was invited in as its admin, so nothing has to be
// handed over by us afterwards.
const invite = await adminDb.doc(`organisations/${orgId}/invites/${emails.schoolAdmin}`).get()
if (!invite.exists || invite.data().role !== 'admin') {
  throw new Error("expected the school's contact to be invited as an admin")
}
console.log("the school's contact was invited as its admin")

// ------------------------------- 3. the school's admin accepts and fills up

const schoolPage = await newPage()
await createAccount(schoolPage, emails.schoolAdmin, 'Sam Patel')
await clearWelcome(schoolPage)
await verifyEmail(schoolPage, emails.schoolAdmin)
await signIn(schoolPage, emails.schoolAdmin)
await schoolPage.goto('http://localhost:5173/organisations', { waitUntil: 'domcontentloaded' })
await schoolPage.getByRole('button', { name: 'Accept invitation' }).click()
// The invite card and the membership card both carry the school's name, so
// the honest signal that acceptance landed is the Open link only a real
// membership renders.
await schoolPage
  .getByRole('link', { name: 'Open' })
  .first()
  .waitFor({ state: 'visible', timeout: 20000 })
  .catch(async () => {
    await shot(schoolPage, '03a-accept-failed')
    const alert = await schoolPage.locator('.alert-error').first().innerText().catch(() => '(no alert)')
    throw new Error(`the school could not accept its own admin invite: ${alert}`)
  })
console.log('the school accepted and now runs its own organisation')

await schoolPage.goto(`http://localhost:5173/organisations/${orgId}`, { waitUntil: 'domcontentloaded' })
await schoolPage
  .getByRole('button', { name: 'Roster' })
  .click({ timeout: 30000 })
  .catch(async () => {
    await shot(schoolPage, '03a-no-roster')
    throw new Error('the school admin never reached their own roster')
  })
await schoolPage.waitForSelector('text=student seats taken', { timeout: 20000 })

// Five students fill the demo exactly.
for (let i = 1; i <= 5; i += 1) {
  const email = `seats-student${i}-${stamp}@school.test`
  await schoolPage.getByPlaceholder('Invite by email').fill(email)
  await schoolPage.locator('select[name="role"]').selectOption('student')
  await schoolPage.getByRole('button', { name: 'Invite' }).click()
  await schoolPage.waitForSelector(`text=${email}`, { timeout: 15000 })
}
console.log('five students fill the demo')
await shot(schoolPage, '03-demo-full')

await schoolPage.waitForSelector('text=5 of 5 student seats taken', { timeout: 10000 })

// The sixth is the whole point.
await schoolPage.getByPlaceholder('Invite by email').fill(`seats-student6-${stamp}@school.test`)
await schoolPage.locator('select[name="role"]').selectOption('student')
await schoolPage.getByRole('button', { name: 'Invite' }).click()
const refusal = schoolPage.locator('.alert-error')
await refusal.waitFor({ state: 'visible', timeout: 15000 })
const refusalText = await refusal.innerText()
if (!/demo/i.test(refusalText) || !/5 students/.test(refusalText)) {
  throw new Error(`expected a readable seat-limit message, saw: ${refusalText}`)
}
if (/SCR-/.test(refusalText)) {
  throw new Error(`a full school is not a fault and must not get an error code: ${refusalText}`)
}
console.log('the sixth student is refused, with a sentence the school can act on')
await shot(schoolPage, '04-refused')

// Staff never take a seat, so a teacher still goes in on a full demo.
const teacherEmail = `seats-teacher-${stamp}@school.test`
await schoolPage.getByPlaceholder('Invite by email').fill(teacherEmail)
await schoolPage.locator('select[name="role"]').selectOption('teacher')
await schoolPage.getByRole('button', { name: 'Invite' }).click()
await schoolPage.waitForSelector(`text=${teacherEmail}`, { timeout: 15000 })
console.log('a teacher still goes in on a full demo — staff never use a seat')

// ------------------------------------------- 4. the site admin licenses them

await sitePage.reload({ waitUntil: 'domcontentloaded' })
const orgRow = sitePage.locator('.row').filter({ hasText: SCHOOL }).last()
await orgRow.waitFor({ state: 'visible', timeout: 20000 })
await orgRow.getByLabel(`Student seats for ${SCHOOL}`).selectOption('30')
await sitePage.waitForSelector('text=Licensed — up to 30 students', { timeout: 20000 })
console.log('the site admin licensed the school to 30 seats')
await shot(sitePage, '05-licensed')

// The refused student now goes straight in.
await schoolPage.reload({ waitUntil: 'domcontentloaded' })
await schoolPage.getByRole('button', { name: 'Roster' }).click()
// Five invites still stand; the teacher never took a seat.
await schoolPage.waitForSelector('text=5 of 30 student seats taken', { timeout: 20000 })
await schoolPage.getByPlaceholder('Invite by email').fill(`seats-student6-${stamp}@school.test`)
await schoolPage.locator('select[name="role"]').selectOption('student')
await schoolPage.getByRole('button', { name: 'Invite' }).click()
await schoolPage.waitForSelector(`text=seats-student6-${stamp}@school.test`, { timeout: 15000 })
await schoolPage.waitForSelector('text=6 of 30 student seats taken', { timeout: 15000 })
console.log('the previously refused student goes in on the licensed plan')
await shot(schoolPage, '06-licensed-roster')

await adminApp.delete()
await browser.close()
console.log('\nALL DEMO + SEAT E2E STEPS PASSED')
