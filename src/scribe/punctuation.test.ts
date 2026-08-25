import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CALIBRATION, type Calibration } from './calibration'
import {
  EMPTY_MODEL,
  MODEL_VERSION,
  durationBucket,
  featuresOf,
  merge,
  predictMark,
  shouldWrite,
  train,
  type PunctuationSample,
} from './punctuation'

const slow: Calibration = { ...DEFAULT_CALIBRATION, comma: 600, sentence: 1200, paragraph: 2600, samples: 40 }
const fast: Calibration = { ...DEFAULT_CALIBRATION, comma: 200, sentence: 420, paragraph: 900, samples: 40 }

test('the same pause in each speaker own terms lands in the same bucket', () => {
  // Both are pausing about one-and-a-half commas' worth, at very different
  // absolute speeds. Pooling raw milliseconds would put these in different
  // classes and teach the model nonsense.
  assert.equal(durationBucket(900, slow), durationBucket(300, fast))
})

test('a longer pause never lands in a lower bucket', () => {
  let previous = -1
  for (const ms of [0, 100, 200, 400, 700, 1000, 1600, 2400, 4000, 9000]) {
    const bucket = durationBucket(ms, DEFAULT_CALIBRATION)
    assert.ok(bucket >= previous, `${ms}ms went backwards`)
    previous = bucket
  }
})

test('a missing calibration falls back rather than dividing by zero', () => {
  const bucket = durationBucket(500, { ...DEFAULT_CALIBRATION, comma: 0 })
  assert.ok(Number.isFinite(bucket))
})

test('content words share one bucket so the model cannot grow without bound', () => {
  const a = featuresOf({ ms: 300, before: 'gate', after: 'walking' }, DEFAULT_CALIBRATION)
  const b = featuresOf({ ms: 300, before: 'lighthouse', after: 'sprinting' }, DEFAULT_CALIBRATION)
  assert.deepEqual(a, b)
})

test('function words are kept apart', () => {
  const a = featuresOf({ ms: 300, before: 'and', after: 'the' }, DEFAULT_CALIBRATION)
  const b = featuresOf({ ms: 300, before: 'but', after: 'the' }, DEFAULT_CALIBRATION)
  assert.notDeepEqual(a, b)
})

// ------------------------------------------------------------ untrained model

test('with no training at all it still behaves like the thresholds', () => {
  const short = predictMark({ ms: 120, before: 'road', after: 'was' }, DEFAULT_CALIBRATION)
  assert.equal(short.mark, 'none')
  assert.equal(short.modelWeight, 0)

  const comma = predictMark({ ms: 420, before: 'long', after: 'and' }, DEFAULT_CALIBRATION)
  assert.equal(comma.mark, 'comma')

  const stop = predictMark({ ms: 900, before: 'going', after: 'she' }, DEFAULT_CALIBRATION)
  assert.equal(stop.mark, 'sentence')
})

test('a clause that opened with an interrogative closes with a question mark', () => {
  // Same silence, same words either side. The only difference is how the
  // clause began — and no threshold on the pause can see that.
  const statement = predictMark(
    { ms: 900, before: 'expected', after: 'nothing', clauseOpener: 'she' },
    DEFAULT_CALIBRATION,
  )
  const question = predictMark(
    { ms: 900, before: 'expected', after: 'nothing', clauseOpener: 'what' },
    DEFAULT_CALIBRATION,
  )
  assert.equal(statement.mark, 'sentence')
  assert.equal(question.mark, 'question')
})

// ---------------------------------------------------------------- training

/** A run of samples teaching one specific thing. */
function repeat(sample: PunctuationSample, times: number): PunctuationSample[] {
  return Array.from({ length: times }, () => sample)
}

test('training moves the answer away from what the thresholds alone would say', () => {
  const context = { ms: 430, before: 'reading', after: 'that', clauseOpener: 'the' }
  assert.equal(predictMark(context, DEFAULT_CALIBRATION).mark, 'comma')

  // A large, consistent corpus says this shape of gap ends a sentence.
  const model = train(EMPTY_MODEL, repeat({ context, mark: 'sentence' }, 4000), DEFAULT_CALIBRATION)
  assert.equal(predictMark(context, DEFAULT_CALIBRATION, model).mark, 'sentence')
})

