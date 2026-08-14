import { chromium } from 'playwright'

const DIR = '/tmp/claude-0/-home-user-Scriber/97982e6f-b430-573d-adfc-9832e4c933b6/scratchpad'
const shot = (page, name) => page.screenshot({ path: `${DIR}/fb-${name}.png` })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`))

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await shot(page, '01-signin')

// --- create an account with email + password (Firebase Auth emulator)
await page.getByRole('tab', { name: 'Create account' }).click()
await page.getByLabel('Your name').fill('Alex Nguyen')
await page.getByLabel('Email').fill('alex2@school.nsw.edu.au')
await page.getByLabel('Password').fill('practice123')
await page.getByRole('button', { name: 'Create account' }).click()
await page.waitForSelector('text=Hello, Alex', { timeout: 15000 })
console.log('✓ email/password sign-up works')

// --- upload a paper to the Storage emulator
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
console.log('✓ upload to Storage + Firestore metadata works')
await shot(page, '02-dashboard')

// --- exam room
await page.getByRole('link', { name: 'Start practice' }).click()
await page.waitForSelector('text=Before you start')
await page.getByRole('button', { name: 'Skip to working time' }).click()
await page.waitForSelector('.mic-dock')

const bursts = [
  'capital the composer represents discovery as an unsettling process comma not a triumphant one full stop',
  'new paragraph',
  'capital this is developed through the motif of the open sea comma which recurs at each turning point full stop',
  'the responder is positioned to question their own assumptions',
  'scratch that',
  'capital ultimately comma discovery is shown to be irreversible full stop',
]
for (const burst of bursts) {
  await page.getByLabel('Type your dictation').fill(burst)
  await page.getByRole('button', { name: 'Write' }).click()
  await page.waitForTimeout(150)
}
const written = await page.locator('.answer-sheet').innerText()
console.log('--- ANSWER SHEET ---\n' + written + '\n--------------------')
await shot(page, '03-exam')

await page.getByRole('button', { name: 'Finish' }).click()
await page.waitForSelector('text=How it went', { timeout: 15000 })
console.log('✓ session saved to Firestore and review loaded')
await shot(page, '04-review')

// --- settings round-trip through Firestore
await page.goto('http://localhost:5173/settings', { waitUntil: 'domcontentloaded' })
await page.getByText('Assisted — the writer may add punctuation and capitals').click()
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
await page.waitForSelector('text=Practise with a writer', { timeout: 10000 })
await page.getByLabel('Email').fill('alex2@school.nsw.edu.au')
await page.getByLabel('Password').fill('practice123')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForSelector('text=2023 English Advanced Paper 1', { timeout: 15000 })
console.log('✓ sign out / sign in, papers and sessions persisted')
await shot(page, '06-persisted')

console.log('CONSOLE ERRORS:', errors.length ? errors.slice(0, 6) : 'none')
await browser.close()
