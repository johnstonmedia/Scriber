/**
 * Where the writer thinks the punctuation goes.
 *
 * The first version of this was three numbers and a chain of `if`s: a gap
 * longer than X is a comma, longer than Y a full stop. That is wrong for the
 * same reason it is easy — a pause is not the only evidence, and often not the
 * best evidence. "the road was long <400ms> and the light was going" is a
 * comma; "she stopped at the gate <400ms> looked back" is a comma; but "what
 * had she expected <400ms> nothing in the end" is a question mark, and no
 * threshold on the silence will ever tell you that. The words on either side
 * of the gap carry most of it, and the fact that the clause opened with "what"
 * carries the rest.
 *
 * So this is a small classifier over three kinds of evidence:
 *
 *   - how long the silence was, measured against how long *this* student's
 *     own commas are, so a slow speaker and a fast one land in the same bucket
 *   - the word before the gap, and the word after it, when either is a
 *     function word that actually predicts something
 *   - whether the clause opened with an interrogative
 *
 * It is a naive Bayes model over counts, which is a deliberate choice and not
 * a limitation. It trains from tallies, so the whole model is a few kilobytes
 * of integers that can live in one Firestore document and be folded into
 * without re-reading the corpus; it is legible, so when the writer puts a
 * comma somewhere strange you can look up exactly which counts did it; and it
 * cannot overfit its way into confident nonsense on the tenth sample, which a
 * heavier model very much can.
 *
 * Everything here is pure. Reading and writing the shared model lives in
 * lib/punctuationModel.ts.
 */

import { DEFAULT_CALIBRATION, classifyGap, type Calibration, type MarkKind } from './calibration'

/**
 * What can go in a gap. `MarkKind` plus the question mark, which the old
 * threshold classifier had no way to express and so never produced.
 */
export type Mark = MarkKind | 'question'

export const MARKS: Mark[] = ['none', 'comma', 'sentence', 'question', 'paragraph']

/** The text a mark writes. `none` writes nothing. */
export const MARK_TEXT: Record<Mark, string> = {
  none: '',
  comma: ',',
  sentence: '.',
  question: '?',
  paragraph: '\n\n',
}

export const MARK_LABEL: Record<Mark, string> = {
  none: 'no mark',
  comma: 'comma',
  sentence: 'full stop',
  question: 'question mark',
  paragraph: 'new paragraph',
}

/**
 * Bumped whenever the features change meaning. Counts gathered under an older
 * scheme describe a different model and must not be folded into a newer one —
 * they are discarded rather than migrated, because a guess at what an old
 * bucket would have been is indistinguishable from data and much worse.
 */
export const MODEL_VERSION = 1

// --------------------------------------------------------------- the features

/**
 * Words worth counting. A closed list on purpose: content words ("gate",
 * "walking") are too sparse to learn anything from and would grow the model
 * without bound, while function words are where the grammar actually lives.
 * Everything outside this list shares one bucket.
 */
const VOCABULARY = new Set(
  (
    'the a an and but or nor so if because although though while when where what who whom whose why how ' +
    'which that this these those there here it he she they we you i not no yes then than as at by for ' +
    'from in into of on to with without over under after before once again now still yet just only even ' +
    'also however therefore moreover instead meanwhile finally first second third next last is are was ' +
    'were be been being am do does did done have has had will would can could shall should may might must ' +
    'my your his her their our its one two some any all more most less least such about against between'
  ).split(' '),
)

/** Words that open a question, when they open the clause. */
const INTERROGATIVES = new Set([
  'what', 'why', 'how', 'when', 'where', 'who', 'whom', 'whose', 'which',
  'do', 'does', 'did', 'is', 'are', 'was', 'were', 'am',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'has', 'have', 'had',
])

/** Strip to the bare word so "gate," and "Gate" count as the same evidence. */
export function normaliseWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z'’-]/g, '')
}

function vocabularyKey(word: string | null): string {
  if (!word) return '·edge'
  const clean = normaliseWord(word)
  if (!clean) return '·edge'
  return VOCABULARY.has(clean) ? clean : '·other'
}

/**
 * Ten buckets of silence, measured in multiples of this student's own comma
 * pause rather than in milliseconds.
 *
 * This normalisation is the thing that makes one shared model possible at all.
 * 400ms is a comma for a deliberate reader and a mid-word breath for a fast
 * one; 400ms divided by each of their own comma pauses is close to 1 for both.
 * Pooling raw milliseconds across a whole school would average a fast speaker
 * and a slow one into a model that fits neither.
 */
export function durationBucket(ms: number, calibration: Calibration | null): number {
  const base = Math.max(80, (calibration ?? DEFAULT_CALIBRATION).comma)
  const ratio = ms / base
  const edges = [0.5, 0.8, 1.1, 1.5, 2.0, 2.6, 3.4, 4.5, 6.0]
  for (let i = 0; i < edges.length; i++) if (ratio < edges[i]!) return i
  return edges.length
}

