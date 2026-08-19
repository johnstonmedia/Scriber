import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { canExtractQuestions, splitIntoQuestions, type ExtractedQuestion } from './questionSplit'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { canExtractQuestions, splitIntoQuestions, type ExtractedQuestion }

/** Pulls the plain text out of a paper, page by page for a PDF. */
export async function extractPaperText(file: File): Promise<string> {
  if (file.type === 'text/plain') {
    return file.text()
  }
  if (file.type === 'application/pdf') {
    const buffer = await file.arrayBuffer()
    const task = pdfjs.getDocument({ data: buffer })
    const pdf = await task.promise
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
    }
    void task.destroy()
    return pages.join('\n\n')
  }
  return ''
}

export async function extractQuestions(file: File): Promise<ExtractedQuestion[]> {
  if (!canExtractQuestions(file.type)) return []
  const text = await extractPaperText(file).catch(() => '')
  if (!text) return []
  return splitIntoQuestions(text)
}
