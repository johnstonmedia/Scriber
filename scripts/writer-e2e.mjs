/**
 * Drives the writer's human limits in a real browser: the lag before writing,
 * the load bar filling and overflowing into a repeat request, and the spelling
 * question. Run with the emulators and dev server up.
 */
import { chromium } from 'playwright'

const DIR = '/tmp/claude-0/-home-user-Scriber/97982e6f-b430-573d-adfc-9832e4c933b6/scratchpad'
const shot = (page, name) => page.screenshot({ path: `${DIR}/w-${name}.png` })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`))

const dictate = async (text) => {
  await page.getByLabel('Type your dictation').fill(text)
  await page.getByRole('button', { name: 'Write' }).click()
}

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.getByRole('tab', { name: 'Create account' }).click()
await page.getByLabel('Your name').fill('Alex Nguyen')
await page.getByLabel('Email').fill(`writer${Date.now()}@school.nsw.edu.au`)
await page.getByLabel('Password').fill('practice123')
await page.getByRole('button', { name: 'Create account' }).click()
await page.waitForSelector('text=Hello, Alex', { timeout: 20000 })

// Use the demanding writer so the limits are easy to provoke.
await page.goto('http://localhost:5173/settings', { waitUntil: 'domcontentloaded' })
await page.getByText('Demanding writer').click()
await page.waitForTimeout(600)
await shot(page, '01-settings-writer')

await page.goto('http://localhost:5173/exam', { waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: 'Skip to working time' }).click()
await page.waitForSelector('.mic-dock')

// --- 1. the writer lags behind -------------------------------------------
await dictate('the composer represents discovery as unsettling')
await page.waitForTimeout(250)
const immediately = await page.locator('.answer-sheet').innerText()
await page.waitForTimeout(2500)
const midway = await page.locator('.answer-sheet').innerText()
await page.waitForTimeout(3000)
const settled = await page.locator('.answer-sheet').innerText()
console.log(`lag: +0.25s ${JSON.stringify(immediately.slice(0, 45))}`)
console.log(`     +2.75s ${JSON.stringify(midway)}`)
console.log(`     +5.75s ${JSON.stringify(settled)}`)
// Nothing on the page yet, then partial, then the whole burst.
if (immediately.includes('composer')) throw new Error('the writer wrote instantly')
if (!midway.includes('composer')) throw new Error('the writer never started')
if (!settled.includes('unsettling')) throw new Error('the writer never caught up')

// --- 2. the load bar and the repeat request -------------------------------
await dictate(
  'the poem sustains this idea through a sequence of images that accumulate across the second stanza and refuse any comfortable resolution for the reader who has followed the speaker this far into the argument',
)
await page.waitForTimeout(150)
const tone = await page.locator('.load-bar').getAttribute('data-tone')
const width = await page.locator('.load-bar-fill').evaluate((n) => n.style.width)
console.log(`load bar: tone=${tone} width=${width}`)
await shot(page, '02-load-critical')

await page.waitForSelector('.writer-says', { timeout: 5000 })
const askedToRepeat = await page.locator('.writer-says').innerText()
console.log(`repeat request: ${JSON.stringify(askedToRepeat.replace(/\s+/g, ' ').slice(0, 110))}`)
await shot(page, '03-repeat-request')
await page.getByRole('button', { name: 'Got it' }).click()

// --- 3. the spelling question ---------------------------------------------
// The warm-up means a real session waits ~45s. Fast-forward it here.
await page.waitForTimeout(4000)
await page.evaluate(() => window.__scriberAgeSession?.(120_000))
let asked = false
// Demanding preset only has a 30% chance per word, and needs its full
// reaction time (900ms) plus writing pace (500ms/word) to even be
// evaluated — 1600ms was too tight a margin. 2500ms with more candidate
// words keeps this reliable without weakening what it actually checks.
// 20 words at a 30% chance each is a >99.9% chance of at least one hit —
// worth the margin since this script gets rerun a lot during development.
for (const word of [
  'irreversible', 'unequivocal', 'palimpsest', 'verisimilitude', 'antediluvian',
  'incontrovertible', 'juxtaposition', 'circumlocution', 'perspicacious',
  'idiosyncratic', 'quintessential', 'surreptitious', 'unprecedented',
  'multifaceted', 'inconsequential', 'disproportionate', 'counterintuitive',
  'characteristically', 'unequivocally', 'extraordinarily',
]) {
  await dictate(word)
  await page.waitForTimeout(2500)
  if (await page.locator('.spell-check').count()) {
    asked = true
    break
  }
}
if (!asked) throw new Error('the writer never asked about a spelling')

console.log('spelling question shown')
await shot(page, '04-spell-check')

// A blank should hold the word's place without giving the letters away.
const sheet = await page.locator('.answer-sheet').innerText()
console.log(`placeholder in answer: ${sheet.includes('▁')}`)

await page.getByLabel('Spell the word').fill('i r r e v e r s i b l e')
await page.getByRole('button', { name: "That's it" }).click()
await page.waitForTimeout(1200)
console.log('after answering, question gone:', (await page.locator('.spell-check').count()) === 0)
await shot(page, '05-after-spelling')

await page.getByRole('button', { name: 'Finish' }).click()
await page.waitForSelector('text=How it went', { timeout: 20000 })
await shot(page, '06-review')
const report = await page.locator('.stat-grid').innerText()
console.log('--- report ---\n' + report.replace(/\n+/g, ' | '))
if (await page.locator('text=How your writer coped').count()) {
  console.log('coped: ' + (await page.locator('text=How your writer coped').locator('..').innerText()).replace(/\s+/g, ' ').slice(0, 220))
}

console.log('CONSOLE ERRORS:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