/** The evidence at one gap, as the model sees it. */
export type GapContext = {
  /** Length of the silence in milliseconds. */
  ms: number
  /** The word immediately before the gap, or null at the start. */
  before: string | null
  /** The word immediately after it, or null if nothing followed. */
  after: string | null
  /** The first word of the clause this gap closes, if known. */
  clauseOpener?: string | null
}

/** The feature keys this context fires. Order is irrelevant; presence is not. */
export function featuresOf(context: GapContext, calibration: Calibration | null): string[] {
  const opener = context.clauseOpener ? normaliseWord(context.clauseOpener) : ''
  return [
    `d:${durationBucket(context.ms, calibration)}`,
    `p:${vocabularyKey(context.before)}`,
    `n:${vocabularyKey(context.after)}`,
    `q:${opener && INTERROGATIVES.has(opener) ? 1 : 0}`,
  ]
}

// ------------------------------------------------------------------ the model

/**
 * Tallies, nothing else. `marks` counts how often each mark was the right
 * answer; `features` counts how often each feature fired alongside each mark,
 * keyed `mark|feature`. Folding two models together is addition, which is why
 * training can be incremental and why two trainers racing cannot corrupt it
 * beyond a lost update.
 */
export type PunctuationModel = {
  version: number
  observations: number
  marks: Record<string, number>
  features: Record<string, number>
  updatedAt: string
}

export const EMPTY_MODEL: PunctuationModel = {
  version: MODEL_VERSION,
  observations: 0,
  marks: {},
  features: {},
  updatedAt: '',
}

/** One graded gap: what the evidence was, and what the answer turned out to be. */
export type PunctuationSample = { context: GapContext; mark: Mark }

/**
 * Fold samples into a model. Returns a new model; the input is untouched.
 *
 * The student's own calibration is needed here as well as at prediction time,
 * because the duration feature is expressed in multiples of their comma — the
 * bucket has to be computed against the speaker who produced it, not against
 * whoever reads the model later.
 */
export function train(
  model: PunctuationModel,
  samples: PunctuationSample[],
  calibration: Calibration | null,
): PunctuationModel {
  const next: PunctuationModel = {
    version: MODEL_VERSION,
    observations: model.version === MODEL_VERSION ? model.observations : 0,
    marks: model.version === MODEL_VERSION ? { ...model.marks } : {},
    features: model.version === MODEL_VERSION ? { ...model.features } : {},
    updatedAt: new Date().toISOString(),
  }

  for (const sample of samples) {
    next.observations++
    next.marks[sample.mark] = (next.marks[sample.mark] ?? 0) + 1
    for (const feature of featuresOf(sample.context, calibration)) {
      const key = `${sample.mark}|${feature}`
      next.features[key] = (next.features[key] ?? 0) + 1
    }
  }

  return next
}

/** Add two models together. Used by the trainer to fold a batch in one write. */
export function merge(a: PunctuationModel, b: PunctuationModel): PunctuationModel {
  if (a.version !== MODEL_VERSION) return b
  if (b.version !== MODEL_VERSION) return a
  const out: PunctuationModel = {
    version: MODEL_VERSION,
    observations: a.observations + b.observations,
    marks: { ...a.marks },
    features: { ...a.features },
    updatedAt: new Date().toISOString(),
  }
  for (const [key, count] of Object.entries(b.marks)) out.marks[key] = (out.marks[key] ?? 0) + count
  for (const [key, count] of Object.entries(b.features)) {
    out.features[key] = (out.features[key] ?? 0) + count
  }
  return out
}

// -------------------------------------------------------------- the prediction

/**
 * How many observations before the pooled model is trusted on its own.
 *
 * Below this it is blended with the threshold classifier in proportion to how
 * much data stands behind it, so the very first school to train it does not
 * get a writer driven by forty samples.
 */
export const CONFIDENCE_HALF_LIFE = 400

/**
 * How much weight the smoothing prior carries, in units of observations.
 *
 * Plain Laplace smoothing — add one, divide by the class count — is wrong here
 * and wrong in a way that would have shipped. Most boundaries in English carry
 * no mark, so `none` will always hold the overwhelming majority of the counts.
 * Under Laplace, a feature that class has never seen is divided by that large
 * count and comes out vanishingly unlikely, while the same unseen feature
 * under a rare mark like `question` is divided by almost nothing and comes out
 * merely uncommon. The best-attested answer is punished hardest for novelty,
 * so the first unfamiliar pair of words flips the writer to a rare mark — a
 * comma, or worse a question mark, in the middle of somebody's sentence.
 *
 * Smoothing towards the feature's own marginal frequency instead, with a fixed
 * prior weight, costs every class the same for novelty regardless of size.
 */
const ALPHA = 8

/** Laplace constant for the class prior, which has no such imbalance problem. */
const CLASS_ALPHA = 1

/** Number of distinct values each feature can take, for the smoothing denominator. */
const FEATURE_CARDINALITY: Record<string, number> = {
  d: 10,
  p: VOCABULARY.size + 2,
  n: VOCABULARY.size + 2,
  q: 2,
}

