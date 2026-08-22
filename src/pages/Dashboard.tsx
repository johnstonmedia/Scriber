import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { storedPaperIds, usedBytes } from '../lib/fileStore'
import { sha256 } from '../lib/hash'
import { RULE_PROFILES } from '../lib/ruleProfile'
import { subscribeUpcomingTests, type TestSession } from '../lib/testSession'
import { listClassesITeach } from '../lib/org'
import {
  attachPaperFile,
  createPaper,
  deletePaper as removePaper,
  listAttempts,
  listPapers,
  type Attempt,
  type Paper,
} from '../lib/data'

const PHASE_LABEL: Record<TestSession['phase'], string> = {
  lobby: 'Waiting room',
  reading: 'Reading time',
  working: 'In progress',
  finished: 'Finished',
}

const relative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`

export function Dashboard() {
  const { user, memberships } = useAuth()
  const navigate = useNavigate()
  const [papers, setPapers] = useState<Paper[]>([])
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  /** Papers whose file is actually on this device. */
  const [heldHere, setHeldHere] = useState<Set<string>>(new Set())
  const [deviceBytes, setDeviceBytes] = useState(0)
  const [upcomingTests, setUpcomingTests] = useState<(TestSession & { orgName: string })[]>([])
  const [supervising, setSupervising] = useState<(TestSession & { orgName: string })[]>([])
  const [staffClassIds, setStaffClassIds] = useState<Record<string, string[]>>({})

  /**
   * Which dashboard this is. Somebody who teaches at one school and studies
   * at another counts as staff: the supervising view is the one with a
   * deadline attached to other people, so it leads.
   */
  const staffMemberships = memberships.filter((m) => m.role === 'teacher' || m.role === 'admin')
  const isStaff = staffMemberships.length > 0
  const inAnyOrg = memberships.length > 0

  useEffect(() => {
    if (memberships.length === 0) {
      setUpcomingTests([])
      return
    }
    return subscribeUpcomingTests(memberships, setUpcomingTests)
  }, [memberships])

  // A teacher's classes are named on the class documents, not on their own
  // membership — that list is the student's. So load them before asking which
  // tests they are running.
  useEffect(() => {
    if (!user || staffMemberships.length === 0) return
    let live = true
    void Promise.all(
      staffMemberships.map(
        async (m) => [m.orgId, (await listClassesITeach(m.orgId, user.uid, m.role)).map((c) => c.id)] as const,
      ),
    )
      .then((pairs) => {
        if (live) setStaffClassIds(Object.fromEntries(pairs))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, memberships])

  useEffect(() => {
    const scoped = staffMemberships
      .map((m) => ({ orgId: m.orgId, orgName: m.orgName, classIds: staffClassIds[m.orgId] ?? [] }))
      .filter((m) => m.classIds.length > 0)
    if (scoped.length === 0) {
      setSupervising([])
      return
    }
    return subscribeUpcomingTests(scoped, setSupervising)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffClassIds, memberships])

  const refresh = useCallback(async () => {
    if (!user) return
    try {
      const [nextPapers, nextAttempts] = await Promise.all([
        listPapers(user.uid),
        listAttempts(user.uid),
      ])
      setPapers(nextPapers)
      setAttempts(nextAttempts)
      setHeldHere(await storedPaperIds(user.uid, nextPapers.map((p) => p.id)))
      setDeviceBytes(await usedBytes(user.uid))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your library.')
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return
    // Hold the element — React clears currentTarget once the handler yields.
    const element = event.currentTarget
    const form = new FormData(element)
    const file = form.get('file') as File | null
    if (!file?.size) {
      setError('Choose a file first.')
      return
    }

    setError(null)
    setProgress(0)
    try {
      const hash = await sha256(file).catch(() => null)
      const duplicate = hash ? papers.find((p) => p.contentHash === hash) : undefined
      if (duplicate && !confirm(`You already have "${duplicate.title}" saved. Add it again as a new copy?`)) {
        setProgress(null)
        return
      }
      const year = Number(form.get('year'))
      await createPaper(
        user.uid,
        file,
        {
          title: String(form.get('title') || '').trim() || file.name.replace(/\.[^.]+$/, ''),
          subject: String(form.get('subject') || '').trim() || undefined,
          year: Number.isFinite(year) && year > 0 ? year : undefined,
          readingMinutes: Number(form.get('readingMinutes') ?? 10),
          workingMinutes: Number(form.get('workingMinutes') ?? 120),
        },
      )
      element.reset()
      setShowUpload(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setProgress(null)
    }
  }

  /** Put a paper's file back on this device, for one added elsewhere. */
  async function reattach(paper: Paper, file: File) {
    if (!user) return
    setError(null)
    if (paper.contentHash) {
      const hash = await sha256(file).catch(() => null)
      if (hash && hash !== paper.contentHash) {
        if (!confirm(`This file doesn't look like "${paper.title}" — attach it anyway?`)) return
      }
    }
    try {
      await attachPaperFile(user.uid, paper, file)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that file.')
    }
  }

  async function remove(paper: Paper) {
    if (!user) return
    if (!confirm(`Delete "${paper.title}"? Your practice sessions will be kept.`)) return
    try {
      await removePaper(user.uid, paper)
      await refresh()
    } catch {
      setError('Could not delete that paper.')
    }
  }

  const firstName = user?.name.split(' ')[0] ?? 'there'

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Hello, {firstName}</h1>
          <p className="muted">
            {isStaff
              ? 'Run a test for a class, or practise dictating an answer yourself.'
              : inAnyOrg
                ? 'Your assessments are below. Between them, practise as much as you like.'
                : 'Upload a paper, then practise dictating your answer the way you will in the exam.'}
          </p>
        </div>
        {isStaff && staffMemberships[0] && (
          <Link className="btn btn-primary" to={`/organisations/${staffMemberships[0].orgId}`}>
            Set up a test
          </Link>
        )}
        <button className="btn" onClick={() => navigate('/exam')}>
          Free practice
        </button>
        <button className={`btn ${isStaff ? '' : 'btn-primary'}`} onClick={() => setShowUpload((v) => !v)}>
          Upload a paper
        </button>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="stat">
          <div className="value">{papers.length}</div>
          <div className="label">Papers</div>
        </div>
        <div className="stat">
          <div className="value">{attempts.filter((a) => a.status === 'finished').length}</div>
          <div className="label">Finished sessions</div>
        </div>
        <div className="stat">
          <div className="value">
            {attempts.reduce((sum, a) => sum + (a.stats.words ?? 0), 0).toLocaleString()}
          </div>
          <div className="label">Words written</div>
        </div>
        <div className="stat">
          <div className="value">
            {Math.round(attempts.reduce((sum, a) => sum + a.durationMs, 0) / 60_000)}
          </div>
          <div className="label">Minutes practised</div>
        </div>
      </div>

      {isStaff && supervising.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ marginBottom: 12 }}>Tests you are running</h2>
          <div className="card">
            {supervising.map((t, i) => (
              <div
                key={t.id}
                className="row gap-3 wrap"
                style={{ padding: '14px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
              >
                <div className="grow">
                  <strong>{t.title}</strong>
                  <div className="small muted">
                    {t.orgName} · {t.className}
                    {t.scheduledAt ? ` · ${new Date(t.scheduledAt).toLocaleString('en-AU')}` : ''}
                  </div>
                </div>
                <span className={`badge ${t.phase === 'lobby' ? 'badge-accent' : 'badge-live'}`}>
                  {PHASE_LABEL[t.phase]}
                </span>
                <Link className="btn btn-sm btn-primary" to={`/organisations/${t.orgId}/tests/${t.id}`}>
                  {t.phase === 'lobby' ? 'Open waiting room' : 'Supervise'}
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {upcomingTests.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ marginBottom: 12 }}>{isStaff ? 'Your own assessments' : 'Upcoming assessments'}</h2>
          <div className="card">
            {upcomingTests.map((t, i) => (
              <div
                key={t.id}
                className="row gap-3 wrap"
                style={{ padding: '14px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
              >
                <div className="grow">
                  <strong>{t.title}</strong>
                  <div className="small muted">
                    {t.orgName} · {t.className}
                  </div>
                </div>
                <span className={`badge ${t.phase === 'lobby' ? 'badge-accent' : 'badge-live'}`}>
                  {PHASE_LABEL[t.phase]}
                </span>
                <Link className="btn btn-sm btn-primary" to={`/exam?org=${t.orgId}&test=${t.id}`}>
                  {t.phase === 'lobby' ? 'Join waiting room' : 'Join test'}
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {memberships.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ marginBottom: 12 }}>Your organisations</h2>
          <div className="grid grid-cards">
            {memberships.map((m) => (
              <article className="card card-pad stack gap-3" key={m.orgId}>
                <div>
                  <h3>{m.orgName || m.orgId}</h3>
                  <span className="badge badge-accent">
                    {m.role === 'admin' ? 'Admin' : m.role === 'teacher' ? 'Teacher' : 'Student'}
                  </span>
                </div>
                <p className="small muted" style={{ margin: 0 }}>
                  Distributed papers, tests and classes for {m.orgName || 'this organisation'}.
                </p>
                <Link className="btn btn-primary btn-sm" to={`/organisations/${m.orgId}`}>
                  Open {m.orgName || 'organisation'}
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}

      {showUpload && (
        <form className="card card-pad stack gap-3" style={{ marginBottom: 24 }} onSubmit={upload}>
          <h2>New exam paper</h2>
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
          >
            <div className="field">
              <label htmlFor="file">Paper file (PDF, image or text)</label>
              <input
                id="file"
                name="file"
                type="file"
                className="input"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="title">Title</label>
              <input id="title" name="title" className="input" placeholder="2023 English Advanced Paper 1" />
            </div>
            <div className="field">
              <label htmlFor="subject">Subject</label>
              <input id="subject" name="subject" className="input" placeholder="English Advanced" />
            </div>
            <div className="field">
              <label htmlFor="year">Year</label>
              <input id="year" name="year" className="input" type="number" min={1980} max={2100} placeholder="2023" />
            </div>
            <div className="field">
              <label htmlFor="readingMinutes">Reading time (min)</label>
              <input id="readingMinutes" name="readingMinutes" className="input" type="number" min={0} max={60} defaultValue={10} />
            </div>
            <div className="field">
              <label htmlFor="workingMinutes">Working time (min)</label>
              <input id="workingMinutes" name="workingMinutes" className="input" type="number" min={1} max={600} defaultValue={120} />
            </div>
          </div>

          {progress !== null && (
            <div className="level-meter" style={{ width: '100%' }} aria-label="Upload progress">
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}

          <div className="row gap-2">
            <button className="btn btn-primary" disabled={progress !== null}>
              {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : 'Add paper'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowUpload(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <section style={{ marginBottom: 34 }}>
        <div className="row gap-3 wrap" style={{ marginBottom: 12, alignItems: 'baseline' }}>
          <h2>Your papers</h2>
          <span className="small muted">
            Kept on this device
            {deviceBytes > 0 && ` · ${(deviceBytes / 1024 / 1024).toFixed(1)} MB used`}
          </span>
        </div>
        {papers.length === 0 ? (
          <div className="empty">
            <p style={{ marginBottom: 12 }}>No papers yet.</p>
            <button className="btn btn-primary" onClick={() => setShowUpload(true)}>
              Upload your first paper
            </button>
          </div>
        ) : (
          <div className="grid grid-cards">
            {papers.map((paper) => (
              <article className="card card-pad stack gap-3" key={paper.id}>
                <div>
                  <h3>{paper.title}</h3>
                  <p className="small muted">
                    {[paper.subject, paper.year].filter(Boolean).join(' · ') || 'No subject set'}
                  </p>
                </div>
                <div className="row gap-2 wrap">
                  <span className="badge">{paper.readingMinutes} min reading</span>
                  <span className="badge">{paper.workingMinutes} min working</span>
                  {heldHere.has(paper.id) ? (
                    <span className="badge badge-good">On this device</span>
                  ) : (
                    <span className="badge badge-warn">File not on this device</span>
                  )}
                </div>

                {!heldHere.has(paper.id) && (
                  <p className="tiny muted">
                    Papers stay on the device they were added to. Add the file again to
                    read it here.
                  </p>
                )}

                <div className="row gap-2 wrap">
                  {heldHere.has(paper.id) ? (
                    <Link className="btn btn-primary btn-sm" to={`/exam?paper=${paper.id}`}>
                      Start practice
                    </Link>
                  ) : (
                    <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
                      Add the file
                      <input
                        type="file"
                        hidden
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"
                        onChange={(event) => {
                          const chosen = event.target.files?.[0]
                          if (chosen) void reattach(paper, chosen)
                          event.target.value = ''
                        }}
                      />
                    </label>
                  )}
                  <button className="btn btn-sm btn-danger spacer" onClick={() => void remove(paper)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ marginBottom: 12 }}>Recent sessions</h2>
        {attempts.length === 0 ? (
          <div className="empty">Your finished practice sessions will appear here.</div>
        ) : (
          <div className="card">
            {attempts.map((attempt, index) => (
              <Link
                key={attempt.id}
                to={`/sessions/${attempt.id}`}
                className="row gap-3 wrap"
                style={{
                  padding: '14px 18px',
                  borderTop: index === 0 ? 'none' : '1px solid var(--line)',
                  color: 'inherit',
                }}
              >
                <div className="grow">
                  <strong>{attempt.title}</strong>
                  <div className="small muted">
                    {relative(attempt.createdAt)} · {minutes(attempt.durationMs)} ·{' '}
                    {attempt.stats.words ?? 0} words
                  </div>
                </div>
                {attempt.status === 'in_progress' && (
                  <span className="badge badge-warn">Unfinished</span>
                )}
                <span className="badge">
                  {RULE_PROFILES[attempt.ruleProfile].short}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
