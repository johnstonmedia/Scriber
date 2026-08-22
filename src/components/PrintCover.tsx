import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { getOrganisation, type Organisation } from '../lib/org'
import type { Attempt } from '../lib/data'

/**
 * The front sheet of a printed answer.
 *
 * A marker works through a stack of papers, and for senior exams that stack
 * is meant to be anonymous: the paper has to be identifiable — so it can be
 * matched back afterwards, and so a missing one is noticed — without naming
 * the person who wrote it. So the number goes on large enough to read off the
 * top of a pile, and the name does not appear at all.
 *
 * Younger years are usually handed back by name instead, which is what the
 * organisation's identifyBy setting chooses between.
 *
 * On screen this renders nothing; it exists only on paper.
 */
export function PrintCover({ attempt }: { attempt: Attempt }) {
  const { user, memberships } = useAuth()
  const [org, setOrg] = useState<Organisation | null>(null)

  // A session from org work records where it came from: "org:{orgId}:{paperId}"
  // for a distributed paper, "test:{orgId}:{testId}" for a live test. Solo
  // practice has neither, and gets the plain cover.
  const orgId = attempt.paperId?.match(/^(?:org|test):([^:]+):/)?.[1] ?? null
  const membership = orgId ? memberships.find((m) => m.orgId === orgId) : undefined

  useEffect(() => {
    if (!orgId) return
    let live = true
    void getOrganisation(orgId)
      .then((found) => {
        if (live) setOrg(found)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [orgId])

  // Fall back to the name when there is no number to use — an unmarked paper
  // is worse than a named one.
  const byNumber = org?.settings.identifyBy === 'examNumber' && !!membership?.examNumber
  const identifier = byNumber ? membership!.examNumber! : user?.name ?? ''

  return (
    <div className="print-cover" aria-hidden="true">
      <div className="print-cover-head">
        {org?.branding.logoDataUrl && <img src={org.branding.logoDataUrl} alt="" />}
        <span>{org?.name ?? 'Scriber'}</span>
      </div>

      <div className="print-cover-id">
        <div className="print-cover-label">{byNumber ? 'Exam number' : 'Name'}</div>
        <div className="print-cover-value">{identifier || '—'}</div>
      </div>

      <div className="print-cover-meta">
        <div>
          <strong>{attempt.title}</strong>
        </div>
        <div>
          {new Date(attempt.createdAt).toLocaleDateString('en-AU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </div>
        {membership && <div>{membership.orgName}</div>}
        <div>
          Dictated to a writer under exam provisions
          {attempt.ruleProfile === 'strict' ? ' — all punctuation dictated by the student' : ''}
        </div>
      </div>
    </div>
  )
}
