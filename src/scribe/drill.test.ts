import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CALIBRATION } from './calibration'
import { EMPTY_MODEL, train } from './punctuation'
import {
  DRILL_SENTENCES,
  alignGaps,
  gradeRound,
  nextSentence,
  parseSentence,
  observedGaps,
  readingMatches,
  roundSamples,
} from './drill'

test('marks are read off the sentence itself', () => {
  const parsed = parseSentence('The road was long, and the light was already going.')
  assert.deepEqual(parsed.words, [
    'The', 'road', 'was', 'long', 'and', 'the', 'light', 'was', 'already', 'going',
  ])
  assert.equal(parsed.boundaries[3]!.mark, 'comma')
  assert.equal(parsed.boundaries[9]!.mark, 'sentence')
  // Everything else runs straight through.
  const marked = parsed.boundaries.filter((b) => b.mark !== 'none')
  assert.equal(marked.length, 2)
})

test('a question mark is not a full stop', () => {
  const parsed = parseSentence('What had she expected?')
  assert.equal(parsed.boundaries[3]!.mark, 'question')
})

test('the clause opener is carried to every boundary in the clause', () => {
  const parsed = parseSentence('However, the second stanza undercuts all of it.')
  assert.equal(parsed.boundaries[0]!.clauseOpener, 'However')
  // A new clause opens after the comma, and the rest of the sentence belongs
  // to it — this is what lets a question mark be told from a full stop many
  // words after the interrogative that caused it.
  assert.equal(parsed.boundaries[1]!.clauseOpener, 'the')
  assert.equal(parsed.boundaries[6]!.clauseOpener, 'the')
})

test('every sentence in the bank parses to marks it actually contains', () => {
  for (const sentence of DRILL_SENTENCES) {
    const parsed = parseSentence(sentence.text)
    assert.ok(parsed.words.length > 0, sentence.id)
    const last = parsed.boundaries[parsed.boundaries.length - 1]!
    assert.ok(last.mark === 'sentence' || last.mark === 'question', `${sentence.id} does not end`)
    const commas = parsed.boundaries.filter((b) => b.mark === 'comma').length
    assert.equal(commas, (sentence.text.match(/,/g) ?? []).length, sentence.id)
  }
})

// ------------------------------------------------------------------ alignment

test('a silence is snapped to the nearest boundary', () => {
  const parsed = parseSentence('The road was long, and the light was already going.')
  // The recogniser thought five words had arrived; the comma is after four.
  const alignment = alignGaps(parsed, [{ afterWordIndex: 4, ms: 480 }])
  assert.equal(alignment.gapAt[3], 480)
  assert.deepEqual(alignment.spurious, [])
})

test('a silence too far from any boundary is reported, not forced', () => {
  const parsed = parseSentence('What had she expected?')
  const alignment = alignGaps(parsed, [{ afterWordIndex: 40, ms: 900 }])
  assert.deepEqual(alignment.spurious, [{ afterWordIndex: 40, ms: 900 }])
  assert.ok(alignment.gapAt.every((ms) => ms === 0))
})

test('when two silences compete for one boundary the longer one takes it', () => {
  const parsed = parseSentence('What had she expected?')
  const alignment = alignGaps(parsed, [
    { afterWordIndex: 3, ms: 200 },
    { afterWordIndex: 3, ms: 900 },
  ])
  assert.equal(alignment.gapAt[3], 900)
  // The other is placed at a neighbouring boundary rather than dropped.
  assert.equal(alignment.gapAt.filter((ms) => ms === 200).length, 1)
})

// -------------------------------------------------------------------- samples

test('every measurable boundary becomes a sample, including the ones with no mark', () => {
  const parsed = parseSentence('The road was long, and the light was already going.')
  const samples = roundSamples(parsed, alignGaps(parsed, [{ afterWordIndex: 3, ms: 480 }]))
  assert.equal(samples.length, 9)
  assert.equal(samples.filter((s) => s.mark === 'none').length, 8)
  // The boundaries nobody paused at are taught as zero-length gaps, which is
  // exactly what stops the model marking every gap it meets.
  assert.equal(samples[0]!.context.ms, 0)
  assert.equal(samples[3]!.context.ms, 480)
})

