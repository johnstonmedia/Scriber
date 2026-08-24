import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SEGMENT_OPTIONS, noiseFloor, segmentGaps, type Level } from './pauseMeter'

/** Builds a level track: alternating loud and quiet stretches, in ms. */
function track(spec: Array<[loud: boolean, ms: number]>, step = 20): Level[] {
  const levels: Level[] = []
  let at = 0
  for (const [loud, ms] of spec) {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      levels.push({ at, rms: loud ? 0.2 : 0.001 })
      at += step
    }
  }
  return levels
}

test('measures the silences between runs of speech', () => {
  const { gaps, speechRuns } = segmentGaps(
    track([
      [true, 500],
      [false, 400],
      [true, 500],
      [false, 900],
      [true, 500],
    ]),
  )
  assert.equal(speechRuns, 3)
  assert.equal(gaps.length, 2)
  assert.ok(Math.abs(gaps[0]! - 400) <= 40, `first gap ${gaps[0]}`)
  assert.ok(Math.abs(gaps[1]! - 900) <= 40, `second gap ${gaps[1]}`)
})

test('silence before the first word and after the last is not a pause anybody took', () => {
  const { gaps, speechRuns } = segmentGaps(
    track([
      [false, 2000],
      [true, 400],
      [false, 600],
      [true, 400],
      [false, 3000],
    ]),
  )
  assert.equal(speechRuns, 2)
  assert.equal(gaps.length, 1)
  assert.ok(Math.abs(gaps[0]! - 600) <= 40)
})

test('a momentary dip inside a word does not split it in two', () => {
  // 60ms of quiet — the stop before a plosive, well under the 120ms floor.
  const { gaps, speechRuns } = segmentGaps(
    track([
      [true, 300],
      [false, 60],
      [true, 300],
    ]),
  )
  assert.equal(speechRuns, 1)
  assert.deepEqual(gaps, [])
})

test('a cough between two sentences is not counted as speech', () => {
  const { speechRuns } = segmentGaps(
    track([
      [true, 400],
      [false, 500],
      [true, 40], // too short to be a word
      [false, 500],
      [true, 400],
    ]),
  )
  assert.equal(speechRuns, 2)
})

test('saying nothing at all yields nothing, rather than a zero', () => {
  const { gaps, speechRuns } = segmentGaps(track([[false, 3000]]))
  assert.equal(speechRuns, 0)
  assert.deepEqual(gaps, [])
})

test('the noise floor sits above the room but below a voice', () => {
  const quietRoom: Level[] = Array.from({ length: 100 }, (_, i) => ({ at: i * 20, rms: 0.004 }))
  const floor = noiseFloor(quietRoom)
  assert.ok(floor >= DEFAULT_SEGMENT_OPTIONS.floor, 'never below the hard floor')
  assert.ok(floor < 0.2, 'never above a speaking voice')
})

test('one chair scrape does not raise the floor above the student', () => {
  const room: Level[] = Array.from({ length: 100 }, (_, i) => ({ at: i * 20, rms: 0.004 }))
  room[50] = { at: 1000, rms: 0.9 }
  assert.ok(noiseFloor(room) < 0.2)
})

test('a noisy room raises the floor rather than hearing the room as speech', () => {
  const busy: Level[] = Array.from({ length: 100 }, (_, i) => ({ at: i * 20, rms: 0.02 }))
  assert.ok(noiseFloor(busy) > DEFAULT_SEGMENT_OPTIONS.floor)
})
