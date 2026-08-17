import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkUtterance } from './engine.js'
import {
  answerSpelling,
  createMemory,
  DEFAULT_MEMORY,
  drain,
  flush,
  hear,
  load,
  loadTone,
  parseSpelling,
  skipSpelling,
  type MemorySettings,
  type MemoryState,
} from './workingMemory.js'

const settings = (overrides: Partial<MemorySettings> = {}): MemorySettings => ({
  ...DEFAULT_MEMORY,
  // Off unless a test asks for it, so timing tests stay deterministic.
  spellCheckChance: 0,
  // Tests provoke questions directly rather than waiting out the warm-up.
  spellCheckWarmUpMs: 0,
  ...overrides,
})

const say = (memory: MemoryState, text: string, now: number, burst = now) =>
  hear(memory, chunkUtterance(text), now, burst)

/** Released units, as plain text, for readable assertions. */
const texts = (units: { text: string }[]) => units.map((unit) => unit.text)

test('chunking keeps command phrases whole', () => {
  assert.deepEqual(chunkUtterance('hello new paragraph world full stop'), [
    'hello',
    'new paragraph',
    'world',
    'full stop',
  ])
})

test('the writer waits a beat before the first word appears', () => {
  const start = 1000
  let memory = createMemory(settings({ reactionMs: 700 }))
  memory = say(memory, 'the war ended', start).memory

  // Still mid-reaction.
  assert.deepEqual(texts(drain(memory, start + 300).released), [])
  // Pen down.
  assert.ok(drain(memory, start + 800).released.length > 0)
})

test('words are written at writing pace, not all at once', () => {
  const start = 0
  let memory = createMemory(settings({ reactionMs: 0, pacePerSecond: 2 }))
  memory = say(memory, 'one two three four five', start).memory

  const first = drain(memory, start)
  assert.deepEqual(texts(first.released), ['one'])

  const later = drain(first.memory, start + 1000)
  assert.deepEqual(texts(later.released), ['two', 'three'])
})

test('load rises as the backlog grows and reports its tone', () => {
  let memory = createMemory(settings({ capacity: 10 }))
  assert.equal(load(memory), 0)

  memory = say(memory, 'one two three four five', 0).memory
  assert.equal(load(memory), 0.5)
  assert.equal(loadTone(load(memory)), 'calm')

  memory = say(memory, 'six seven', 0).memory
  assert.equal(load(memory), 0.7)
  assert.equal(loadTone(load(memory)), 'busy')

  memory = say(memory, 'eight nine', 0).memory
  assert.equal(loadTone(load(memory)), 'critical')
})

test('overflowing the writer loses the tail and asks for a repeat', () => {
  let memory = createMemory(settings({ capacity: 5 }))
  const result = say(memory, 'one two three four five six seven', 0)
  memory = result.memory

  const repeat = result.events.find((e) => e.type === 'repeat')
  assert.ok(repeat, 'expected a repeat request')
  assert.equal(repeat.type === 'repeat' && repeat.lost, 2)
  assert.equal(memory.pending.length, 5)
  assert.equal(memory.stats.unitsLost, 2)
  assert.equal(memory.stats.repeatRequests, 1)
})

test('a repeat request quotes the last words actually written', () => {
  let memory = createMemory(settings({ reactionMs: 0, capacity: 4 }))
  memory = say(memory, 'the war ended quietly', 0).memory
  const drained = drain(memory, 10_000)
  memory = drained.memory
  assert.deepEqual(texts(drained.released), ['the', 'war', 'ended', 'quietly'])

  const overflow = say(memory, 'one two three four five', 10_000)
  const repeat = overflow.events.find((e) => e.type === 'repeat')
  assert.ok(repeat && repeat.type === 'repeat')
  assert.equal(repeat.resumeFrom, 'the war ended quietly')
})

test('dictating at a sensible pace never overflows', () => {
  let memory = createMemory(settings())
  let now = 0
  // Five words every two seconds — about 150 wpm, an unhurried delivery.
  for (let burst = 0; burst < 20; burst++) {
    const result = say(memory, 'the composer represents discovery vividly', now)
    assert.deepEqual(result.events, [], `overflowed on burst ${burst}`)
    memory = drain(result.memory, now).memory
    now += 2000
  }
})

