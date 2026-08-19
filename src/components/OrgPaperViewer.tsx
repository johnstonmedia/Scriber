import { memo, useEffect, useState } from 'react'
import { orgPaperDownloadUrl, type OrgPaper } from '../lib/org'
import { PaperFrame } from './PaperFrame'

type Props = { paper: OrgPaper }

/**
 * A paper a teacher distributed to the organisation — unlike a student's own
 * papers, this one genuinely lives in Cloud Storage, since it has to be
 * reachable from every student's device it's assigned to, not just the one it
 * was uploaded from.
 */
export const OrgPaperViewer = memo(function OrgPaperViewer({ paper }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    orgPaperDownloadUrl(paper)
      .then((resolved) => !cancelled && setUrl(resolved))
      .catch(() => !cancelled && setError('Could not open this paper. It may have been removed.'))
    return () => {
      cancelled = true
    }
  }, [paper])

  return <PaperFrame title={paper.title} mimeType={paper.mimeType} url={url} loadError={error} />
})
