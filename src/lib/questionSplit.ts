export type ExtractedQuestion = {
  id: string
  index: number
  text: string
}

/** Only text-bearing formats can be split into questions — not images or scans. */
export function canExtractQuestions(mimeType: string): boolean {
  return mimeType === 'text/plain' || mimeType === 'application/pdf'
}

/**
 * Splits a paper's text into individual questions by pattern-matching common
 * exam numbering conventions — "Question 3", "3.", "(a)" — rather than any
 * AI extraction. It's a heuristic: reliable on typically-formatted papers,
 * conservative when it can't find a pattern (one whole-paper "question"
 * rather than a bad split), never a guarantee.
 */
export function splitIntoQuestions(text: string): ExtractedQuestion[] {
  const normalised = text.replace(/\r\n/g, '\n').trim()
  if (!normalised) return []

  const questionHeading = /^\s*question\s+(\d{1,2})\b[.:)]?/gim
  const numberedLine = /^\s*(\d{1,2})[.)]\s+\S/gm

  const splitAt = (regex: RegExp): ExtractedQuestion[] => {
    const marks: { index: number; start: number }[] = []
    let match: RegExpExecArray | null
    regex.lastIndex = 0
    while ((match = regex.exec(normalised))) {
      marks.push({ index: Number(match[1]), start: match.index })
    }
    if (marks.length < 2) return []
    return marks.map((mark, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].start : normalised.length
      return {
        id: `q${mark.index}`,
        index: mark.index,
        text: normalised.slice(mark.start, end).trim(),
      }
    })
  }

  const byHeading = splitAt(questionHeading)
  if (byHeading.length > 0) return byHeading

  const byNumberedLine = splitAt(numberedLine)
  if (byNumberedLine.length > 0) return byNumberedLine

  // No recognisable numbering — treat the whole paper as one question rather
  // than guessing at a split that would likely be wrong.
  return [{ id: 'q1', index: 1, text: normalised }]
}