test('no exam prose can reach the samples — only the bank sentence does', () => {
  const parsed = parseSentence(DRILL_SENTENCES[0]!.text)
  const samples = roundSamples(parsed, alignGaps(parsed, []))
  const words = samples.flatMap((s) => [s.context.before, s.context.after])
  for (const word of words) {
    if (word === null) continue
    assert.ok(DRILL_SENTENCES[0]!.text.includes(word), `${word} came from somewhere else`)
  }
})

// -------------------------------------------------------------------- grading

test('a read with clean pauses is graded as mostly right', () => {
  const parsed = parseSentence('The road was long, and the light was already going.')
  const alignment = alignGaps(parsed, [
    { afterWordIndex: 3, ms: 450 },
    { afterWordIndex: 9, ms: 900 },
  ])
  const result = gradeRound(parsed, alignment, DEFAULT_CALIBRATION)
  assert.equal(result.expected, 'The road was long, and the light was already going.')
  assert.equal(result.produced, 'The road was long, and the light was already going.')
  assert.equal(result.correct, result.total)
  assert.equal(result.overWrites, 0)
})

test('grading names an invented mark separately from a missed one', () => {
  const parsed = parseSentence('He wrote it quickly and never went back to it.')
  // The student took a breath mid-clause where no comma belongs.
  const alignment = alignGaps(parsed, [{ afterWordIndex: 3, ms: 500 }])
  const result = gradeRound(parsed, alignment, DEFAULT_CALIBRATION)
  assert.equal(result.overWrites, 1)
  // Nothing was missed: the only other mark is the closing full stop, which
  // nobody could have heard and which is therefore not asked about.
  assert.equal(result.underWrites, 0)
  assert.notEqual(result.produced, result.expected)
})

test('the grade uses the trained model, not a copy of the rules', () => {
  const parsed = parseSentence('He wrote it quickly and never went back to it.')
  // A breath mid-clause, where the thresholds alone read a comma.
  const alignment = alignGaps(parsed, [{ afterWordIndex: 3, ms: 500 }])
  assert.equal(gradeRound(parsed, alignment, DEFAULT_CALIBRATION).overWrites, 1)

  // Now teach it the way the drill actually would: a class of students reading
  // the whole sentence, every boundary in it labelled, most of them "no mark".
  // Training on one context in isolation would be a corpus that cannot occur.
  const readings = Array.from({ length: 400 }, () => roundSamples(parsed, alignment)).flat()
  const taught = train(EMPTY_MODEL, readings, DEFAULT_CALIBRATION)

  const graded = gradeRound(parsed, alignment, DEFAULT_CALIBRATION, taught)
  assert.equal(graded.overWrites, 0, graded.produced)
})

test('a question is graded as a question, not a full stop', () => {
  const parsed = parseSentence('How does the composer represent discovery?')
  const alignment = alignGaps(parsed, [{ afterWordIndex: 5, ms: 950 }])
  const result = gradeRound(parsed, alignment, DEFAULT_CALIBRATION)
  assert.ok(result.produced.endsWith('?'), result.produced)
})

test('the next sentence avoids ones already done', () => {
  const done = DRILL_SENTENCES.slice(0, -1).map((s) => s.id)
  assert.equal(nextSentence(done, () => 0).id, DRILL_SENTENCES[DRILL_SENTENCES.length - 1]!.id)
})

test('once the bank is exhausted it starts over rather than returning nothing', () => {
  const done = DRILL_SENTENCES.map((s) => s.id)
  assert.ok(nextSentence(done, () => 0.5))
})

// --------------------------------------------------- reading the recogniser

