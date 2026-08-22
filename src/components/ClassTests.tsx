import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  createTestSession,
  subscribeClassTests,
  JOIN_WINDOW_MS,
  type TestPhase,
  type TestSession,
} from '../lib/testSession'
import { distributeOrgPaper, type OrgClass, type OrgPaper } from '../lib/org'
import { RULE_PROFILES } from '../lib/ruleProfile'
import { appError, type AppError } from '../lib/errors'
import { ErrorNotice } from './ErrorNotice'

/** Sentinel for "I'm bringing my own paper", distinct from any real paper id. */
const NEW_PAPER = '__upload__'

const PHASE_LABEL: Record<TestPhase, string> = {
  lobby: 'Waiting room',
  reading: 'Reading time',
  working: 'In progress',
  finished: 'Finished',
}

/**
 * Live tests for a set of classes — a teacher's or admin's "create a test"
 * form plus every class's test history, or (when canCreate is false) just a
 * student's own classes with a Join button on whatever's currently open.
 * `classes` is trusted to already be scoped to whoever is looking (a
 * teacher's own classes, an admin's whole org, or a student's own
 * memberships) — the caller decides that, same as elsewhere in the console.
 */
export function ClassTests({
  orgId,
  classes,
  papers,
  canCreate,
  currentUid,
  onPapersChanged,
}: {
  orgId: string
  classes: OrgClass[]
  papers: OrgPaper[]
  canCreate: boolean
  currentUid: string
  /** Called after a paper is uploaded here, so the caller can reload its list. */
  onPapersChanged?: () => void
}) {
  const [testsByClass, setTestsByClass] = useState<Record<string, TestSession[]>>({})
  const [error, setError] = useState<AppError | null>(null)
  /** '' is no paper, NEW_PAPER is upload one now, anything else is an existing id. */
  const [paperChoice, setPaperChoice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const unsubs = classes.map((c) =>
      subscribeClassTests(orgId, c.id, (tests) =>
        setTestsByClass((prev) => ({ ...prev, [c.id]: tests })),
      ),
    )
    return () => unsubs.forEach((unsub) => unsub())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, classes])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const formEl = event.currentTarget
    const form = new FormData(formEl)
    const classId = String(form.get('classId') ?? '')
    const cls = classes.find((c) => c.id === classId)
    if (!cls) return
    const scheduled = String(form.get('scheduledAt') ?? '')
    const readingMinutes = Number(form.get('readingMinutes') ?? 10)
    const workingMinutes = Number(form.get('workingMinutes') ?? 40)
    const chosen = String(form.get('paperId') ?? '')
    const title = String(form.get('title') ?? '').trim()

    setBusy(true)
    try {
      // A teacher setting up a test usually has the paper in front of them
      // rather than already in the library, so it can be uploaded right here.
      // It is distributed first — reading a PDF happens in this browser and
      // takes a moment — and the test is then built from the result.
      let paper: OrgPaper | null = null
      if (chosen === NEW_PAPER) {
        const file = form.get('paperFile') as File | null
        // The input is `required`, so this only catches a form submitted some
        // other way — but reaching createTestSession with no paper would make
        // a test that silently has nothing to read.
        if (!file?.size) {
          setError(appError('SCR-300', new Error('No file was chosen.')))
          return
        }
        try {
          paper = await distributeOrgPaper(orgId, currentUid, file, {
            title: title || file.name.replace(/\.[^.]+$/, ''),
            readingMinutes,
            workingMinutes,
            classIds: [cls.id],
          })
        } catch (err) {
          // Distribution and test creation fail for different reasons — a
          // scanned PDF with no text is not a permissions problem, and saying
          // so is the difference between a fixable message and a baffling one.
          setError(appError('SCR-300', err))
          return
        }
        onPapersChanged?.()
      } else if (chosen) {
        paper = papers.find((p) => p.id === chosen) ?? null
      }
      const paperId = paper?.id ?? null

      await createTestSession(
        orgId,
        currentUid,
        {
          classId: cls.id,
          className: cls.name,
          paperId,
          title: title || paper?.title || `${cls.name} test`,
          ruleProfile: form.get('ruleProfile') === 'assisted' ? 'assisted' : 'strict',
          readingMinutes,
          workingMinutes,
          scheduledAt: scheduled ? new Date(scheduled).getTime() : null,
        },
        paper,
      )
      formEl.reset()
      setPaperChoice('')
    } catch (err) {
      setError(appError('SCR-400', err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack gap-4">
      {canCreate && (
        <form className="card card-pad stack gap-3" onSubmit={handleCreate}>
          <h2>Set up a test</h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <div className="field">
              <label htmlFor="testClassId">Class</label>
              <select id="testClassId" name="classId" className="input" required defaultValue="">
                <option value="" disabled>
                  Choose a class…
                </option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="testTitle">Title</label>
              <input id="testTitle" name="title" className="input" placeholder="Term 3 practice test" />
            </div>
            <div className="field">
              <label htmlFor="testPaperId">Paper</label>
              <select
                id="testPaperId"
                name="paperId"
                className="input"
                value={paperChoice}
                onChange={(e) => setPaperChoice(e.target.value)}
              >
                <option value="">No paper — questions only</option>
                <option value={NEW_PAPER}>Upload a paper…</option>
                {papers.length > 0 && (
                  <optgroup label="Already distributed">
                    {papers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {paperChoice === NEW_PAPER && (
              <div className="field">
                <label htmlFor="testPaperFile">File (PDF or text)</label>
                <input
                  id="testPaperFile"
                  name="paperFile"
                  type="file"
                  className="input"
                  accept=".pdf,.txt"
                  required
                />
                <span className="tiny muted">
                  Read into questions in this browser. The file itself is never uploaded.
                </span>
              </div>
            )}
            <div className="field">
              <label htmlFor="testRuleProfile">Standard</label>
              <select id="testRuleProfile" name="ruleProfile" className="input" defaultValue="strict">
                <option value="strict">{RULE_PROFILES.strict.short}</option>
                <option value="assisted">{RULE_PROFILES.assisted.short}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="testReading">Reading time (min)</label>
              <input id="testReading" name="readingMinutes" type="number" className="input" defaultValue={10} />
            </div>
            <div className="field">
              <label htmlFor="testWorking">Working time (min)</label>
              <input id="testWorking" name="workingMinutes" type="number" className="input" defaultValue={40} />
            </div>
            <div className="field">
              <label htmlFor="testScheduled">Date and time</label>
              <input id="testScheduled" name="scheduledAt" type="datetime-local" className="input" />
              <span className="tiny muted">Students can enter the waiting room 5 minutes before this.</span>
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ alignSelf: 'flex-start' }}
            disabled={classes.length === 0 || busy}
          >
            {busy ? (paperChoice === NEW_PAPER ? 'Reading the paper…' : 'Creating…') : 'Create test'}
          </button>
          {classes.length === 0 && <p className="small muted">Create a class first.</p>}
          <ErrorNotice error={error} onDismiss={() => setError(null)} />
        </form>
      )}

      <div className="stack gap-4">
        {classes.map((c) => {
          const tests = testsByClass[c.id] ?? []
          return (
            <div key={c.id} className="card card-pad stack gap-2">
              <strong>{c.name}</strong>
              {tests.length === 0 && <span className="small muted">No tests yet.</span>}
              {tests.map((t) => {
                const open =
                  t.scheduledAt === null || t.phase !== 'lobby' || Date.now() >= t.scheduledAt - JOIN_WINDOW_MS
                return (
                  <div className="row gap-3 wrap" key={t.id}>
                    <div className="grow">
                      <span className="small">{t.title}</span>
                      <div className="tiny muted">
                        {RULE_PROFILES[t.ruleProfile].short}
                        {t.scheduledAt ? ` · ${new Date(t.scheduledAt).toLocaleString('en-AU')}` : ''}
                      </div>
                    </div>
                    <span className={`badge ${t.phase === 'working' || t.phase === 'reading' ? 'badge-live' : t.phase === 'finished' ? '' : 'badge-accent'}`}>
                      {PHASE_LABEL[t.phase]}
                    </span>
                    {canCreate ? (
                      <Link className="btn btn-sm btn-primary" to={`/organisations/${orgId}/tests/${t.id}`}>
                        Monitor
                      </Link>
                    ) : (
                      t.phase !== 'finished' &&
                      (open ? (
                        <Link className="btn btn-sm btn-primary" to={`/exam?org=${orgId}&test=${t.id}`}>
                          Start test
                        </Link>
                      ) : (
                        <span className="badge">Opens 5 min before</span>
                      ))
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
        {classes.length === 0 && !canCreate && <div className="empty">No classes yet.</div>}
      </div>
    </div>
  )
}
