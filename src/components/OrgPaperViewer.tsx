import { memo } from 'react'
import type { OrgPaper } from '../lib/org'

type Props = {
  paper: OrgPaper
  /** This student's classes have a subset assigned — show just those questions. */
  assignedQuestionIds?: string[] | null
}

/**
 * A paper a teacher distributed to the organisation — rendered entirely from
 * its extracted text (see distributeOrgPaper in lib/org.ts). The original
 * file never reaches a student's device; this is the site's own formatting
 * of the questions, not a copy of what the teacher uploaded.
 */
export const OrgPaperViewer = memo(function OrgPaperViewer({ paper, assignedQuestionIds }: Props) {
  const assigned = assignedQuestionIds && assignedQuestionIds.length > 0 ? new Set(assignedQuestionIds) : null
  const questions = (assigned ? paper.questions.filter((q) => assigned.has(q.id)) : paper.questions).sort(
    (a, b) => a.index - b.index,
  )

  return (
    <>
      <div className="paper-toolbar">
        <strong className="small">{paper.title}</strong>
        <span className="badge">
          {questions.length} question{questions.length === 1 ? '' : 's'}
          {assigned ? ' assigned' : ''}
        </span>
      </div>
      <div style={{ padding: 24 }} className="stack gap-4">
        {questions.map((q) => (
          <div key={q.id} style={{ whiteSpace: 'pre-wrap', fontSize: '0.95rem', lineHeight: 1.7 }}>
            {q.text}
          </div>
        ))}
        {questions.length === 0 && <div className="empty">No questions to show.</div>}
      </div>
    </>
  )
})
