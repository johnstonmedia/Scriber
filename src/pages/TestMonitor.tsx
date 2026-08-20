import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getClass, type OrgClass } from '../lib/org'
import { RULE_PROFILES } from '../lib/ruleProfile'
import {
  finishTestSession,
  startReading,
  startWorking,
  subscribeTestParticipants,
  subscribeTestSession,
  type TestParticipant,
  type TestPhase,
  type TestSession,
} from '../lib/testSession'

const PHASE_LABEL: Record<TestPhase, string> = {
  lobby: 'Waiting room',
  reading: 'Reading time',
  working: 'In progress',
  finished: 'Finished',
}

/**
 * The teacher's own view of a live test — a NAPLAN-style proctoring screen:
 * who's arrived, whether they're reading, working or done, and (once
 * working starts) a live word count and a trailing preview of what each
 * student has written so far. Nobody moves themselves from reading into
 * working — that transition, like starting the test at all, only happens
 * from here.
 */
export function TestMonitor() {
  const { orgId, testId } = useParams<{ orgId: string; testId: string }>()
  const { memberships, siteAdmin } = useAuth()
  const membership = memberships.find((m) => m.orgId === orgId)
  const isStaff = membership?.role === 'teacher' || membership?.role === 'admin' || siteAdmin
  const [test, setTest] = useState<TestSession | null>(null)
  const [orgClass, setOrgClass] = useState<OrgClass | null>(null)
  const [participants, setParticipants] = useState<TestParticipant[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId || !testId) return
    const unsubTest = subscribeTestSession(orgId, testId, setTest)
    const unsubParticipants = subscribeTestParticipants(orgId, testId, setParticipants)
    return () => {
      unsubTest()
      unsubParticipants()
    }
  }, [orgId, testId])

  useEffect(() => {
    if (!orgId || !test?.classId) return
    void getClass(orgId, test.classId).then(setOrgClass)
  }, [orgId, test?.classId])

  // Reading time hands over to working time on its own, on this (the
  // teacher's) clock — the same "schedule it once, don't poll" pattern the
  // exam room itself uses.
  useEffect(() => {
    if (!orgId || !testId || !test || test.phase !== 'reading' || test.phaseEndsAt === null) return
    const msLeft = Math.max(0, test.phaseEndsAt - Date.now())
    const id = window.setTimeout(() => {
      void startWorking(orgId, testId, test.workingMinutes)
    }, msLeft)
    return () => window.clearTimeout(id)
  }, [orgId, testId, test])

  if (!orgId || !testId) return null
  if (!isStaff) {
    return (
      <div className="page">
        <div className="alert alert-warn">Only this organisation's staff can monitor a test.</div>
      </div>
    )
  }
  if (!test) {
    return (
      <div className="page">
        {error ? <div className="alert alert-error">{error}</div> : <p className="muted">Loading…</p>}
      </div>
    )
  }

  const activeCount = participants.filter((p) => p.status === 'active').length
  const finishedCount = participants.filter((p) => p.status === 'finished').length
  const totalStudents = orgClass?.studentIds.length ?? null

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div className="grow">
          <h1>{test.title}</h1>
          <p className="muted">
            {test.className} · {PHASE_LABEL[test.phase]} · {RULE_PROFILES[test.ruleProfile].short}
          </p>
        </div>
        <Link className="btn" to={`/organisations/${orgId}`}>
          Back to console
        </Link>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="stat-grid" style={{ marginBottom: 22 }}>
        <div className="stat">
          <div className="value">
            {participants.length}
            {totalStudents !== null ? ` / ${totalStudents}` : ''}
          </div>
          <div className="label">Joined</div>
        </div>
        <div className="stat">
          <div className="value">{activeCount}</div>
          <div className="label">Working</div>
        </div>
        <div className="stat">
          <div className="value">{finishedCount}</div>
          <div className="label">Finished</div>
        </div>
      </div>

      <div className="row gap-2 wrap" style={{ marginBottom: 22 }}>
        {test.phase === 'lobby' && (
          <button
            className="btn btn-primary btn-lg"
            onClick={() =>
              void startReading(orgId, testId, test.readingMinutes).catch((err) =>
                setError(err instanceof Error ? err.message : 'Could not start the test.'),
              )
            }
          >
            Start test
          </button>
        )}
        {test.phase !== 'finished' && (
          <button
            className="btn btn-danger"
            onClick={() => {
              if (confirm('End this test for the whole class? Nobody will be able to keep working.')) {
                void finishTestSession(orgId, testId).catch((err) =>
                  setError(err instanceof Error ? err.message : 'Could not end the test.'),
                )
              }
            }}
          >
            End test
          </button>
        )}
      </div>

      <div className="card">
        {participants.length === 0 ? (
          <div className="empty" style={{ border: 'none' }}>Nobody has joined the waiting room yet.</div>
        ) : (
          participants.map((p, i) => (
            <div
              key={p.uid}
              className="row gap-3 wrap"
              style={{ padding: '14px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
            >
              <div className="grow">
                <strong>{p.name}</strong>
                {test.phase === 'working' && (
                  <div className="small muted">{p.preview ? `…${p.preview}` : 'Nothing written yet.'}</div>
                )}
              </div>
              <span className="badge">{p.wordCount} words</span>
              <span
                className={`badge ${
                  p.status === 'finished' ? 'badge-good' : p.status === 'active' ? 'badge-live' : ''
                }`}
              >
                {p.status === 'ready' ? 'Ready' : p.status === 'active' ? 'Working' : 'Finished'}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
