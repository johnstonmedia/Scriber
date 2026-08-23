import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Organisation, OrgClass, OrgPaper } from '../lib/org'
import { RULE_PROFILES } from '../lib/ruleProfile'
import {
  JOIN_WINDOW_MS,
  getMyParticipant,
  subscribeOrgTests,
  type TestParticipant,
  type TestSession,
} from '../lib/testSession'

/**
 * A student's or teacher's home inside one school: what's coming, what
 * already happened, how this school marks, and what there is to practise on.
 *
 * Everything here exists elsewhere in the console — the point is that nobody
 * should have to visit four tabs to answer "what do I need to do, and how
 * did the last one go?".
 */
export function OrgHome({
  org,
  orgId,
  uid,
  classes,
  papers,
  isStaff,
  onOpenTab,
}: {
  org: Organisation
  orgId: string
  uid: string
  classes: OrgClass[]
  papers: OrgPaper[]
  /** A teacher sees the same list, but never a result of their own on it. */
  isStaff: boolean
  onOpenTab: (tab: 'papers' | 'classes' | 'tests') => void
}) {
  const [tests, setTests] = useState<TestSession[] | null>(null)
  const [results, setResults] = useState<Record<string, TestParticipant | null>>({})

  // Only the classes this person is actually in — a teacher's own classes are
  // already covered by the Tests tab, so this stays "what applies to me".
  const classIds = useMemo(() => classes.map((c) => c.id), [classes])
  const classIdKey = classIds.join(',')

  useEffect(
    () => subscribeOrgTests(orgId, classIdKey ? classIdKey.split(',') : [], setTests),
    [orgId, classIdKey],
  )

  const upcoming = (tests ?? []).filter((t) => t.phase !== 'finished')
  const past = (tests ?? []).filter((t) => t.phase === 'finished').slice(0, 10)
  const pastKey = past.map((t) => t.id).join(',')

  // One read per finished test, capped at ten above — a student's own row is
  // the only participant document the rules let them see, and it is what
  // turns "you sat this" into "here is what you produced".
  useEffect(() => {
    if (!pastKey || isStaff) return
    let live = true
    void Promise.all(
      pastKey.split(',').map(async (testId) => [testId, await getMyParticipant(orgId, testId, uid).catch(() => null)] as const),
    ).then((entries) => {
      if (live) setResults(Object.fromEntries(entries))
    })
    return () => {
      live = false
    }
  }, [orgId, uid, pastKey, isStaff])

  const profile = RULE_PROFILES[org.settings.defaultRuleProfile]

  return (
    <div className="stack gap-4">
      <section className="card card-pad stack gap-3">
        <div className="row gap-2 wrap" style={{ alignItems: 'baseline' }}>
          <h2 className="grow" style={{ margin: 0 }}>
            Coming up
          </h2>
          {upcoming.length > 0 && <span className="badge badge-accent">{upcoming.length}</span>}
        </div>
        {tests === null ? (
          <p className="small muted">Loading…</p>
        ) : upcoming.length === 0 ? (
          <p className="small muted">
            {isStaff
              ? 'Nothing scheduled in your classes. Set one up from the Tests tab.'
              : 'Nothing scheduled. When a teacher sets a test for one of your classes it appears here.'}
          </p>
        ) : (
          <div className="stack gap-2">
            {upcoming.map((test) => (
              <UpcomingRow key={test.id} test={test} orgId={orgId} />
            ))}
          </div>
        )}
      </section>

      <section className="card card-pad stack gap-3">
        <h2 style={{ margin: 0 }}>Past assessments</h2>
        {tests === null ? (
          <p className="small muted">Loading…</p>
        ) : past.length === 0 ? (
          <p className="small muted">
            {isStaff
              ? 'Nothing yet. Tests you have run in your classes stay on this list once they finish.'
              : "Nothing yet. Once you've sat a test here, it stays on this list with what you wrote."}
          </p>
        ) : (
          <div className="stack gap-2">
            {past.map((test) => {
              const mine = results[test.id]
              return (
                <div key={test.id} className="row gap-3 wrap org-home-row">
                  <div className="grow">
                    <strong>{test.title}</strong>
                    <div className="small muted">
                      {test.className} ·{' '}
                      {new Date(test.scheduledAt ?? test.createdAt).toLocaleDateString('en-AU', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}{' '}
                      · {RULE_PROFILES[test.ruleProfile].short}
                    </div>
                  </div>
                  {isStaff || mine === undefined ? null : mine === null ? (
                    <span className="badge badge-warn">Did not sit</span>
                  ) : mine.attendance === 'absent' ? (
                    <span className="badge badge-warn">Marked absent</span>
                  ) : (
                    <span className="small muted">
                      {mine.wordCount} word{mine.wordCount === 1 ? '' : 's'}
                      {mine.status === 'finished' ? ' · completed' : ''}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="card card-pad stack gap-3">
        <h2 style={{ margin: 0 }}>How {org.name} runs a test</h2>
        <div className="stack gap-2">
          <div>
            <strong>{profile.full}</strong>
            <p className="small muted" style={{ marginTop: 4 }}>
              {profile.description}
            </p>
            <p className="tiny faint" style={{ marginTop: 6 }}>
              {profile.citation}
            </p>
          </div>
          <div className="org-home-rules">
            <Rule
              label="Your paper is marked against"
              value={
                org.settings.identifyBy === 'examNumber'
                  ? 'your exam number, not your name'
                  : 'your name'
              }
            />
            <Rule label="Typing" value="unavailable — you dictate everything" />
            <Rule label="Backspace" value="takes back your last word" />
            <Rule label="Reading time" value="ends on your supervisor's clock, not yours" />
            <Rule label="Pausing" value="only your supervisor can pause or resume you" />
            <Rule label="Screen sharing" value="required for the whole test" />
            <Rule label="Other tabs" value="reported to your supervisor by the extension" />
          </div>
        </div>
      </section>

      <section className="card card-pad stack gap-3">
        <div className="row gap-2 wrap" style={{ alignItems: 'baseline' }}>
          <h2 className="grow" style={{ margin: 0 }}>
            Practice papers
          </h2>
          <button className="btn btn-sm btn-ghost" onClick={() => onOpenTab('papers')}>
            See all {papers.length}
          </button>
        </div>
        {papers.length === 0 ? (
          <p className="small muted">
            {org.name} hasn't distributed any papers yet. When they do, you can practise on them
            as often as you like — practice is never watched and never shared.
          </p>
        ) : (
          <div className="stack gap-2">
            {papers.slice(0, 5).map((paper) => (
              <div key={paper.id} className="row gap-3 wrap org-home-row">
                <div className="grow">
                  <strong>{paper.title}</strong>
                  <div className="small muted">
                    {[paper.subject, paper.year].filter(Boolean).join(' · ') || 'No subject set'} ·{' '}
                    {paper.readingMinutes} min reading · {paper.workingMinutes} min working
                  </div>
                </div>
                <Link className="btn btn-sm btn-primary" to={`/exam?org=${orgId}&paper=${paper.id}`}>
                  Start practice
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="org-home-rule">
      <span className="tiny faint">{label}</span>
      <span className="small">{value}</span>
    </div>
  )
}

/**
 * A test that hasn't finished. The join link only appears once the door is
 * actually open — offering it early would send a student to a room that
 * turns them away, which reads as a fault rather than a schedule.
 */
function UpcomingRow({ test, orgId }: { test: TestSession; orgId: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const live = test.phase === 'reading' || test.phase === 'working'
  const open = live || test.scheduledAt === null || now >= test.scheduledAt - JOIN_WINDOW_MS

  return (
    <div className="row gap-3 wrap org-home-row">
      <div className="grow">
        <strong>{test.title}</strong>
        <div className="small muted">
          {test.className} ·{' '}
          {test.scheduledAt
            ? new Date(test.scheduledAt).toLocaleString('en-AU', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })
            : 'No fixed time'}{' '}
          · {test.readingMinutes} min reading, {test.workingMinutes} min working
        </div>
      </div>
      {live && <span className="badge badge-live">In progress</span>}
      {open ? (
        <Link className="btn btn-sm btn-primary" to={`/exam?org=${orgId}&test=${test.id}`}>
          {live ? 'Join now' : 'Go to the waiting room'}
        </Link>
      ) : (
        <span className="tiny muted">Opens 5 minutes before</span>
      )}
    </div>
  )
}
