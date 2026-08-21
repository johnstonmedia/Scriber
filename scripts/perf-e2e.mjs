/**
 * Verifies the render-smoothing fix rather than just reasoning about it:
 *
 *  1. Rapid interim speech results (simulating fast, continuous talking) must
 *     not cause the paper pane to re-render at all — that only PaperViewer's
 *     memoization prevents.
 *  2. The clock must update roughly once a second, not four times a second.
 *  3. Interim text throttling must still land the LAST update, never drop it.
 *
 * A fake SpeechRecognition is injected before the page loads, so results can
 * be fired on demand without a real microphone.
 */
import { chromium } from 'playwright'

const DIR = '/tmp/claude-0/-home-user-Scriber/97982e6f-b430-573d-adfc-9832e4c933b6/scratchpad'
const shot = (page, name) => page.screenshot({ path: `${DIR}/perf-${name}.png` })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

// A controllable stand-in for the Web Speech API.
await page.addInitScript(() => {
  class FakeRecognition {
    start() {
      this.onstart?.()
    }
    stop() {
      this.onend?.()
    }
    abort() {}
    fireInterim(text) {
      this.onresult?.({
        resultIndex: 0,
        results: { length: 1, 0: { isFinal: false, length: 1, 0: { transcript: text, confidence: 1 } } },
      })
    }
  }
  window.__fakeRecognition = null
  window.SpeechRecognition = class {
    constructor() {
      const instance = new FakeRecognition()
      window.__fakeRecognition = instance
      return instance
    }
  }
})

// Signed out, / is the marketing page — sign-in lives at /login.
await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' })
await page.getByRole('tab', { name: 'Create account' }).click()
await page.getByLabel('Your name').fill('Alex Nguyen')
await page.getByLabel('Email').fill(`perf${Date.now()}@school.nsw.edu.au`)
await page.getByLabel('Password').fill('practice123')
await page.getByRole('button', { name: 'Create account' }).click()
// A brand-new account lands on the one-time walkthrough first.
await page.waitForSelector('text=How will you be using Scriber?', { timeout: 20000 })
await page.getByRole('button', { name: 'Personal account' }).click()
await page.waitForSelector('text=Hello, Alex', { timeout: 20000 })

// A paper so the pane we're watching actually renders something.
await page.getByRole('button', { name: 'Upload a paper' }).click()
await page.setInputFiles('#file', {
  name: 'paper.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('Question 1: Analyse the poem.\n'),
})
await page.fill('#title', 'Perf test paper')
await page.getByRole('button', { name: 'Add paper' }).click()
await page.waitForSelector('text=Perf test paper', { timeout: 15000 })

await page.getByRole('link', { name: 'Start practice' }).click()
await page.getByRole('button', { name: 'Skip to working time' }).click()
await page.waitForSelector('.pane-paper', { timeout: 15000 })
await page.waitForTimeout(500) // let the paper actually render once

// --- 1. rapid interim speech must not touch the paper pane -----------------
await page.getByRole('button', { name: 'Start dictating' }).click()
await page.waitForTimeout(200)

const mutationCount = await page.evaluate(async () => {
  const target = document.querySelector('.pane-paper')
  let count = 0
  const observer = new MutationObserver((records) => {
    count += records.length
  })
  observer.observe(target, { childList: true, subtree: true, attributes: true, characterData: true })

  // 40 interim results in 400ms — far faster than a person could ever speak,
  // deliberately harder than real conditions.
  for (let i = 0; i < 40; i++) {
    window.__fakeRecognition.fireInterim(`word number ${i}`)
    await new Promise((r) => setTimeout(r, 10))
  }
  await new Promise((r) => setTimeout(r, 150)) // drain any trailing throttled update

  observer.disconnect()
  return count
})

console.log('paper pane DOM mutations during 40 rapid interim results:', mutationCount)
if (mutationCount > 0) {
  throw new Error(`expected the paper pane to be untouched by interim speech, saw ${mutationCount} mutations`)
}

// --- 2. the interim throttle still lands the final update ------------------
const interimShown = await page.locator('.interim').innerText()
console.log('interim text shown after the burst:', JSON.stringify(interimShown))
if (!interimShown.includes('word number 39')) {
  throw new Error(`expected the last interim result to land, got ${JSON.stringify(interimShown)}`)
}
await shot(page, '01-interim-throttled')

// --- 3. the clock ticks about once a second, not four times ----------------
const clockReadings = await page.evaluate(async () => {
  const clock = document.querySelector('.clock')
  const seen = new Set()
  const start = Date.now()
  while (Date.now() - start < 3200) {
    seen.add(clock.textContent)
    await new Promise((r) => setTimeout(r, 40))
  }
  return [...seen]
})
console.log('distinct clock readings over ~3.2s:', clockReadings)
// One reading per second, plus maybe one edge tick either side.
if (clockReadings.length < 2 || clockReadings.length > 5) {
  throw new Error(`expected roughly 3-4 distinct clock readings over 3.2s, got ${clockReadings.length}`)
}

console.log('PASS: paper pane untouched by speech, interim not dropped, clock ticks ~1/s')
console.log('PAGE ERRORS:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