function normalise(scores: Record<Mark, number>): Record<Mark, number> {
  const total = MARKS.reduce((sum, mark) => sum + scores[mark], 0)
  if (total <= 0) {
    const flat = 1 / MARKS.length
    return { none: flat, comma: flat, sentence: flat, question: flat, paragraph: flat }
  }
  const out = {} as Record<Mark, number>
  for (const mark of MARKS) out[mark] = scores[mark] / total
  return out
}

/**
 * What the thresholds alone would say, as a distribution rather than a verdict.
 *
 * Held deliberately soft. It is a prior, and a prior that insists is not a
 * prior — the whole point of blending is that evidence can outvote it.
 */
function priorDistribution(context: GapContext, calibration: Calibration | null): Record<Mark, number> {
  const kind = classifyGap(context.ms, calibration ?? DEFAULT_CALIBRATION)
  const opener = context.clauseOpener ? normaliseWord(context.clauseOpener) : ''
  const interrogative = Boolean(opener) && INTERROGATIVES.has(opener)

  const scores: Record<Mark, number> = { none: 0.08, comma: 0.08, sentence: 0.08, question: 0.04, paragraph: 0.02 }
  if (kind === 'sentence' && interrogative) {
    scores.question += 0.6
    scores.sentence += 0.1
  } else if (kind === 'sentence') {
    scores.sentence += 0.6
    scores.question += 0.05
  } else {
    scores[kind] += 0.7
  }
  return normalise(scores)
}

/** Naive Bayes posterior over the marks, from the pooled counts. */
function modelDistribution(
  model: PunctuationModel,
  context: GapContext,
  calibration: Calibration | null,
): Record<Mark, number> {
  const features = featuresOf(context, calibration)
  const logScores = {} as Record<Mark, number>

  // How common each feature is across the whole corpus, regardless of mark.
  // This is what an unseen feature falls back to, so novelty costs every mark
  // the same rather than costing the commonest one the most.
  const marginal = new Map<string, number>()
  for (const feature of features) {
    const kind = feature.slice(0, feature.indexOf(':'))
    const cardinality = FEATURE_CARDINALITY[kind] ?? 2
    let seen = 0
    for (const mark of MARKS) seen += model.features[`${mark}|${feature}`] ?? 0
    marginal.set(feature, (seen + 1) / (model.observations + cardinality))
  }

  for (const mark of MARKS) {
    const markCount = model.marks[mark] ?? 0
    // Marks never seen still get a floor, or a model that has met three
    // question marks could never produce a fourth.
    let score = Math.log(
      (markCount + CLASS_ALPHA) / (model.observations + CLASS_ALPHA * MARKS.length),
    )
    for (const feature of features) {
      const count = model.features[`${mark}|${feature}`] ?? 0
      const prior = marginal.get(feature)!
      score += Math.log((count + ALPHA * prior) / (markCount + ALPHA))
    }
    logScores[mark] = score
  }

  // Shift before exponentiating — these are sums of four or five logs and
  // exp() of them underflows to zero for every mark at once otherwise.
  const peak = Math.max(...MARKS.map((mark) => logScores[mark]))
  const scores = {} as Record<Mark, number>
  for (const mark of MARKS) scores[mark] = Math.exp(logScores[mark] - peak)
  return normalise(scores)
}

export type Prediction = {
  mark: Mark
  /** Probability the model puts on its own answer, 0 to 1. */
  confidence: number
  /** Full distribution, for the training screen to show its working. */
  distribution: Record<Mark, number>
  /** How much of the answer came from pooled training rather than thresholds. */
  modelWeight: number
}

/**
 * What goes in this gap.
 *
 * The pooled model and the student's own thresholds are mixed in proportion to
 * how much training stands behind the pooled one, so the behaviour moves
 * smoothly from "the thresholds you measured" to "what the model has learned"
 * as the corpus grows, and never lurches between the two.
 */
export function predictMark(
  context: GapContext,
  calibration: Calibration | null,
  model: PunctuationModel = EMPTY_MODEL,
): Prediction {
  const prior = priorDistribution(context, calibration)
  const usable = model.version === MODEL_VERSION ? model.observations : 0
  const weight = usable / (usable + CONFIDENCE_HALF_LIFE)

  let distribution = prior
  if (weight > 0) {
    const learned = modelDistribution(model, context, calibration)
    const mixed = {} as Record<Mark, number>
    for (const mark of MARKS) mixed[mark] = (1 - weight) * prior[mark] + weight * learned[mark]
    distribution = normalise(mixed)
  }

  let best: Mark = 'none'
  for (const mark of MARKS) if (distribution[mark] > distribution[best]) best = mark

  return { mark: best, confidence: distribution[best], distribution, modelWeight: weight }
}

/**
 * The bar a prediction has to clear before the writer acts on it.
 *
 * Asymmetric on purpose, and the asymmetry is the whole ethic of the thing. A
 * mark the writer left out costs the student one spoken word to fix. A mark
 * the writer invented is in their exam answer and they may never see it. So
 * silence is cheap and confident wrongness is not: `none` needs no threshold,
 * every other mark needs a clear majority.
 */
export const ACT_THRESHOLD = 0.55

export function shouldWrite(prediction: Prediction): boolean {
  return prediction.mark !== 'none' && prediction.confidence >= ACT_THRESHOLD
}
