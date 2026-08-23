import { useState, type FormEvent } from 'react'
import { DEMO_REQUEST_LIMITS, submitDemoRequest } from '../lib/demoRequests'
import { DEMO_SEATS } from '../lib/seats'

/**
 * The public site's way in for a school. Deliberately short: a name, a person
 * and an email is enough to have a conversation, and every extra required
 * field is another reason a head of learning support closes the tab.
 */
export function DemoRequestForm() {
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const value = (key: string) => String(form.get(key) ?? '')
    setBusy(true)
    setError(null)
    try {
      await submitDemoRequest({
        organisation: value('organisation'),
        contactName: value('contactName'),
        email: value('email'),
        role: value('role'),
        students: value('students'),
        message: value('message'),
      })
      setSent(true)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "That didn't send. Please try again in a moment.",
      )
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="card card-pad stack gap-2 demo-request-done">
        <h3>Thanks — that's with us.</h3>
        <p className="muted">
          We'll email you to set up a demo for up to {DEMO_SEATS} students, with your own papers
          and your school's name on it. Nothing is charged and there's nothing to install.
        </p>
      </div>
    )
  }

  return (
    <form className="card card-pad stack gap-3 demo-request-form" onSubmit={handleSubmit}>
      <div className="demo-request-grid">
        <div className="field">
          <label htmlFor="dr-organisation">School or organisation</label>
          <input
            id="dr-organisation"
            name="organisation"
            className="input"
            required
            maxLength={DEMO_REQUEST_LIMITS.organisation}
            placeholder="Northside High School"
          />
        </div>
        <div className="field">
          <label htmlFor="dr-contactName">Your name</label>
          <input
            id="dr-contactName"
            name="contactName"
            className="input"
            required
            maxLength={DEMO_REQUEST_LIMITS.contactName}
            placeholder="Sam Patel"
          />
        </div>
        <div className="field">
          <label htmlFor="dr-email">Work email</label>
          <input
            id="dr-email"
            name="email"
            type="email"
            className="input"
            required
            maxLength={DEMO_REQUEST_LIMITS.email}
            placeholder="sam.patel@northside.nsw.edu.au"
          />
        </div>
        <div className="field">
          <label htmlFor="dr-role">Your role</label>
          <input
            id="dr-role"
            name="role"
            className="input"
            maxLength={DEMO_REQUEST_LIMITS.role}
            placeholder="Head of Learning Support"
          />
        </div>
        <div className="field">
          <label htmlFor="dr-students">Students with a writer provision</label>
          <input
            id="dr-students"
            name="students"
            className="input"
            maxLength={DEMO_REQUEST_LIMITS.students}
            placeholder="About 25"
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="dr-message">Anything we should know? (optional)</label>
        <textarea
          id="dr-message"
          name="message"
          className="input"
          rows={3}
          maxLength={DEMO_REQUEST_LIMITS.message}
          placeholder="Trials are in Term 3 and we'd like to have students practising before then."
        />
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="row gap-3 wrap" style={{ alignItems: 'center' }}>
        <button className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? 'Sending…' : 'Request a demo'}
        </button>
        <span className="small muted">
          A demo covers up to {DEMO_SEATS} students. No credit card, no installation.
        </span>
      </div>
    </form>
  )
}
