import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyUtterance,
  buildInsights,
  createState,
  lastSentences,
  normaliseUtterance,
  render,
  type RuleProfile,
  type ScribeState,
} from './engine.js'
import { DEFAULT_CALIBRATION } from './calibration.js'
import { EMPTY_MODEL, train, type PunctuationModel } from './punctuation.js'

/** Dictate a series of spoken bursts and return the finished state. */
function dictate(bursts: string[], profile: RuleProfile = 'strict'): ScribeState {
  return bursts.reduce<ScribeState>(
    (state, burst) => applyUtterance(state, burst, profile).state,
    createState(),
  )
}

const written = (bursts: string[], profile: RuleProfile = 'strict') =>
  render(dictate(bursts, profile).atoms)

test('writes only the punctuation the student dictates', () => {
  assert.equal(
    written(['the war ended in 1945 full stop']),
    'the war ended in 1945.',
  )
  assert.equal(written(['the war ended in 1945']), 'the war ended in 1945')
})

test('strips punctuation and capitals the recogniser added by itself', () => {
  // Chrome hands back "The war ended. It was over." — none of that was said.
  assert.equal(
    written(['The war ended. It was over!']),
    'the war ended it was over',
  )
  assert.equal(normaliseUtterance('Hello, World.', 'strict'), 'hello world')
  assert.equal(normaliseUtterance("don't stop", 'strict'), "don't stop")
})

test('assisted mode lets the writer supply capitals and a closing full stop', () => {
  assert.equal(written(['the war ended'], 'assisted'), 'The war ended.')
  assert.equal(written(['i went home'], 'assisted'), 'I went home.')
})

test('closeSentence=false lets a caller feed one burst in pieces without a period after every piece', () => {
  // This is exactly how the exam room's working memory delivers a burst: one
  // word (or a few) at a time, at writing pace. Only the final piece may close
  // the sentence — every earlier piece must not, or assisted mode ends up with
  // a full stop after every single word.
  const burst = 1
  let state = createState()
  const words = ['the', 'composer', 'represents', 'discovery']
  words.forEach((word, index) => {
    const isLast = index === words.length - 1
    state = applyUtterance(state, word, 'assisted', burst, isLast).state
  })
  assert.equal(render(state.atoms), 'The composer represents discovery.')
})

test('closeSentence still defaults to true for a caller passing one whole utterance at once', () => {
  const state = applyUtterance(createState(), 'the war ended', 'assisted').state
  assert.equal(render(state.atoms), 'The war ended.')
})

test('a later burst reopens and closes its own sentence independently', () => {
  let state = createState()
  state = applyUtterance(state, 'the', 'assisted', 1, false).state
  state = applyUtterance(state, 'war', 'assisted', 1, false).state
  state = applyUtterance(state, 'ended', 'assisted', 1, true).state
  state = applyUtterance(state, 'it', 'assisted', 2, false).state
  state = applyUtterance(state, 'was', 'assisted', 2, false).state
  state = applyUtterance(state, 'sudden', 'assisted', 2, true).state
  assert.equal(render(state.atoms), 'The war ended. It was sudden.')
})

test('capital commands apply to the next word only', () => {
  assert.equal(written(['capital australia entered the war']), 'Australia entered the war')
  assert.equal(written(['all caps nesa sets the rules']), 'NESA sets the rules')
  assert.equal(written(['caps on urgent caps off notice']), 'URGENT notice')
})

test('new paragraph and new line break the text', () => {
  assert.equal(
    written(['first point full stop', 'new paragraph', 'second point full stop']),
    'first point.\n\nsecond point.',
  )
  assert.equal(written(['line one', 'new line', 'line two']), 'line one\nline two')
})

test('a break at the very start is ignored, and repeats do not stack', () => {
  assert.equal(written(['new paragraph', 'hello']), 'hello')
  assert.equal(written(['a', 'new line', 'new paragraph', 'b']), 'a\n\nb')
})

