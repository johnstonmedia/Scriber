import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { createTestSession, subscribeClassTests, type TestPhase, type TestSession } from '../lib/testSession'
import type { OrgClass, OrgPaper } from '../lib/org'
import { RULE_PROFILES } from '../lib/ruleProfile'

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
}: {
  orgId: string
  classes: OrgClass[]
  papers: OrgPaper[]
  canCreate: boolean
  currentUid: string
}) {
  const [testsByClass, setTestsByClass] = useState<Record<string, TestSession[]>>({})
  const [error, setError] = useState<string | null>(null)

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
    const paperId = String(form.get('paperId') ?? '') || null
    const paper = paperId ? papers.find((p) => p.id === paperId) : null
    try {
      await createTestSession(orgId, currentUid, {
        classId: cls.id,
        className: cls.name,
        paperId,
        title: String(form.get('title') ?? '').trim() || paper?.title || `${cls.name} test`,
        ruleProfile: form.get('ruleProfile') === 'assisted' ? 'assisted' : 'strict',
        readingMinutes: Number(form.get('readingMinutes') ?? 10),
        workingMinutes: Number(form.get('workingMinutes') ?? 40),
      })
      formEl.reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that test.')
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
              <label htmlFor="testPaperId">Paper (optional)</label>
              <select id="testPaperId" name="paperId" className="input" defaultValue="">
                <option value="">No paper — questions only</option>
                {papers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
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
          </div>
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={classes.length === 0}>
            Create test
          </button>
          {classes.length === 0 && <p className="small muted">Create a class first.</p>}
          {error && <p className="small" style={{ color: 'var(--live)' }}>{error}</p>}
        </form>
      )}

      <div className="stack gap-4">
        {classes.map((c) => {
          const tests = testsByClass[c.id] ?? []
          return (
            <div key={c.id} className="card card-pad stack gap-2">
              <strong>{c.name}</strong>
              {tests.length === 0 && <span className="small muted">No tests yet.</span>}
              {tests.map((t) => (
                <div className="row gap-3 wrap" key={t.id}>
                  <div className="grow">
                    <span className="small">{t.title}</span>
                    <div className="tiny muted">{RULE_PROFILES[t.ruleProfile].short}</div>
                  </div>
                  <span className={`badge ${t.phase === 'working' || t.phase === 'reading' ? 'badge-live' : t.phase === 'finished' ? '' : 'badge-accent'}`}>
                    {PHASE_LABEL[t.phase]}
                  </span>
                  {canCreate ? (
                    <Link className="btn btn-sm btn-primary" to={`/organisations/${orgId}/tests/${t.id}`}>
                      Monitor
                    </Link>
                  ) : (
                    t.phase !== 'finished' && (
                      <Link className="btn btn-sm btn-primary" to={`/exam?org=${orgId}&test=${t.id}`}>
                        Join
                      </Link>
                    )
                  )}
                </div>
              ))}
            </div>
          )
        })}
        {classes.length === 0 && !canCreate && <div className="empty">No classes yet.</div>}
      </div>
    </div>
  )
}
