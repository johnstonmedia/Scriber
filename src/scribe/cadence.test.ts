import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PER_WORD_MS,
  MAX_PER_WORD_MS,
  MIN_PER_WORD_MS,
  createCadence,
  observeDelivery,
  perWordFrom,
  silencesOf,
  type Delivery,
} from './cadence'

/** Fluent speech: words arrive in lumps, the interval is the speaking time. */
function fluent(perWord: number, lumps: number[]): Delivery[] {
  return lumps.map((words) => ({ words, intervalMs: words * perWord }))
}

test('a lumpy delivery with no pause in it reports no silence', () => {
  // This is the bug, stated as a test. Four words arriving together is 1200ms
  // of interval and no silence at all; the old measurement called it a full
  // stop.
  const silences = silencesOf(fluent(300, [1, 2, 3, 4, 1, 2, 3, 4]))
  assert.ok(
    silences.every((ms) => ms === 0),
    `found silence where there was none: ${silences.join(', ')}`,
  )
})

test('a real pause survives the subtraction', () => {
  const deliveries = [
    ...fluent(300, [1, 2, 3, 1, 2, 3]),
    // One word, but 1200ms since the last delivery: 900ms of it was silence.
    { words: 1, intervalMs: 1200 },
  ]
  const silences = silencesOf(deliveries)
  assert.equal(silences[silences.length - 1], 900)
})

test('a slow speaker is not punctuated for being slow', () => {
  // 550ms a word, no pauses. A fixed subtraction tuned for a brisk speaker
  // would read a quarter of a second of imaginary silence at every boundary.
  const silences = silencesOf(fluent(550, [1, 1, 2, 1, 3, 1, 2, 2]))
  assert.ok(silences.every((ms) => ms === 0), silences.join(', '))
})

test('a fast speaker still has their pauses found', () => {
  const deliveries = [...fluent(150, [1, 2, 1, 3, 1, 2]), { words: 1, intervalMs: 800 }]
  const silences = silencesOf(deliveries)
  assert.equal(silences[silences.length - 1], 650)
})

test('the rate is taken from the median, so pauses do not drag it', () => {
  const implied = [300, 300, 310, 290, 300, 1400, 300, 1800]
  assert.ok(Math.abs(perWordFrom(implied) - 300) < 15, String(perWordFrom(implied)))
})

test('the rate is clamped to what a person can actually do', () => {
  assert.equal(perWordFrom([10, 10, 10, 10]), MIN_PER_WORD_MS)
  assert.equal(perWordFrom([9000, 9000, 9000, 9000]), MAX_PER_WORD_MS)
})

test('too few deliveries to know anything falls back to the default', () => {
  assert.equal(perWordFrom([120, 130]), DEFAULT_PER_WORD_MS)
  assert.equal(silencesOf([]).length, 0)
})

// ----------------------------------------------------------------- online

test('the online estimate converges on the speaker own rate', () => {
  let cadence = createCadence()
  for (const delivery of fluent(480, [1, 2, 1, 3, 2, 1, 2, 3, 1, 2])) {
    cadence = observeDelivery(cadence, delivery).cadence
  }
  assert.ok(Math.abs(cadence.perWordMs - 480) < 30, String(cadence.perWordMs))
})

test('once converged, a lumpy fluent delivery reports nothing', () => {
  let cadence = createCadence()
  for (const delivery of fluent(480, [1, 2, 1, 3, 2, 1])) {
    cadence = observeDelivery(cadence, delivery).cadence
  }
  const result = observeDelivery(cadence, { words: 4, intervalMs: 4 * 480 })
  assert.equal(result.silenceMs, 0)
})

test('a pause cannot inflate what is subtracted from itself', () => {
  let cadence = createCadence()
  for (const delivery of fluent(300, [1, 2, 1, 3, 2, 1])) {
    cadence = observeDelivery(cadence, delivery).cadence
  }
  const before = cadence.perWordMs
  const result = observeDelivery(cadence, { words: 1, intervalMs: 2000 })
  // Measured against the rate learned before it, not one this pause moved.
  assert.equal(result.silenceMs, 2000 - before)
})

test('one enormous pause does not move the estimate much', () => {
  let cadence = createCadence()
  for (const delivery of fluent(300, [1, 2, 1, 3, 2, 1, 2, 1])) {
    cadence = observeDelivery(cadence, delivery).cadence
  }
  const before = cadence.perWordMs
  const after = observeDelivery(cadence, { words: 1, intervalMs: 5000 }).cadence
  assert.ok(Math.abs(after.perWordMs - before) < 40, `${before} -> ${after.perWordMs}`)
})

test('silence is never negative', () => {
  const cadence = createCadence()
  const result = observeDelivery(cadence, { words: 5, intervalMs: 50 })
  assert.equal(result.silenceMs, 0)
})

test('a delivery claiming no words is still safe', () => {
  const result = observeDelivery(createCadence(), { words: 0, intervalMs: 1000 })
  assert.ok(Number.isFinite(result.silenceMs))
  assert.ok(result.silenceMs >= 0)
})
