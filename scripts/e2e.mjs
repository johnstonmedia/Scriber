import { chromium } from 'playwright'

const DIR = '/tmp/claude-0/-home-user-Scriber/97982e6f-b430-573d-adfc-9832e4c933b6/scratchpad'
const shot = (page, name) => page.screenshot({ path: `${DIR}/fb-${name}.png` })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
// A fresh address per run — the emulator keeps accounts between runs, and
// signing up twice with the same one lands on sign-in instead of onboarding.
const EMAIL = `alex${Date.now()}@school.nsw.edu.au`
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`))

// Signed out, / is the marketing page — sign-in lives at /login.
await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
await shot(page, '01-signin')

// --- create an account with email + password (Firebase Auth emulator)
await page.getByRole('tab', { name: 'Create account' }).click()
await page.getByLabel('Your name').fill('Alex Nguyen')
await page.getByLabel('Email').fill(EMAIL)
await page.getByLabel('Password').fill('practice123')
await page.getByRole('button', { name: 'Create account' }).click()
// A brand-new account lands on the one-time walkthrough first.
await page.waitForSelector('text=How will you be using Scriber?', { timeout: 20000 })
await page.getByRole('button', { name: 'Personal account' }).click()
await page.waitForSelector('text=Hello, Alex', { timeout: 20000 })
console.log('✓ email/password sign-up works')

// --- upload a paper (file stays in IndexedDB; metadata goes to Firestore)
await page.getByRole('button', { name: 'Upload a paper' }).click()
await page.setInputFiles('#file', {
  name: 'english-p1.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from(
    'Question 1 (20 marks)\n\nAnalyse how the composer of your prescribed text represents\nthe experience of discovery.\n',
  ),
})
await page.fill('#title', '2023 English Advanced Paper 1')
await page.fill('#subject', 'English Advanced')
await page.fill('#year', '2023')
await page.fill('#workingMinutes', '40')
await page.getByRole('button', { name: 'Add paper' }).click()
await page.waitForSelector('text=2023 English Advanced Paper 1', { timeout: 15000 })
console.log('✓ paper file kept locally + Firestore metadata works')
await shot(page, '02-dashboard')

// --- exam room
await page.getByRole('link', { name: 'Start practice' }).click()
await page.waitForSelector('text=Before you start')
await page.getByRole('button', { name: 'Skip to working time' }).click()
await page.waitForSelector('.mic-dock')

/*
 * Bursts a writer can actually hold. The third one used to run to nineteen
 * units against a memory of eighteen, so the writer lost its "full stop" and
 * asked for the tail again — correct behaviour, and invisible, because nothing
 * here checked what was written. Split at the comma, which is where somebody
 * dictating would draw breath anyway.
 */
const bursts = [
  'capital the composer represents discovery as an unsettling process comma not a triumphant one full stop',
  'new paragraph',
  'capital this is developed through the motif of the open sea comma',
  'which recurs at each turning point full stop',
  'the responder is positioned to question their own assumptions',
  'scratch that',
  'capital ultimately comma discovery is shown to be irreversible full stop',
]
/**
 * Wait for the writer to catch up.
 *
 * The writer takes words down at a person's pace, so firing six bursts a
 * tenth of a second apart overflows their memory and most of it is genuinely
 * lost — which is the simulation working, and which is why this used to print
 * a single word and assert nothing about it. Dictating at a pace a writer can
 * follow is what the exercise is for, so the test does that too.
 */
async function writerCaughtUp() {
  await page.waitForFunction(
    () => {
      const fill = document.querySelector('.load-bar-fill')
      if (!fill) return true
      const width = parseFloat(fill.style.width || '0')
      return width === 0
    },
    null,
    { timeout: 30000 },
  )
  // The queue being empty and the last unit being on the page are one drain
  // tick apart.
  await page.waitForTimeout(400)
}

for (const burst of bursts) {
  await page.getByLabel('Type your dictation').fill(burst)
  await page.getByRole('button', { name: 'Write' }).click()
  await writerCaughtUp()
  // The writer stops to ask how an unusual word is spelled. That is a feature
  // and it has its own coverage; here it would just stall the queue.
  const skip = page.getByRole('button', { name: /Skip|carry on/i })
  if (await skip.isVisible().catch(() => false)) {
    await skip.click()
    await writerCaughtUp()
  }
}
const written = await page.locator('.answer-sheet').innerText()
console.log('--- ANSWER SHEET ---\n' + written + '\n--------------------')

const expected =
  'The composer represents discovery as an unsettling process, not a triumphant one.\n\n' +
  'This is developed through the motif of the open sea, which recurs at each turning point. ' +
  'Ultimately, discovery is shown to be irreversible.'
if (written.trim() === expected) {
  console.log('✓ dictated commands wrote exactly the intended text, and "scratch that" took a burst back')
} else {
  console.log('✗ the answer sheet does not match what was dictated')
  console.log('  expected:', JSON.stringify(expected))
  console.log('  actual:  ', JSON.stringify(written.trim()))
  process.exitCode = 1
}
await shot(page, '03-exam')

await page.getByRole('button', { name: 'Finish' }).click()
await page.waitForSelector('text=How it went', { timeout: 15000 })
console.log('✓ session saved to Firestore and review loaded')
await shot(page, '04-review')

// --- settings round-trip through Firestore
await page.goto('http://localhost:5173/settings', { waitUntil: 'domcontentloaded' })
await page.getByText('the writer may add punctuation and capitals').first().click()
await page.waitForTimeout(800)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
const assisted = await page
  .locator('input[type=radio]')
  .nth(1)
  .isChecked()
console.log(assisted ? '✓ settings persisted to Firestore' : '✗ settings did NOT persist')
await shot(page, '05-settings')

// --- sign out, sign back in, data still there
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: 'Sign out' }).click()
// Signing out lands on the marketing page — sign-in is a separate route.
await page.waitForSelector('text=Practise with a writer', { timeout: 10000 })
await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
await page.getByLabel('Email').fill(EMAIL)
await page.getByLabel('Password').fill('practice123')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForSelector('text=2023 English Advanced Paper 1', { timeout: 15000 })
console.log('✓ sign out / sign in, papers and sessions persisted')
await shot(page, '06-persisted')

console.log('CONSOLE ERRORS:', errors.length ? errors.slice(0, 6) : 'none')
await browser.close()
