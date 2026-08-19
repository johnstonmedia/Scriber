import { memo, useEffect, useState } from 'react'
import type { Paper } from '../lib/data'
import { getFile } from '../lib/fileStore'
import { PaperFrame } from './PaperFrame'

type Props = { paper: Paper; uid: string; onMissing?: () => void }

/**
 * A student's own paper — held on the device, so the file is read out of
 * IndexedDB and turned into an object URL for PaperFrame. A paper added on
 * another device has details but no file here, which the caller handles.
 */
export const PaperViewer = memo(function PaperViewer({ paper, uid, onMissing }: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const loadError = missing
    ? "This paper is saved on another device. Exam papers stay on the device they were added to, so only the details travelled here. Add the file again from the dashboard to read it on this one."
    : error

  return (
    <PaperFrame title={paper.title} mimeType={paper.mimeType} url={objectUrl} loadError={loadError} />
  )
})
