import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { deleteAttempt, getAttempt, type Attempt } from '../lib/data'
import { readAloud } from '../scribe/speech'
import { buildInsights, paragraphsOf, type Atom, type ScribeStats } from '../scribe/engine'

type LogEntry = { at: number; heard: string; commands: string[] }

const stamp = (ms: number) => {
  const total = Math.round(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function SessionReview() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'answer' | 'transcript'>('answer')

  useEffect(() => {
    if (!id || !user) return
    getAttempt(user.uid, id)
      .then((found) => {
        if (!found) setError('That practice session no longer exists.')
        else setAttempt(found)
      })
      .catch((err: Error) => setError(err.message))
  }, [id, user])

  const stats = (attempt?.stats ?? {}) as Partial<ScribeStats> & {
    writer?: {
      repeatRequests?: number
      unitsLost?: number
      spellChecks?: number
      spellChecksCorrect?: number
      peakLoad?: number
    }
  }
  const writer = stats.writer ?? {}
  const log = (attempt?.log ?? []) as LogEntry[]

  const insights = useMemo(() => {
    if (!attempt) return []
    return buildInsights(
      {
        atoms: attempt.atoms as Atom[],
        nextId: 0,
        utterance: 0,
        pendingCase: 'none',
        capsLock: false,
        stats: {
          words: 0,
          commandCounts: {},
          punctuationMarks: 0,
          paragraphs: 0,
          sentences: 0,
          corrections: 0,
          readBacks: 0,
          assistedInsertions: 0,
          ...stats,
        },
      },
      attempt.ruleProfile,
    )
  }, [attempt, stats])

  if (error) {
    return (
      <div className="page">
        <div className="alert alert-error">{error}</div>
      </div>
    )
  }
  if (!attempt) return <div className="page muted">Loading…</div>

  // Below a minute the rate says more about the clock than the student.
  const wordsPerMinute =
    attempt.durationMs >= 60_000
      ? String(Math.round(((stats.words ?? 0) / attempt.durationMs) * 60_000))
      : '—'

  const commandCounts = stats.commandCounts ?? {}
  const usedCommands = Object.entries(commandCounts).sort((a, b) => b[1] - a[1])

  function download() {
    const blob = new Blob([attempt!.answerText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${attempt!.title.replace(/[^\w -]/g, '')} — answer.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function remove() {
    if (!user) return
    if (!confirm('Delete this practice session?')) return
    await deleteAttempt(user.uid, attempt!.id)
    navigate('/')
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <Link to="/" className="small">
            ← All sessions
          </Link>
          <h1 style={{ marginTop: 6 }}>{attempt.title}</h1>
          <p className="muted">
            {new Date(attempt.createdAt).toLocaleString('en-AU', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}{' '}
            · {stamp(attempt.durationMs)} ·{' '}
            {attempt.ruleProfile === 'strict' ? 'Strict scribe rules' : 'Assisted'}
          </p>
        </div>
        <button className="btn" onClick={download}>
          Download answer
        </button>
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
        <button className="btn btn-danger" onClick={() => void remove()}>
          Delete
        </button>
      </div>

      <div className="stat-grid" style={{ marginBottom: 22 }}>
        <div className="stat">
          <div className="value">{stats.words ?? 0}</div>
          <div className="label">Words</div>
        </div>
        <div className="stat">
          <div className="value">{stats.sentences ?? 0}</div>
          <div className="label">Sentences you closed</div>
        </div>
        <div className="stat">
          <div className="value">{paragraphsOf(attempt.answerText).length}</div>
          <div className="label">Paragraphs</div>
        </div>
        <div className="stat">
          <div className="value">{stats.punctuationMarks ?? 0}</div>
          <div className="label">Marks dictated</div>
        </div>
        <div className="stat">
          <div className="value">{wordsPerMinute}</div>
          <div className="label">Words per minute</div>
        </div>
        <div className="stat">
          <div className="value">{stats.corrections ?? 0}</div>
          <div className="label">Corrections</div>
        </div>
        <div className="stat">
          <div className="value">{writer.repeatRequests ?? 0}</div>
          <div className="label">Times asked to repeat</div>
        </div>
      </div>

      {(writer.repeatRequests || writer.spellChecks) ? (
        <div className="card card-pad stack gap-3" style={{ marginBottom: 22 }}>
          <h3>How your writer coped</h3>
          <div className="row gap-4 wrap">
            {writer.repeatRequests ? (
              <div className={`insight insight-watch`} style={{ flex: '1 1 260px' }}>
                <span>!</span>
                <span>
                  You outran your writer {writer.repeatRequests}{' '}
                  {writer.repeatRequests === 1 ? 'time' : 'times'}, losing{' '}
                  {writer.unitsLost ?? 0} words. Pause at your punctuation to let them
                  catch up.
                </span>
              </div>
            ) : (
              <div className="insight insight-good" style={{ flex: '1 1 260px' }}>
                <span>✓</span>
                <span>You never outran your writer — your pacing was manageable throughout.</span>
              </div>
            )}

            {writer.spellChecks ? (
              <div
                className={`insight insight-${
                  (writer.spellChecksCorrect ?? 0) === writer.spellChecks ? 'good' : 'watch'
                }`}
                style={{ flex: '1 1 260px' }}
              >
                <span>{(writer.spellChecksCorrect ?? 0) === writer.spellChecks ? '✓' : '!'}</span>
                <span>
                  You were asked to spell {writer.spellChecks}{' '}
                  {writer.spellChecks === 1 ? 'word' : 'words'} and got{' '}
                  {writer.spellChecksCorrect ?? 0} right.
                </span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)' }}>
        <div className="card card-pad">
          <div className="row gap-2" style={{ marginBottom: 14 }}>
            <button
              className={`btn btn-sm ${tab === 'answer' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab('answer')}
            >
              Your answer
            </button>
            <button
              className={`btn btn-sm ${tab === 'transcript' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab('transcript')}
            >
              What you said ({log.length})
            </button>
            <button
              className="btn btn-sm spacer no-print"
              onClick={() => readAloud.speak(attempt.answerText)}
            >
              Read aloud
            </button>
          </div>

          {tab === 'answer' ? (
            <div className="answer-sheet" style={{ maxWidth: 'none' }}>
              {attempt.answerText || <span className="answer-placeholder">Nothing was written.</span>}
            </div>
          ) : (
            <div>
              {log.length === 0 && <p className="muted small">No dictation was recorded.</p>}
              {log.map((entry, index) => (
                <div className="transcript-line" key={index}>
                  <span className="mono faint tiny">{stamp(entry.at)}</span>
                  <span>
                    {entry.heard}
                    {entry.commands.length > 0 && (
                      <span className="row gap-1 wrap" style={{ marginTop: 4 }}>
                        {entry.commands.map((command, i) => (
                          <span className="badge badge-accent tiny" key={i}>
                            {command}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="stack gap-4">
          <div className="card card-pad stack gap-3">
            <h3>How it went</h3>
            {insights.map((insight, index) => (
              <div className={`insight insight-${insight.tone}`} key={index}>
                <span>{insight.tone === 'good' ? '✓' : '!'}</span>
                <span>{insight.message}</span>
              </div>
            ))}
          </div>

          <div className="card card-pad stack gap-3">
            <h3>Commands you used</h3>
            {usedCommands.length === 0 ? (
              <p className="small muted">
                You did not dictate any punctuation or formatting. In the exam your writer adds
                none of it for you.
              </p>
            ) : (
              <div className="stack gap-2">
                {usedCommands.map(([label, count]) => (
                  <div className="row gap-3" key={label}>
                    <span className="grow small">{label}</span>
                    <span className="badge mono">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