test('spelling is asked only for long, unfamiliar, unchecked words', () => {
  const always = settings({ reactionMs: 0, spellCheckChance: 1 })
  let memory = createMemory(always)

  // Short words pass straight through.
  memory = say(memory, 'the war ended', 0).memory
  const short = drain(memory, 10_000, () => 0)
  assert.deepEqual(texts(short.released), ['the', 'war', 'ended'])

  // A long, unusual one stops the writer.
  let long = createMemory(always)
  long = say(long, 'irreversible', 0).memory
  const asked = drain(long, 10_000, () => 0)
  assert.deepEqual(texts(asked.released), [])
  assert.equal(asked.memory.spellCheck?.word, 'irreversible')
  assert.ok(asked.events.some((e) => e.type === 'spellCheck'))

  // Familiar long words are not worth asking about.
  let familiar = createMemory(always)
  familiar = say(familiar, 'government', 0).memory
  assert.deepEqual(texts(drain(familiar, 10_000, () => 0).released), ['government'])
})

test('spelling questions respect the cooldown and the session cap', () => {
  const always = settings({ reactionMs: 0, spellCheckChance: 1, spellCheckCooldownMs: 60_000 })
  let memory = createMemory(always)

  memory = say(memory, 'irreversible', 0).memory
  memory = drain(memory, 0, () => 0).memory
  memory = skipSpelling(memory).memory

  // Too soon for another.
  memory = say(memory, 'unequivocal', 1000).memory
  const soon = drain(memory, 1000, () => 0)
  assert.equal(soon.memory.spellCheck, null)
  assert.deepEqual(texts(soon.released), ['unequivocal'])
})

test('the writer stops writing entirely while a question is open', () => {
  const always = settings({ reactionMs: 0, spellCheckChance: 1 })
  let memory = createMemory(always)
  memory = say(memory, 'irreversible and then some more words', 0).memory
  memory = drain(memory, 0, () => 0).memory

  assert.ok(memory.spellCheck)
  assert.deepEqual(texts(drain(memory, 60_000, () => 0).released), [])
})

test('spoken letters are read back as a word', () => {
  assert.equal(parseSpelling('i r r e v e r s i b l e'), 'irreversible')
  assert.equal(parseSpelling('bee ay tee'), 'bat')
  assert.equal(parseSpelling('double you eye en'), 'win')
  assert.equal(parseSpelling('irreversible'), 'irreversible')
  assert.equal(parseSpelling('  '), '')
})

test('a correct spelling writes the word and is counted', () => {
  const always = settings({ reactionMs: 0, spellCheckChance: 1 })
  let memory = createMemory(always)
  memory = say(memory, 'irreversible', 0).memory
  memory = drain(memory, 0, () => 0).memory

  const answered = answerSpelling(memory, 'i r r e v e r s i b l e', {
    writeStudentSpelling: true,
  })
  assert.deepEqual(texts(answered.released), ['irreversible'])
  assert.equal(answered.memory.stats.spellChecksCorrect, 1)
  assert.equal(answered.memory.spellCheck, null)
  const result = answered.events.find((e) => e.type === 'spellCheckResult')
  assert.ok(result && result.type === 'spellCheckResult' && result.correct)
})

test('a wrong spelling is written as spelled where spelling is assessed', () => {
  const always = settings({ reactionMs: 0, spellCheckChance: 1 })
  let memory = createMemory(always)
  memory = say(memory, 'irreversible', 0).memory
  memory = drain(memory, 0, () => 0).memory

  const strict = answerSpelling(memory, 'i r r e v e r s a b l e', {
    writeStudentSpelling: true,
  })
  assert.deepEqual(texts(strict.released), ['irreversable'])
  assert.equal(strict.memory.stats.spellChecksCorrect, 0)

  const assisted = answerSpelling(memory, 'i r r e v e r s a b l e', {
    writeStudentSpelling: false,
  })
  assert.deepEqual(texts(assisted.released), ['irreversible'])
  assert.equal(assisted.memory.stats.spellChecksCorrect, 0)
})

