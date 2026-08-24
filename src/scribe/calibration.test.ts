import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CALIBRATION_PASSAGE,
  DEFAULT_CALIBRATION,
  classifyGap,
  deriveThresholds,
  expectedGaps,
  separation,
  type GapSample,
} from './calibration'

const gaps = (spec: Array<[number, GapSample['expected']]>): GapSample[] =>
  spec.map(([ms, expected]) => ({ ms, expected }))

/** Somebody who pauses clearly and differently at each kind of mark. */
const clearReader = gaps([
  [300, 'comma'],
  [340, 'comma'],
  [280, 'comma'],
  [320, 'comma'],
  [900, 'sentence'],
  [1000, 'sentence'],
  [850, 'sentence'],
])

test('a clear reader gets thresholds that sit between their own pauses', () => {
  const result = deriveThresholds(clearReader)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const { comma, sentence, paragraph } = result.calibration
  assert.ok(comma < 310, `comma threshold ${comma} should sit below their comma pauses`)
  assert.ok(sentence > 340 && sentence < 850, `sentence threshold ${sentence} should sit between the two groups`)
  assert.ok(paragraph > sentence, 'a paragraph must take longer than a sentence')
})

test('the thresholds actually classify that reader correctly', () => {
  const result = deriveThresholds(clearReader)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const c = result.calibration
  assert.equal(classifyGap(120, c), 'none')
  assert.equal(classifyGap(310, c), 'comma')
  assert.equal(classifyGap(920, c), 'sentence')
  assert.equal(classifyGap(5000, c), 'paragraph')
})

/**
 * The refusals matter more than the successes. A writer built on thresholds
 * that don't separate would sprinkle punctuation through somebody's exam.
 */
test('a reader with no difference between comma and full stop is refused', () => {
  const flat = gaps([
    [400, 'comma'],
    [410, 'comma'],
    [395, 'comma'],
    [405, 'sentence'],
    [400, 'sentence'],
  ])
  const result = deriveThresholds(flat)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /no longer than|too alike/)
  assert.doesNotMatch(result.reason, /SCR-/)
})

test('overlapping pauses are refused rather than guessed at', () => {
  const muddled = gaps([
    [300, 'comma'],
    [800, 'comma'],
    [450, 'comma'],
    [700, 'comma'],
    [420, 'sentence'],
    [900, 'sentence'],
    [500, 'sentence'],
  ])
  const result = deriveThresholds(muddled)
  assert.equal(result.ok, false)
})

test('too little of the passage read is refused, and says what to do', () => {
  const result = deriveThresholds(gaps([[300, 'comma'], [900, 'sentence']]))
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /reading it again/)
})

test('a refusal leaves the defaults usable', () => {
  assert.equal(classifyGap(100, DEFAULT_CALIBRATION), 'none')
  assert.equal(classifyGap(400, DEFAULT_CALIBRATION), 'comma')
  assert.equal(classifyGap(800, DEFAULT_CALIBRATION), 'sentence')
  assert.equal(classifyGap(2000, DEFAULT_CALIBRATION), 'paragraph')
})

test('separation is 1 when the groups do not overlap and 0 when one is empty', () => {
  assert.equal(separation([100, 200], [800, 900]), 1)
  assert.equal(separation([], [800]), 0)
  assert.ok(separation([100, 900], [200, 800]) < 1)
})

test('the passage yields the marks it visibly contains', () => {
  const marks = expectedGaps()
  assert.equal(marks.filter((m) => m === 'comma').length, 5)
  // The final line's full stop is not a gap — there is nothing after it.
  assert.equal(marks.filter((m) => m === 'sentence').length, CALIBRATION_PASSAGE.length - 1)
})

test('a question mark counts as a sentence pause, not a category of its own', () => {
  const marks = expectedGaps(['Is it?', 'It is.'])
  assert.deepEqual(marks, ['sentence'])
})
