import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type AttemptSummary, type Paper } from '../lib/api'
import { useAuth } from '../lib/auth'

const relative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`

export function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [papers, setPapers] = useState<Paper[]>([])
  const [attempts, setAttempts] = useState<AttemptSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    try {
      const [{ papers }, { attempts }] = await Promise.all([api.papers(), api.attempts()])
      setPapers(papers)
      setAttempts(attempts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your library.')
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Hold onto the element — React clears currentTarget once the handler yields.
    const element = event.currentTarget
    const form = new FormData(element)
    if (!(form.get('file') as File)?.size) {
      setError('Choose a file first.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      await api.uploadPaper(form)
      element.reset()
      setShowUpload(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function remove(paper: Paper) {
    if (!confirm(`Delete "${paper.title}"? Your practice sessions will be kept.`)) return
    await api.deletePaper(paper.id).catch(() => setError('Could not delete that paper.'))
    await refresh()
  }

  const firstName = user?.name.split(' ')[0] ?? 'there'

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Hello, {firstName}</h1>
          <p className="muted">
            Upload a paper, then practise dictating your answer the way you will in the exam.
          </p>
        </div>
        <button className="btn" onClick={() => navigate('/exam')}>
          Free practice
        </button>
        <button className="btn btn-primary" onClick={() => setShowUpload((v) => !v)}>
          Upload a paper
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      {showUpload && (
        <form className="card card-pad stack gap-3" style={{ marginBottom: 24 }} onSubmit={upload}>
          <h2>New exam paper</h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <div className="field">
              <label htmlFor="file">Paper file (PDF, image or text)</label>
              <input id="file" name="file" type="file" className="input" ref={fileRef} accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" required />
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
          <div className="row gap-2">
            <button className="btn btn-primary" disabled={uploading}>
              {uploading ? 'Uploading…' : 'Add paper'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowUpload(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <section style={{ marginBottom: 34 }}>
        <h2 style={{ marginBottom: 12 }}>Your papers</h2>
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
                </div>
                <div className="row gap-2">
                  <Link className="btn btn-primary btn-sm" to={`/exam?paper=${paper.id}`}>
                    Start practice
                  </Link>
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
                    {String((attempt.stats as { words?: number }).words ?? 0)} words
                  </div>
                </div>
                {attempt.status === 'in_progress' && <span className="badge badge-warn">Unfinished</span>}
                <span className="badge">
                  {attempt.ruleProfile === 'strict' ? 'Strict' : 'Assisted'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
