/**
 * Accessibility audit across every screen somebody actually lands on.
 *
 * This is not a box-ticking exercise for this product. Scriber exists for
 * students who have been approved a writer or scribe — which is to say its
 * entire user base has a disability provision, and a good share of them use
 * a screen reader, a keyboard without a mouse, or a large-text browser
 * setting. A contrast failure here is not a style nit; it is the product
 * failing the only people it is for.
 *
 * Run: node scripts/a11y-audit.mjs [--json]
 * Needs the emulators and the dev server up.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'

const require = createRequire(import.meta.url)
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const BASE = 'http://localhost:5173'
const stamp = Date.now()
const email = `a11y${stamp}@school.test`
const orgId = `a11y-org-${stamp}`
const classId = 'a11y-class'
const testId = 'a11y-test'

const adminApp = initAdminApp({ projectId: 'demo-scriber' }, `a11y-${stamp}`)
const db = getAdminFirestore(adminApp)
const adminAuth = getAdminAuth(adminApp)

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))

/**
 * WCAG 2.1 AA, which is what Australian education procurement asks for and
 * what the Disability Discrimination Act is read against. Best-practice rules
 * are excluded: they are opinions, and mixing them in makes a real failure
 * hard to see.
 */
const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
}

const findings = []

async function audit(name, prepare) {
  await prepare()
  // Firestore holds a live listener open, so 'networkidle' never fires on a
  // signed-in page. A short settle after the document is ready is both
  // sufficient and honest about what is being measured.
  await page.waitForTimeout(600)
  await page.addScriptTag({ content: AXE })
  const result = await page.evaluate(
    (options) => window.axe.run(document, options),
    AXE_OPTIONS,
  )
  const violations = result.violations.filter((v) => v.nodes.length > 0)
  for (const violation of violations) {
    findings.push({
      screen: name,
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((n) => n.target.join(' ')).slice(0, 4),
    })
  }
  const worst = violations.map((v) => v.impact)
  const bad = worst.filter((i) => i === 'critical' || i === 'serious').length
  console.log(
    `${violations.length === 0 ? '✓' : '✗'}  ${name.padEnd(30)} ${violations.length} issue${
      violations.length === 1 ? '' : 's'
    }${bad > 0 ? ` (${bad} serious or worse)` : ''}`,
  )
}

// ---------------------------------------------------------------- signed out

await audit('marketing home', () => page.goto(BASE, { waitUntil: 'domcontentloaded' }))
await audit('privacy policy', () => page.goto(`${BASE}/privacy`, { waitUntil: 'domcontentloaded' }))
await audit('sign in', () => page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' }))
await audit('create account', async () => {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: 'Create account' }).click()
})

// ------------------------------------------------------------- an account

await page.getByLabel('Your name').fill('Avery Nguyen')
await page.getByLabel('Email').fill(email)
await page.getByLabel('Password').fill('practice123')
await page.getByRole('button', { name: 'Create account' }).click()

await audit('welcome walkthrough', () =>
  page.waitForSelector('text=How will you be using Scriber?', { timeout: 30000 }),
)
await page.getByRole('button', { name: 'Personal account' }).click()
await audit('dashboard', () => page.waitForSelector('text=Hello, Avery', { timeout: 30000 }))

await audit('settings', () => page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' }))

// ------------------------------------------------------- a school around them

const uid = (await adminAuth.getUserByEmail(email)).uid
await db.doc(`organisations/${orgId}`).set({
  name: 'Audit High School',
  createdBy: uid,
  createdAt: new Date().toISOString(),
  slug: null,
  settings: { defaultRuleProfile: 'strict', allowJoinRequests: true, identifyBy: 'examNumber' },
  branding: { accentColor: '#1F5FD8', tagline: 'Learning Support', logoDataUrl: null },
  plan: { kind: 'licensed', studentSeats: 50, expiresAt: null, setBy: 'audit', setAt: '' },
})
await db.doc(`organisations/${orgId}/members/${uid}`).set({
  uid,
  orgName: 'Audit High School',
  email,
  name: 'Avery Nguyen',
  role: 'teacher',
  status: 'active',
  classIds: [classId],
  joinedAt: new Date().toISOString(),
})
await db.doc(`organisations/${orgId}/classes/${classId}`).set({
  name: 'Year 12 English Advanced',
  teacherIds: [uid],
  studentIds: [],
  createdAt: new Date().toISOString(),
})
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
  phaseEndsAt: Date.now() + 60 * 60_000,
  scheduledAt: Date.now(),
  createdBy: uid,
  createdAt: new Date().toISOString(),
})
await db.doc(`organisations/${orgId}/tests/${testId}/participants/a11y-student`).set({
  uid: 'a11y-student',
  name: 'J. Marchetti',
  status: 'active',
  wordCount: 388,
  preview: '…memory is privileged over experience throughout the second stanza',
  updatedAt: new Date().toISOString(),
  paused: false,
  pauseEndsAt: null,
  pausedBy: null,
  attendance: 'present',
  sharing: true,
  extension: {
    connected: true,
    focused: false,
    tabCount: 2,
    otherTabs: [{ title: 'Search', host: 'www.google.com', active: true }],
    seenAt: new Date().toISOString(),
  },
})

await audit('organisations list', () =>
  page.goto(`${BASE}/organisations`, { waitUntil: 'domcontentloaded' }),
)
await audit('school portal', async () => {
  await page.goto(`${BASE}/organisations/${orgId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=Coming up', { timeout: 30000 })
})
await audit('supervisor monitor', async () => {
  await page.goto(`${BASE}/organisations/${orgId}/tests/${testId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=J. Marchetti', { timeout: 30000 })
})

// ------------------------------------------------------------------- report

console.log('')
if (findings.length === 0) {
  console.log('No WCAG 2.1 AA violations found.')
} else {
  const bySeverity = { critical: [], serious: [], moderate: [], minor: [] }
  for (const f of findings) (bySeverity[f.impact] ?? bySeverity.minor).push(f)
  for (const level of ['critical', 'serious', 'moderate', 'minor']) {
    for (const f of bySeverity[level]) {
      console.log(`[${level}] ${f.screen} — ${f.id}`)
      console.log(`    ${f.help}`)
      console.log(`    ${f.nodes.join('\n    ')}`)
    }
  }
}

if (process.argv.includes('--json')) {
  console.log(`\n${JSON.stringify(findings, null, 2)}`)
}

await adminApp.delete()
await browser.close()

// Critical and serious block; moderate and minor are reported and don't fail
// the run, so the suite stays useful rather than becoming something people
// start skipping.
const blocking = findings.filter((f) => f.impact === 'critical' || f.impact === 'serious')
console.log(
  `\n${findings.length} issue${findings.length === 1 ? '' : 's'} across 11 screens, ` +
    `${blocking.length} of them serious or worse.`,
)
process.exit(blocking.length === 0 ? 0 : 1)