test('punctuation sits correctly against neighbouring words', () => {
  assert.equal(written(['yes comma really question mark']), 'yes, really?')
  assert.equal(written(['open bracket see below close bracket']), '(see below)')
  assert.equal(written(['self hyphen aware']), 'self-aware')
  assert.equal(written(['war dash peace']), 'war — peace')
  assert.equal(written(['the student apostrophe s answer']), 'the student’s answer')
  assert.equal(
    written(['open quote to be close quote']),
    '“to be”',
  )
})

test('scratch that removes the previous burst of dictation', () => {
  assert.equal(written(['keep this full stop', 'remove all of this', 'scratch that']), 'keep this.')
})

test('scratch that also clears words said in the same burst', () => {
  assert.equal(written(['keep this full stop', 'remove this scratch that']), 'keep this.')
})

test('delete last word and delete last sentence', () => {
  assert.equal(written(['alpha beta gamma', 'delete last word']), 'alpha beta')
  assert.equal(
    written(['first sentence full stop second sentence full stop', 'delete last sentence']),
    'first sentence.',
  )
  assert.equal(
    written(['first sentence full stop an unfinished second', 'delete last sentence']),
    'first sentence.',
  )
})

test('deleting keeps the statistics honest', () => {
  const state = dictate(['alpha beta full stop', 'delete last sentence'])
  assert.equal(state.stats.words, 0)
  assert.equal(state.stats.sentences, 0)
  assert.equal(state.stats.corrections, 1)
})

test('read back returns the last two sentences', () => {
  const state = dictate([
    'one full stop two full stop three full stop',
  ])
  assert.equal(lastSentences(state.atoms, 2), 'two. three.')

  const open = dictate(['one full stop two full stop three'])
  assert.equal(lastSentences(open.atoms, 2), 'two. three')
})

test('read back and stop reading raise events rather than writing words', () => {
  const start = dictate(['hello full stop'])
  const readBack = applyUtterance(start, 'read that back', 'strict')
  assert.equal(render(readBack.state.atoms), 'hello.')
  assert.ok(readBack.events.some((e) => e.type === 'readBack'))

  const stop = applyUtterance(start, 'stop reading', 'strict')
  assert.ok(stop.events.some((e) => e.type === 'stopReading'))
})

test('longest matching phrase wins', () => {
  assert.equal(written(['is that true question mark']), 'is that true?')
  assert.equal(written(['the exclamation mark goes here']), 'the! goes here')
})

test('applying an utterance never mutates the previous state', () => {
  const before = dictate(['hello'])
  const snapshot = render(before.atoms)
  applyUtterance(before, 'world full stop', 'strict')
  assert.equal(render(before.atoms), snapshot)
})

test('insights flag a missing full stop and reward paragraphing', () => {
  const missing = dictate(['this answer never ends'])
  assert.ok(
    buildInsights(missing, 'strict').some((i) => i.message.includes('no full stop')),
  )

  const tidy = dictate(['point one full stop', 'new paragraph', 'point two full stop'])
  assert.ok(buildInsights(tidy, 'strict').some((i) => i.message.includes('2 paragraphs')))
})

// ------------------------------- punctuating what the student did not say

/**
 * Dictate with a measured silence before each burst after the first.
 *
 * `closeSentence` is false for every burst and true only for the last, which
 * is how the exam room drives it once the model is supplying punctuation. The
 * old behaviour — closing at every burst — put a full stop wherever the
 * recogniser happened to finalise, which is mid-sentence more often than not.
 */
function dictateWithPauses(
  bursts: Array<{ text: string; pauseMs?: number }>,
  calibration = DEFAULT_CALIBRATION,
  model?: PunctuationModel,
): ScribeState {
  return bursts.reduce<ScribeState>(
    (state, burst, index) =>
      applyUtterance(state, burst.text, 'assisted', undefined, index === bursts.length - 1, {
        gapMs: burst.pauseMs ?? 0,
        calibration,
        model,
      }).state,
    createState(),
  )
}

