/**
 * Reproduces the exact bug the user hit: the writer's working memory releases
 * a spoken burst one word at a time, at writing pace, and the assisted-mode
 * "add a closing full stop" heuristic must fire only once per burst — not once
 * per released word. Dictates two short sentences via the keyboard fallback
 * (which goes through the same lag/queue pipeline as real speech) and waits
 * out the full writing pace before reading the answer.
 */
import { chromium } from 'playwright'

const DIR = '/tmp/claude-0/-home-user-Scriber/97982e6f-b430-573d-adfc-9832e4c933b6/scratchpad'
const shot = (page, name) => page.screenshot({ path: `${DIR}/am-${name}.png` })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.getByRole('tab', { name: 'Create account' }).click()
await page.getByLabel('Your name').fill('Alex Nguyen')
await page.getByLabel('Email').fill(`assisted${Date.now()}@school.nsw.edu.au`)
await page.getByLabel('Password').fill('practice123')
await page.getByRole('button', { name: 'Create account' }).click()
await page.waitForSelector('text=Hello, Alex', { timeout: 20000 })

// Switch to assisted mode, and the patient writer so the wait is short.
await page.goto('http://localhost:5173/settings', { waitUntil: 'domcontentloaded' })
await page.getByText(/Assisted — the writer may add punctuation/).click()
await page.getByText('Patient writer').click()
await page.waitForTimeout(500)

await page.goto('http://localhost:5173/exam', { waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: 'Skip to working time' }).click()
await page.waitForSelector('.mic-dock')

const dictate = async (text) => {
  await page.getByLabel('Type your dictation').fill(text)
  await page.getByRole('button', { name: 'Write' }).click()
}

// Patient preset: ~500ms reaction, ~294ms/word. Five words needs ~2s to drain.
await dictate('the composer represents discovery vividly')
await page.waitForTimeout(3200)
const afterFirst = await page.locator('.answer-sheet').innerText()
console.log('after burst 1:', JSON.stringify(afterFirst))

const periodsInFirst = (afterFirst.match(/\./g) ?? []).length
if (periodsInFirst !== 1) {
  throw new Error(`expected exactly 1 period after one burst, found ${periodsInFirst}: ${afterFirst}`)
}
if (afterFirst !== 'The composer represents discovery vividly.') {
  throw new Error(`unexpected text: ${JSON.stringify(afterFirst)}`)
}

await dictate('it never lets the reader settle')
await page.waitForTimeout(3200)
const afterSecond = await page.locator('.answer-sheet').innerText()
console.log('after burst 2:', JSON.stringify(afterSecond))

const periodsInSecond = (afterSecond.match(/\./g) ?? []).length
if (periodsInSecond !== 2) {
  throw new Error(`expected exactly 2 periods after two bursts, found ${periodsInSecond}: ${afterSecond}`)
}
if (afterSecond !== 'The composer represents discovery vividly. It never lets the reader settle.') {
  throw new Error(`unexpected text: ${JSON.stringify(afterSecond)}`)
}

console.log('PASS: exactly one period per burst, not one per word')
await shot(page, '01-two-sentences')

console.log('PAGE ERRORS:', errors.length ? errors.slice(0, 3) : 'none')
await browser.close()
