import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Paper } from '../lib/data'
import { getFile } from '../lib/fileStore'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type Props = { paper: Paper; uid: string; onMissing?: () => void }

/**
 * Renders the exam paper beside the answer sheet. PDFs are drawn page by page
 * onto canvases; images and text files get a simpler treatment.
 *
 * Papers are held on the device, so the file is read out of IndexedDB and
 * turned into an object URL for pdf.js and <img>. A paper added on another
 * device has details but no file here, which the caller handles.
 */
export function PaperViewer({ paper, uid, onMissing }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.25)
  const [textContent, setTextContent] = useState<string | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  // Pull the file off the device and hold an object URL for as long as it shows.
  useEffect(() => {
    let url: string | null = null
    let cancelled = false

    getFile(uid, paper.id)
      .then((record) => {
        if (cancelled) return
        if (!record) {
          setMissing(true)
          onMissing?.()
          return
        }
        url = URL.createObjectURL(record.blob)
        setObjectUrl(url)
      })
      .catch(() => !cancelled && setError('Could not open the saved file.'))

    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
      setObjectUrl(null)
      setMissing(false)
    }
  }, [uid, paper.id, onMissing])

  useEffect(() => {
    if (paper.mimeType !== 'text/plain' || !objectUrl) return
    let cancelled = false
    fetch(objectUrl)
      .then((response) => response.text())
      .then((text) => !cancelled && setTextContent(text))
      .catch(() => !cancelled && setError('Could not read that file.'))
    return () => {
      cancelled = true
    }
  }, [objectUrl, paper.mimeType])

  useEffect(() => {
    if (paper.mimeType !== 'application/pdf' || !objectUrl) return
    const stage = stageRef.current
    if (!stage) return

    let cancelled = false
    const task = pdfjs.getDocument({ url: objectUrl })

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
  }, [objectUrl, paper.mimeType, scale])

  if (missing) {
    return (
      <div style={{ padding: 24 }}>
        <div className="alert alert-warn">
          <strong>This paper is saved on another device.</strong>
          <div className="small" style={{ marginTop: 4 }}>
            Exam papers stay on the device they were added to, so only the details
            travelled here. Add the file again from the dashboard to read it on this one.
          </div>
        </div>
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
        <a className="btn btn-sm" href={objectUrl ?? '#'} target="_blank" rel="noreferrer">
          Open
        </a>
      </div>

      {paper.mimeType === 'application/pdf' && <div className="pdf-stage" ref={stageRef} />}

      {paper.mimeType.startsWith('image/') && (
        <div className="pdf-stage">
          <img src={objectUrl ?? ''} alt={paper.title} className="pdf-page" />
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