test('a sentence-length silence becomes a full stop', () => {
  const state = dictateWithPauses([
    { text: 'the road was long' },
    { text: 'she stopped at the gate', pauseMs: 900 },
  ])
  assert.equal(render(state.atoms), 'The road was long. She stopped at the gate.')
})

test('a comma-length silence becomes a comma, and does not capitalise', () => {
  const state = dictateWithPauses([
    { text: 'the road was long' },
    { text: 'and the light was going', pauseMs: 420 },
  ])
  assert.equal(render(state.atoms), 'The road was long, and the light was going.')
})

test('a short silence gets nothing at all', () => {
  const state = dictateWithPauses([
    { text: 'he wrote it' },
    { text: 'quickly', pauseMs: 140 },
  ])
  assert.equal(render(state.atoms), 'He wrote it quickly.')
})

test('a clause that opened with an interrogative closes with a question mark', () => {
  const state = dictateWithPauses([
    { text: 'what had she expected' },
    { text: 'nothing in the end', pauseMs: 900 },
  ])
  assert.equal(render(state.atoms), 'What had she expected? Nothing in the end.')
})

test('the writer does not punctuate over the top of the student', () => {
  // The student dictated the mark themselves. Whatever the silence was, the
  // writer has nothing to decide — and must not add a second mark.
  const state = dictateWithPauses([
    { text: 'the road was long' },
    { text: 'full stop', pauseMs: 900 },
    { text: 'she stopped', pauseMs: 900 },
  ])
  assert.equal(render(state.atoms), 'The road was long. She stopped.')
  // One full stop, not two: the writer did not add its own on top.
  assert.equal(state.stats.sentences, 2)
})

test('the strict profile ignores the pause entirely', () => {
  const state = [
    { text: 'the road was long' },
    { text: 'she stopped at the gate', pauseMs: 2000 },
  ].reduce<ScribeState>(
    (current, burst) =>
      applyUtterance(current, burst.text, 'strict', undefined, true, {
        gapMs: burst.pauseMs ?? 0,
        calibration: DEFAULT_CALIBRATION,
      }).state,
    createState(),
  )
  assert.equal(render(state.atoms), 'the road was long she stopped at the gate')
})

test('with no assist at all the writer behaves as it always did', () => {
  // Closing at every burst boundary, which is what shipped before the model
  // existed — and precisely why full stops landed mid-sentence.
  assert.equal(
    written(['the road was long', 'she stopped at the gate'], 'assisted'),
    'The road was long. She stopped at the gate.',
  )
})

test('every mark it supplies is counted as its own, not the student credit', () => {
  const state = dictateWithPauses([
    { text: 'the road was long' },
    { text: 'she stopped', pauseMs: 900 },
  ])
  assert.ok(state.stats.assistedInsertions >= 2)
  assert.ok(
    buildInsights(state, 'assisted').some((i) => i.message.includes('supplied')),
  )
})

test('a trained model can overrule the thresholds inside the engine', () => {
  const bursts = [{ text: 'he wrote it quickly' }, { text: 'and never went back', pauseMs: 500 }]
  // Untrained, a half-second silence before "and" reads as a comma.
  assert.equal(
    render(dictateWithPauses(bursts).atoms),
    'He wrote it quickly, and never went back.',
  )

  const taught = train(
    EMPTY_MODEL,
    Array.from({ length: 3000 }, () => ({
      context: { ms: 500, before: 'quickly', after: 'and', clauseOpener: 'He' },
      mark: 'none' as const,
    })),
    DEFAULT_CALIBRATION,
  )
  assert.equal(
    render(dictateWithPauses(bursts, DEFAULT_CALIBRATION, taught).atoms),
    'He wrote it quickly and never went back.',
  )
})