test('silences are read off the intervals between recogniser updates', () => {
  const gaps = observedGaps([
    { words: 2, at: 1000 },
    { words: 4, at: 1300 },
    { words: 5, at: 1900 },
  ])
  assert.deepEqual(gaps, [
    { afterWordIndex: 1, ms: 300 },
    { afterWordIndex: 3, ms: 600 },
  ])
})

test('an update that added no words says nothing about a silence', () => {
  const gaps = observedGaps([
    { words: 3, at: 1000 },
    { words: 3, at: 1400 },
    { words: 5, at: 1500 },
  ])
  assert.deepEqual(gaps, [{ afterWordIndex: 2, ms: 100 }])
})

test('a reading of the right sentence is accepted', () => {
  const parsed = parseSentence('The road was long, and the light was already going.')
  assert.equal(
    readingMatches(parsed, 'the road was long and the light was already going'.split(' ')),
    true,
  )
})

test('a dropped word does not reject an otherwise good reading', () => {
  const parsed = parseSentence('The road was long, and the light was already going.')
  assert.equal(
    readingMatches(parsed, 'the road was long and the light was going'.split(' ')),
    true,
  )
})

test('reading a different sentence is rejected', () => {
  const parsed = parseSentence('The road was long, and the light was already going.')
  assert.equal(
    readingMatches(parsed, 'comma comma comma comma comma comma comma comma comma'.split(' ')),
    false,
  )
})

test('saying nothing is rejected', () => {
  assert.equal(readingMatches(parseSentence('What had she expected?'), []), false)
})

// ------------------------------------- the mark nobody can hear

test('the last boundary in a reading is not measurable', () => {
  const parsed = parseSentence('The road was long, and the light was already going.')
  assert.equal(parsed.boundaries[parsed.boundaries.length - 1]!.measurable, false)
  assert.ok(parsed.boundaries.slice(0, -1).every((b) => b.measurable))
})

test('the unmeasurable boundary is never taught to the model', () => {
  const parsed = parseSentence('The road was long, and the light was already going.')
  const samples = roundSamples(parsed, alignGaps(parsed, [{ afterWordIndex: 3, ms: 480 }]))
  // Nine boundaries, not ten. A sentence-ending mark filed against a gap of
  // zero would teach the writer to close sentences after no pause at all.
  assert.equal(samples.length, 9)
  assert.equal(samples.filter((s) => s.mark === 'sentence').length, 0)
})

test('a full stop inside the reading is still taught', () => {
  const parsed = parseSentence('The poem resists an easy reading. That resistance is the point.')
  const samples = roundSamples(parsed, alignGaps(parsed, [{ afterWordIndex: 5, ms: 950 }]))
  const sentences = samples.filter((s) => s.mark === 'sentence')
  assert.equal(sentences.length, 1)
  assert.equal(sentences[0]!.context.ms, 950)
})

test('the student is not marked wrong for the mark nobody could hear', () => {
  const parsed = parseSentence('The road was long, and the light was already going.')
  const result = gradeRound(parsed, alignGaps(parsed, [{ afterWordIndex: 3, ms: 450 }]), DEFAULT_CALIBRATION)
  assert.equal(result.correct, result.total)
  assert.equal(result.total, 9)
  // It still reads as a whole sentence, closing mark and all.
  assert.equal(result.produced, 'The road was long, and the light was already going.')
})

test('every sentence in the bank has a mark that can actually be measured', () => {
  for (const sentence of DRILL_SENTENCES) {
    const parsed = parseSentence(sentence.text)
    const teachable = parsed.boundaries.filter((b) => b.measurable && b.mark !== 'none')
    // d9 is deliberately all negatives — one clause, straight through.
    if (sentence.id === 'd9') {
      assert.equal(teachable.length, 0, sentence.id)
      continue
    }
    assert.ok(teachable.length > 0, `${sentence.id} teaches nothing: ${sentence.text}`)
  }
})