test('a handful of samples cannot overrule the thresholds', () => {
  const context = { ms: 430, before: 'reading', after: 'that', clauseOpener: 'the' }
  const model = train(EMPTY_MODEL, repeat({ context, mark: 'paragraph' }, 12), DEFAULT_CALIBRATION)
  const prediction = predictMark(context, DEFAULT_CALIBRATION, model)
  assert.equal(prediction.mark, 'comma')
  assert.ok(prediction.modelWeight < 0.05, `weight was ${prediction.modelWeight}`)
})

test('negative examples stop it marking every gap', () => {
  const context = { ms: 380, before: 'quickly', after: 'and', clauseOpener: 'he' }
  const model = train(EMPTY_MODEL, repeat({ context, mark: 'none' }, 4000), DEFAULT_CALIBRATION)
  const prediction = predictMark(context, DEFAULT_CALIBRATION, model)
  assert.equal(prediction.mark, 'none')
  assert.equal(shouldWrite(prediction), false)
})

test('the writer stays silent when it is not sure', () => {
  // Two equally-attested answers for identical evidence: the model genuinely
  // does not know, and a coin-flip mark would land in somebody exam.
  const context = { ms: 500, before: 'gate', after: 'looked', clauseOpener: 'she' }
  let model = train(EMPTY_MODEL, repeat({ context, mark: 'comma' }, 2000), DEFAULT_CALIBRATION)
  model = train(model, repeat({ context, mark: 'sentence' }, 2000), DEFAULT_CALIBRATION)
  const prediction = predictMark(context, DEFAULT_CALIBRATION, model)
  assert.ok(prediction.confidence < 0.55, `confidence was ${prediction.confidence}`)
  assert.equal(shouldWrite(prediction), false)
})

test('a mark it has never seen is still reachable', () => {
  const model = train(
    EMPTY_MODEL,
    repeat({ context: { ms: 100, before: 'the', after: 'road' }, mark: 'none' }, 500),
    DEFAULT_CALIBRATION,
  )
  const prediction = predictMark(
    { ms: 3000, before: 'loud', after: 'the', clauseOpener: 'nothing' },
    DEFAULT_CALIBRATION,
    model,
  )
  assert.ok(prediction.distribution.paragraph > 0)
})

test('probabilities are a distribution', () => {
  const model = train(
    EMPTY_MODEL,
    repeat({ context: { ms: 400, before: 'long', after: 'and' }, mark: 'comma' }, 900),
    DEFAULT_CALIBRATION,
  )
  const { distribution } = predictMark({ ms: 400, before: 'long', after: 'and' }, DEFAULT_CALIBRATION, model)
  const total = Object.values(distribution).reduce((sum, value) => sum + value, 0)
  assert.ok(Math.abs(total - 1) < 1e-9, `summed to ${total}`)
  for (const value of Object.values(distribution)) assert.ok(value >= 0)
})

// ------------------------------------------------------------------- folding

test('two models add together', () => {
  const context = { ms: 400, before: 'long', after: 'and' }
  const a = train(EMPTY_MODEL, repeat({ context, mark: 'comma' }, 30), DEFAULT_CALIBRATION)
  const b = train(EMPTY_MODEL, repeat({ context, mark: 'comma' }, 70), DEFAULT_CALIBRATION)
  const both = merge(a, b)
  assert.equal(both.observations, 100)
  assert.equal(both.marks.comma, 100)
  assert.equal(both.features['comma|p:·other'], 100)
})

test('counts from an older feature scheme are discarded, not migrated', () => {
  const stale = { ...EMPTY_MODEL, version: MODEL_VERSION - 1, observations: 9_000, marks: { comma: 9_000 } }
  const fresh = train(stale, [{ context: { ms: 400, before: 'long', after: 'and' }, mark: 'comma' }], DEFAULT_CALIBRATION)
  assert.equal(fresh.version, MODEL_VERSION)
  assert.equal(fresh.observations, 1)
})

test('a stale model is ignored at prediction time', () => {
  const stale = { ...EMPTY_MODEL, version: MODEL_VERSION - 1, observations: 50_000 }
  const prediction = predictMark({ ms: 900, before: 'going', after: 'she' }, DEFAULT_CALIBRATION, stale)
  assert.equal(prediction.modelWeight, 0)
  assert.equal(prediction.mark, 'sentence')
})
