import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getClass, getOrganisation, type Organisation, type OrgClass } from '../lib/org'
import { RULE_PROFILES } from '../lib/ruleProfile'
import { appError, type AppError } from '../lib/errors'
import { ErrorNotice } from '../components/ErrorNotice'
import { StudentScreen } from '../components/StudentScreen'
import {
  finishTestSession,
  pauseParticipant,
  resumeParticipant,
  setAttendance,
  startReading,
  startWorking,
  subscribeIntegrityAlerts,
  subscribeTestParticipants,
  subscribeTestSession,
  type IntegrityAlert,
  type IntegrityAlertType,
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

const ALERT_LABEL: Record<IntegrityAlertType, string> = {
  'tab-hidden': 'Left the test tab',
  'focus-lost': 'Clicked away from the test',
  copy: 'Tried to copy',
  paste: 'Tried to paste',
  cut: 'Tried to cut',
  'devtools-shortcut': 'Pressed a developer-tools shortcut',
  'devtools-suspected': 'Developer tools may be open',
  'context-menu': 'Opened the right-click menu',
  'screen-share-stopped': 'Stopped sharing their screen',
  'other-tab-opened': 'Opened another site',
}

/** Anything above this is worth the teacher's eye, not just the log. */
const SERIOUS: IntegrityAlertType[] = ['tab-hidden', 'devtools-shortcut', 'devtools-suspected', 'paste']

/**
 * The teacher's own view of a live test — a NAPLAN-style proctoring screen:
 * who's arrived, whether they're reading, working or done, a live word count
 * and a trailing preview of each answer, and a running integrity feed.
 *
 * Three different things are watching, and they see different amounts, which
 * is worth keeping straight:
 *
 *   - The page itself sees only its own tab: losing focus, and copy, paste
 *     and dev-tools shortcuts aimed at it. That is every limit the browser
 *     imposes on web content, not a gap in this code.
 *   - The supervision extension sees the other tabs by name, because it holds
 *     a permission no web page can. A student without it installed shows as
 *     "tabs not monitored" rather than as clean.
 *   - The shared screen shows everything else — other applications included —
 *     which is why sharing the whole screen is a condition of sitting a test.
 */
export function TestMonitor() {
  const { orgId, testId } = useParams<{ orgId: string; testId: string }>()
  const { memberships, siteAdmin, user } = useAuth()
  const membership = memberships.find((m) => m.orgId === orgId)
  const isStaff = membership?.role === 'teacher' || membership?.role === 'admin' || siteAdmin
  const [test, setTest] = useState<TestSession | null>(null)
  const [org, setOrg] = useState<Organisation | null>(null)
  const [orgClass, setOrgClass] = useState<OrgClass | null>(null)
  const [participants, setParticipants] = useState<TestParticipant[]>([])
  const [alerts, setAlerts] = useState<IntegrityAlert[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<AppError | null>(null)

  useEffect(() => {
    if (!orgId || !testId) return
    const unsubTest = subscribeTestSession(orgId, testId, setTest)
    const unsubParticipants = subscribeTestParticipants(orgId, testId, setParticipants)
    const unsubAlerts = subscribeIntegrityAlerts(orgId, testId, setAlerts)
    return () => {
      unsubTest()
      unsubParticipants()
      unsubAlerts()
    }
  }, [orgId, testId])

  useEffect(() => {
    if (!orgId) return
    void getOrganisation(orgId).then(setOrg).catch(() => undefined)
  }, [orgId])

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

  // A timed pause lifts itself. The student cannot write their own pause
  // fields (the rules see to that), so the resume has to come from here.
  useEffect(() => {
    if (!orgId || !testId) return
    const due = participants.filter((p) => p.paused && p.pauseEndsAt !== null)
    if (due.length === 0) return
    const id = window.setInterval(() => {
      const now = Date.now()
      for (const p of due) {
        if (p.pauseEndsAt !== null && now >= p.pauseEndsAt) {
          void resumeParticipant(orgId, testId, p.uid).catch(() => undefined)
        }
      }
    }, 2000)
    return () => window.clearInterval(id)
  }, [orgId, testId, participants])

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
        {error ? <ErrorNotice error={error} /> : <p className="muted">Loading…</p>}
      </div>
    )
  }

  const activeCount = participants.filter((p) => p.status === 'active').length
  const finishedCount = participants.filter((p) => p.status === 'finished').length
  const totalStudents = orgClass?.studentIds.length ?? null
  const notSharing = participants.filter((p) => !p.sharing)
  const alertsByUid = alerts.reduce<Record<string, number>>((acc, a) => {
    acc[a.uid] = (acc[a.uid] ?? 0) + 1
    return acc
  }, {})

  /**
   * Taking the roll. Marking somebody absent ends the test for them
   * immediately, so it is confirmed — a misclick during an exam would put a
   * student out of an assessment they were sitting.
   */
  function handleAttendance(p: TestParticipant) {
    if (!orgId || !testId) return
    const next = p.attendance === 'absent' ? 'present' : 'absent'
    if (next === 'absent' && !confirm(`Mark ${p.name} absent? They will be put out of this test.`)) {
      return
    }
    void setAttendance(orgId, testId, p.uid, next).catch((err) => setError(appError('SCR-400', err)))
  }

  function handlePause(p: TestParticipant) {
    if (!orgId || !testId || !user) return
    if (p.paused) {
      void resumeParticipant(orgId, testId, p.uid).catch((err) => setError(appError('SCR-400', err)))
      return
    }
    const answer = prompt('Pause for how many minutes? Leave blank to pause until you resume them.', '5')
    if (answer === null) return
    const minutes = answer.trim() === '' ? null : Number(answer)
    if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0)) return
    void pauseParticipant(orgId, testId, p.uid, user.uid, minutes).catch((err) =>
      setError(appError('SCR-400', err)),
    )
  }

  return (
    <div className="page page-wide">
      <div
        className="page-head"
        style={org?.branding.accentColor ? { borderBottom: `3px solid ${org.branding.accentColor}` } : undefined}
      >
        {org?.branding.logoDataUrl && (
          <img src={org.branding.logoDataUrl} alt="" style={{ height: 40, marginRight: 12 }} />
        )}
        <div className="grow">
          <h1>{test.title}</h1>
          <p className="muted">
            {test.className} · {PHASE_LABEL[test.phase]} · {RULE_PROFILES[test.ruleProfile].short}
            {test.scheduledAt ? ` · ${new Date(test.scheduledAt).toLocaleString('en-AU')}` : ''}
          </p>
        </div>
        <Link className="btn" to={`/organisations/${orgId}`}>
          Back to console
        </Link>
      </div>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      <div className="stat-grid" style={{ marginBottom: 22 }}>
        <div className="stat">
          <div className="value">
            {participants.length}
            {totalStudents !== null ? ` / ${totalStudents}` : ''}
          </div>
          <div className="label">Logged on</div>
        </div>
        <div className="stat">
          <div className="value">{activeCount}</div>
          <div className="label">Working</div>
        </div>
        <div className="stat">
          <div className="value">{finishedCount}</div>
          <div className="label">Finished</div>
        </div>
        <div className="stat">
          <div className="value">{participants.filter((p) => p.attendance === 'absent').length}</div>
          <div className="label">Marked absent</div>
        </div>
        <div className="stat">
          <div className="value">{participants.filter((p) => p.sharing).length}</div>
          <div className="label">Sharing screen</div>
        </div>
        <div className="stat">
          <div className="value">{alerts.length}</div>
          <div className="label">Alerts</div>
        </div>
      </div>

      {test.phase === 'lobby' && notSharing.length > 0 && (
        <div className="alert alert-warn" style={{ marginBottom: 22 }}>
          Waiting on {notSharing.map((p) => p.name).join(', ')} to share their screen. You can still
          begin — they'll be flagged until they do.
        </div>
      )}

      <div className="row gap-2 wrap" style={{ marginBottom: 22 }}>
        {test.phase === 'lobby' && (
          <button
            className="btn btn-primary btn-lg"
            onClick={() =>
              void startReading(orgId, testId, test.readingMinutes).catch((err) =>
                setError(appError('SCR-400', err)),
              )
            }
          >
            Begin test
          </button>
        )}
        {test.phase === 'reading' && (
          <button
            className="btn btn-primary"
            onClick={() =>
              void startWorking(orgId, testId, test.workingMinutes).catch((err) =>
                setError(appError('SCR-400', err)),
              )
            }
          >
            End reading time now
          </button>
        )}
        {test.phase !== 'finished' && (
          <button
            className="btn btn-danger"
            onClick={() => {
              if (confirm('End this test for the whole class? Nobody will be able to keep working.')) {
                void finishTestSession(orgId, testId).catch((err) => setError(appError('SCR-400', err)))
              }
            }}
          >
            End test
          </button>
        )}
      </div>

      <div className="monitor-grid">
        <div className="card">
          {participants.length === 0 ? (
            <div className="empty" style={{ border: 'none' }}>Nobody has logged on yet.</div>
          ) : (
            participants.map((p, i) => (
              <div
                key={p.uid}
                className="stack gap-2"
                style={{ padding: '14px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
              >
                <div className="row gap-3 wrap">
                  <button
                    className="btn btn-ghost btn-sm grow"
                    style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                    onClick={() => setExpanded(expanded === p.uid ? null : p.uid)}
                  >
                    <strong>{p.name}</strong>
                  </button>
                  {alertsByUid[p.uid] && <span className="badge badge-warn">{alertsByUid[p.uid]} alerts</span>}
                  <span className="badge">{p.wordCount} words</span>
                  <span
                    className={`badge ${
                      p.attendance === 'absent'
                        ? 'badge-warn'
                        : p.paused
                        ? 'badge-warn'
                        : p.status === 'finished'
                          ? 'badge-good'
                          : p.status === 'active'
                            ? 'badge-live'
                            : ''
                    }`}
                  >
                    {p.attendance === 'absent'
                      ? 'Absent'
                      : p.paused
                        ? 'Paused'
                        : p.status === 'ready'
                          ? 'Ready'
                          : p.status === 'active'
                            ? 'Working'
                            : 'Finished'}
                  </span>
                  {test.phase !== 'finished' && p.status !== 'finished' && (
                    <button className="btn btn-sm" onClick={() => handleAttendance(p)}>
                      {p.attendance === 'absent' ? 'Mark present' : 'Mark absent'}
                    </button>
                  )}
                  {test.phase !== 'finished' && p.status !== 'finished' && p.attendance === 'present' && (
                    <button className="btn btn-sm" onClick={() => handlePause(p)}>
                      {p.paused ? 'Resume' : 'Pause'}
                    </button>
                  )}
                </div>
                {expanded === p.uid ? (
                  <div className="stack gap-2">
                    {user && (
                      <StudentScreen
                        orgId={orgId}
                        testId={testId}
                        studentUid={p.uid}
                        viewerUid={user.uid}
                        sharing={p.sharing}
                        large
                      />
                    )}
                    <div className="card card-pad" style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>
                      {p.preview ? `…${p.preview}` : 'Nothing written yet.'}
                    </div>
                  </div>
                ) : (
                  <div className="row gap-3 wrap" style={{ alignItems: 'flex-start' }}>
                    {user && (
                      <StudentScreen
                        orgId={orgId}
                        testId={testId}
                        studentUid={p.uid}
                        viewerUid={user.uid}
                        sharing={p.sharing}
                      />
                    )}
                    <div className="grow stack gap-1">
                      <TabWatch participant={p} />
                      {test.phase === 'working' && (
                        <div className="small muted">{p.preview ? `…${p.preview}` : 'Nothing written yet.'}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="card card-pad stack gap-3">
          <div>
            <h2 style={{ margin: 0 }}>Alerts</h2>
            <p className="tiny muted" style={{ marginTop: 4 }}>
              What a browser can report about its own tab. It cannot see other tabs or applications —
              watch the room for that.
            </p>
          </div>
          {alerts.length === 0 ? (
            <p className="small muted">Nothing flagged.</p>
          ) : (
            <div className="stack gap-2" style={{ maxHeight: 460, overflowY: 'auto' }}>
              {alerts.map((a) => (
                <div key={a.id} className="row gap-2 wrap">
                  <span className={`badge ${SERIOUS.includes(a.type) ? 'badge-warn' : ''}`}>
                    {ALERT_LABEL[a.type]}
                  </span>
                  <span className="small grow">{a.name}</span>
                  <span className="tiny muted">{new Date(a.at).toLocaleTimeString('en-AU')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


/**
 * The other tabs a student has open, as reported by the supervision
 * extension.
 *
 * The distinction between "no other tabs" and "we cannot see" matters to a
 * supervisor and is easy to blur, so an unreported student says so plainly
 * rather than showing an empty list that looks like a clean one.
 */
function TabWatch({ participant }: { participant: TestParticipant }) {
  if (!participant.extension) {
    return <span className="badge badge-warn">Tabs not monitored</span>
  }

  const { otherTabs, focused } = participant.extension
  if (otherTabs.length === 0) {
    return (
      <span className="badge badge-good">
        Scriber only{focused ? '' : ' · window not in focus'}
      </span>
    )
  }

  return (
    <div className="row gap-2 wrap">
      <span className="badge badge-warn">
        {otherTabs.length} other tab{otherTabs.length === 1 ? '' : 's'}
      </span>
      {otherTabs.slice(0, 4).map((tab) => (
        <span className={`badge ${tab.active ? 'badge-live' : ''}`} key={`${tab.host}-${tab.title}`} title={tab.title}>
          {tab.host || 'unknown'}
        </span>
      ))}
      {otherTabs.length > 4 && <span className="badge">+{otherTabs.length - 4}</span>}
    </div>
  )
}
