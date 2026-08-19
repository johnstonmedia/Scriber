import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitIntoQuestions } from './questionSplit'

test('splits on "Question N" headings', () => {
  const text = [
    'Section I',
    'Question 1',
    'Analyse the extract for tone.',
    'Question 2',
    'Compare the two poems.',
  ].join('\n')
  const questions = splitIntoQuestions(text)
  assert.equal(questions.length, 2)
  assert.equal(questions[0].index, 1)
  assert.match(questions[0].text, /Analyse the extract/)
  assert.equal(questions[1].index, 2)
  assert.match(questions[1].text, /Compare the two poems/)
})

test('falls back to numbered lines when there are no "Question" headings', () => {
  const text = ['1. Explain the process.', '2. Justify your answer.'].join('\n')
  const questions = splitIntoQuestions(text)
  assert.equal(questions.length, 2)
  assert.equal(questions[0].index, 1)
  assert.equal(questions[1].index, 2)
})

test('treats unnumbered text as a single question rather than guessing', () => {
  const questions = splitIntoQuestions('Just write about your holiday.')
  assert.equal(questions.length, 1)
  assert.equal(questions[0].index, 1)
})

test('empty text extracts no questions', () => {
  assert.deepEqual(splitIntoQuestions(''), [])
  assert.deepEqual(splitIntoQuestions('   \n  '), [])
})

test('out-of-order question numbers are preserved as found, not resorted', () => {
  const text = 'Question 2\nSecond part.\nQuestion 1\nFirst part written after it in the paper.'
  const questions = splitIntoQuestions(text)
  assert.equal(questions.length, 2)
  assert.equal(questions[0].index, 2)
  assert.equal(questions[1].index, 1)
})
