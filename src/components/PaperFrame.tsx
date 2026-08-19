import { memo, useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type Props = {
  title: string
  mimeType: string
  /** Wherever the bytes actually came from — IndexedDB object URL or a Storage download URL. */
  url: string | null
  /** Set once the caller knows for certain there is no file to show at all. */
  loadError?: string | null
}

/**
 * The actual paper renderer — PDF pages onto canvases, images and text files
 * more simply. Deliberately knows nothing about *where* a file came from: a
 * student's own paper is read from IndexedDB, an organisation's distributed
 * paper from Cloud Storage, and both resolve to a URL before reaching here.
 *
 * Memoized so re-renders elsewhere in the exam room (interim speech text, the
 * writer's queue draining, the clock) never re-reconcile this PDF canvas tree
 * unless the paper itself actually changes.
 */
export const PaperFrame = memo(function PaperFrame({ title, mimeType, url, loadError }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.25)
  const [textContent, setTextContent] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mimeType !== 'text/plain' || !url) return
    let cancelled = false
    fetch(url)
      .then((response) => response.text())
      .then((text) => !cancelled && setTextContent(text))
      .catch(() => !cancelled && setError('Could not read that file.'))
    return () => {
      cancelled = true
    }
  }, [url, mimeType])

  useEffect(() => {
    if (mimeType !== 'application/pdf' || !url) return
    const stage = stageRef.current
    if (!stage) return

    let cancelled = false
    const task = pdfjs.getDocument({ url })

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
  }, [url, mimeType, scale])

  if (loadError) {
    return (
      <div style={{ padding: 24 }}>
        <div className="alert alert-warn">{loadError}</div>
      </div>
    )
  }

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
        <strong className="small">{title}</strong>
        {pageCount > 0 && <span className="badge">{pageCount} pages</span>}
        <div className="spacer" />
        {mimeType === 'application/pdf' && (
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
        <a className="btn btn-sm" href={url ?? '#'} target="_blank" rel="noreferrer">
          Open
        </a>
      </div>

      {mimeType === 'application/pdf' && <div className="pdf-stage" ref={stageRef} />}

      {mimeType.startsWith('image/') && (
        <div className="pdf-stage">
          <img src={url ?? ''} alt={title} className="pdf-page" />
        </div>
      )}

      {mimeType === 'text/plain' && (
        <div style={{ padding: 24, whiteSpace: 'pre-wrap', fontSize: '0.95rem', lineHeight: 1.7 }}>
          {textContent ?? 'Loading…'}
        </div>
      )}
    </>
  )
})
