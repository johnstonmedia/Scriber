import { memo, useEffect, useState } from 'react'
import { orgPaperDownloadUrl, type OrgPaper } from '../lib/org'
import { PaperFrame } from './PaperFrame'

type Props = {
  paper: OrgPaper
  /** This student's classes have a subset assigned — show just those questions. */
  assignedQuestionIds?: string[] | null
}

/**
 * A paper a teacher distributed to the organisation — unlike a student's own
 * papers, this one genuinely lives in Cloud Storage, since it has to be
 * reachable from every student's device it's assigned to, not just the one it
 * was uploaded from.
 *
 * When the student's class has been assigned a subset of the paper's
 * extracted questions, they see just those (as text) rather than the whole
 * original file — otherwise this behaves exactly as before.
 */
export const OrgPaperViewer = memo(function OrgPaperViewer({ paper, assignedQuestionIds }: Props) {
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

  if (assignedQuestionIds && assignedQuestionIds.length > 0) {
    const assigned = new Set(assignedQuestionIds)
    const questions = paper.questions.filter((q) => assigned.has(q.id)).sort((a, b) => a.index - b.index)
    return (
      <>
        <div className="paper-toolbar">
          <strong className="small">{paper.title}</strong>
          <span className="badge">
            {questions.length} question{questions.length === 1 ? '' : 's'} assigned
          </span>
        </div>
        <div style={{ padding: 24 }} className="stack gap-4">
          {questions.map((q) => (
            <div key={q.id} style={{ whiteSpace: 'pre-wrap', fontSize: '0.95rem', lineHeight: 1.7 }}>
              {q.text}
            </div>
          ))}
        </div>
      </>
    )
  }

  return <PaperFrame title={paper.title} mimeType={paper.mimeType} url={url} loadError={error} />
})
