import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Paper } from '../lib/data'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type Props = { paper: Paper }

/**
 * Renders the uploaded exam paper beside the answer sheet. PDFs are drawn page
 * by page onto canvases; images and text files get a simpler treatment.
 *
 * The source is the Storage download URL, which carries its own access token,
 * so it can be handed straight to pdf.js and <img>.
 */
export function PaperViewer({ paper }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.25)
  const [textContent, setTextContent] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (paper.mimeType !== 'text/plain') return
    let cancelled = false
    fetch(paper.downloadUrl)
      .then((response) => response.text())
      .then((text) => !cancelled && setTextContent(text))
      .catch(() => !cancelled && setError('Could not read that file.'))
    return () => {
      cancelled = true
    }
  }, [paper.downloadUrl, paper.mimeType])

  useEffect(() => {
    if (paper.mimeType !== 'application/pdf') return
    const stage = stageRef.current
    if (!stage) return

    let cancelled = false
    const task = pdfjs.getDocument({ url: paper.downloadUrl })

    task.promise
      .then(async (pdf) => {
        if (cancelled) return
        setPageCount(pdf.numPages)
        stage.replaceChildren()

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          if (cancelled) return
          const page = await pdf.getPage(pageNumber)
          const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) })
          const canvas = document.createElement('canvas')
          canvas.className = 'pdf-page'
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`
          canvas.setAttribute('aria-label', `Page ${pageNumber}`)
          const context = canvas.getContext('2d')
          if (!context) continue
          stage.append(canvas)
          await page.render({ canvas, canvasContext: context, viewport }).promise
        }
      })
      .catch(() => !cancelled && setError('That PDF could not be displayed.'))

    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [paper.downloadUrl, paper.mimeType, scale])

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div className="alert alert-error">{error}</div>
      </div>
    )
  }

  return (
    <>
      <div className="paper-toolbar">
        <strong className="small">{paper.title}</strong>
        {pageCount > 0 && <span className="badge">{pageCount} pages</span>}
        <div className="spacer" />
        {paper.mimeType === 'application/pdf' && (
          <>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.25).toFixed(2))))}
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="small mono" style={{ minWidth: 44, textAlign: 'center' }}>
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setScale((s) => Math.min(3, Number((s + 0.25).toFixed(2))))}
              aria-label="Zoom in"
            >
              +
            </button>
          </>
        )}
        <a className="btn btn-sm" href={paper.downloadUrl} target="_blank" rel="noreferrer">
          Open
        </a>
      </div>

      {paper.mimeType === 'application/pdf' && <div className="pdf-stage" ref={stageRef} />}

      {paper.mimeType.startsWith('image/') && (
        <div className="pdf-stage">
          <img src={paper.downloadUrl} alt={paper.title} className="pdf-page" />
        </div>
      )}

      {paper.mimeType === 'text/plain' && (
        <div style={{ padding: 24, whiteSpace: 'pre-wrap', fontSize: '0.95rem', lineHeight: 1.7 }}>
          {textContent ?? 'Loading…'}
        </div>
      )}
    </>
  )
}