test('finishing the session writes out whatever is still queued', () => {
  let memory = createMemory(settings({ reactionMs: 5000 }))
  memory = say(memory, 'one two three', 0).memory
  const flushed = flush(memory)
  assert.deepEqual(texts(flushed.released), ['one', 'two', 'three'])
  assert.equal(flushed.memory.pending.length, 0)
})

test('units carry their burst so a correction can span the whole burst', () => {
  let memory = createMemory(settings({ reactionMs: 0 }))
  memory = say(memory, 'the war ended', 0, 1).memory
  memory = say(memory, 'scratch that', 500, 2).memory

  const released = drain(memory, 10_000).released
  assert.deepEqual(
    released.map((unit) => [unit.text, unit.burst]),
    [
      ['the', 1],
      ['war', 1],
      ['ended', 1],
      ['scratch that', 2],
    ],
  )
})

test('no spelling questions until the writer has settled in', () => {
  const warmUp = settings({
    reactionMs: 0,
    spellCheckChance: 1,
    spellCheckWarmUpMs: 45_000,
  })
  let memory = createMemory(warmUp)
  memory = say(memory, 'irreversible', 0).memory

  // Four seconds in — far too soon to start interrupting.
  const early = drain(memory, 4_000, () => 0)
  assert.equal(early.memory.spellCheck, null)
  assert.deepEqual(texts(early.released), ['irreversible'])

  // Well into the session, the same word is fair game.
  let later = createMemory(warmUp)
  later = say(later, 'unequivocal', 0).memory
  later = { ...later, startedAt: -60_000 }
  assert.ok(drain(later, 1_000, () => 0).memory.spellCheck)
})

test('only the last unit of a burst is marked lastOfBurst', () => {
  let memory = createMemory(settings({ reactionMs: 0 }))
  memory = say(memory, 'the war ended quietly', 0, 1).memory
  const released = drain(memory, 10_000).released
  assert.deepEqual(
    released.map((u) => [u.text, u.lastOfBurst]),
    [
      ['the', false],
      ['war', false],
      ['ended', false],
      ['quietly', true],
    ],
  )
})

test('a single-word burst is its own last unit', () => {
  let memory = createMemory(settings({ reactionMs: 0 }))
  memory = say(memory, 'irreversible', 0, 1).memory
  const released = drain(memory, 10_000).released
  assert.deepEqual(released.map((u) => u.lastOfBurst), [true])
})

test('a spelling answer carries the lastOfBurst of the word it replaced', () => {
  const always = settings({ reactionMs: 0, spellCheckChance: 1 })

  // The spelled word is mid-burst.
  let mid = createMemory(always)
  mid = say(mid, 'irreversible and unequivocal', 0, 1).memory
  mid = drain(mid, 0, () => 0).memory
  assert.ok(mid.spellCheck, 'expected the writer to stop on "irreversible"')
  const midAnswer = answerSpelling(mid, 'i r r e v e r s i b l e', {
    writeStudentSpelling: true,
  })
  assert.equal(midAnswer.released[0]?.lastOfBurst, false)

  // The spelled word is the last word of its burst.
  let last = createMemory(always)
  last = say(last, 'irreversible', 0, 1).memory
  last = drain(last, 0, () => 0).memory
  assert.ok(last.spellCheck)
  const lastAnswer = answerSpelling(last, 'i r r e v e r s i b l e', {
    writeStudentSpelling: true,
  })
  assert.equal(lastAnswer.released[0]?.lastOfBurst, true)

  // Skipping the question preserves the same flag.
  let skipped = createMemory(always)
  skipped = say(skipped, 'irreversible', 0, 1).memory
  skipped = drain(skipped, 0, () => 0).memory
  const skipResult = skipSpelling(skipped)
  assert.equal(skipResult.released[0]?.lastOfBurst, true)
})
