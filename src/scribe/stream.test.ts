import { test } from 'node:test'
import assert from 'node:assert/strict'
import { absorbFinal, absorbInterim, createStream, resetSegment } from './stream'

test('holds back the tail of an interim transcript', () => {
  const { units } = absorbInterim(createStream(), 'the road was long and the light', 'strict')
  // Seven words, three held back.
  assert.deepEqual(units, ['the', 'road', 'was', 'long'])
})

test('releases nothing until there is more than the lookahead', () => {
  const { units } = absorbInterim(createStream(), 'the road was', 'strict')
  assert.deepEqual(units, [])
})

test('only the newly settled words are released as the transcript grows', () => {
  let state = createStream()
  const first = absorbInterim(state, 'the road was long and the light', 'strict')
  state = first.state
  assert.deepEqual(first.units, ['the', 'road', 'was', 'long'])

  const second = absorbInterim(state, 'the road was long and the light was already going', 'strict')
  assert.deepEqual(second.units, ['and', 'the', 'light'])
})

test('a command phrase is never split across the settled boundary', () => {
  // "new paragraph" sits exactly on the edge: 6 words, so 3 settle, and the
  // third word is "new". It must be held until "paragraph" settles with it.
  const { units } = absorbInterim(createStream(), 'the light new paragraph she stopped', 'strict')
  assert.deepEqual(units, ['the', 'light'])

  const later = absorbInterim(createStream(), 'the light new paragraph she stopped at the gate', 'strict')
  assert.deepEqual(later, {
    state: { taken: ['the', 'light', 'new paragraph', 'she', 'stopped'], revisions: 0 },
    units: ['the', 'light', 'new paragraph', 'she', 'stopped'],
  })
})

test('the final releases only what was not already taken', () => {
  let state = createStream()
  state = absorbInterim(state, 'the road was long and the light', 'strict').state
  const final = absorbFinal(state, 'the road was long and the light was already going', 'strict')
  assert.deepEqual(final.units, ['and', 'the', 'light', 'was', 'already', 'going'])
})

test('a final shorter than the interim releases only what it still contains', () => {
  let state = createStream()
  // Seven words heard, four settled: the recogniser was mid-phrase.
  state = absorbInterim(state, 'she stopped at the gate and looked', 'strict').state
  // It then finalises a shorter segment — "and looked" belonged to the next one.
  const final = absorbFinal(state, 'she stopped at the gate', 'strict')
  assert.deepEqual(final.units, ['gate'])
})

test('a final that repeats exactly what was taken releases nothing', () => {
  let state = createStream()
  state = absorbInterim(state, 'she stopped at the gate and looked', 'strict').state
  const final = absorbFinal(state, 'she stopped at the', 'strict')
  assert.deepEqual(final.units, [])
})

test('a segment starts clean after its final', () => {
  let state = createStream()
  state = absorbInterim(state, 'the road was long and the light', 'strict').state
  state = absorbFinal(state, 'the road was long and the light was already going', 'strict').state
  assert.deepEqual(state.taken, [])

  const next = absorbInterim(state, 'she stopped at the gate once', 'strict')
  assert.deepEqual(next.units, ['she', 'stopped', 'at'])
})

test('a revision of already-written text is counted, not replayed', () => {
  let state = createStream()
  state = absorbInterim(state, 'the road was long and the light', 'strict').state
  // The recogniser changes its mind about a word it had already settled.
  const revised = absorbInterim(state, 'the road was wrong and the light was going', 'strict')
  assert.equal(revised.state.revisions, 1)
  // "long" is on the page and cannot be unheard; only the new words come out.
  assert.deepEqual(revised.units, ['and', 'the'])
})

test('resetting a segment drops what was in flight without losing the count', () => {
  let state = createStream()
  state = absorbInterim(state, 'the road was long and the light', 'strict').state
  state = absorbInterim(state, 'the road was wrong and the light was going', 'strict').state
  const reset = resetSegment(state)
  assert.deepEqual(reset.taken, [])
  assert.equal(reset.revisions, 1)
})

test('assisted mode keeps the recogniser own punctuation out of the units', () => {
  const { units } = absorbInterim(createStream(), 'The road was long, and the light', 'assisted')
  // Assisted mode does not strip, so the comma rides along on the word.
  assert.equal(units.length, 4)
  assert.equal(units[3], 'long,')
})
