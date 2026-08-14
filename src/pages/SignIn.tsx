import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'

export function SignIn() {
  const { signIn, signUp, signInWithGoogle, configured } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void run(() =>
      mode === 'signin' ? signIn(email, password) : signUp(email, password, name || undefined),
    )
  }

  return (
    <div className="auth-screen">
      <section className="auth-pitch">
        <div className="stack gap-4">
          <div className="row gap-3">
            <span className="brand-mark" style={{ width: 34, height: 34, fontSize: '1rem' }}>
              S
            </span>
            <strong style={{ fontSize: '1.2rem', letterSpacing: '-0.02em' }}>Scriber</strong>
          </div>
          <h1>Practise with a writer before the exam room does it for real.</h1>
          <p className="lede">
            Scriber acts as your writer under NESA exam provisions. It writes down exactly what
            you say — and nothing you don't. Dictate your punctuation, your paragraphs and your
            capitals, just like you will on exam day.
          </p>
        </div>

        <ul className="pitch-list">
          <li>
            <span className="pitch-icon">1</span>
            <div>
              <strong>Upload your past papers</strong>
              <span>Read the question on one side, dictate your answer on the other.</span>
            </div>
          </li>
          <li>
            <span className="pitch-icon">2</span>
            <div>
              <strong>Say every mark yourself</strong>
              <span>
                "comma", "full stop", "new paragraph", "capital sydney" — nothing is added for you.
              </span>
            </div>
          </li>
          <li>
            <span className="pitch-icon">3</span>
            <div>
              <strong>Ask for a read back</strong>
              <span>Hear your last two sentences read aloud, exactly as a writer may do.</span>
            </div>
          </li>
          <li>
            <span className="pitch-icon">4</span>
            <div>
              <strong>See where you slipped</strong>
              <span>Every session ends with the habits to work on before the next one.</span>
            </div>
          </li>
        </ul>
      </section>

      <section className="auth-panel">
        <div className="auth-card card card-pad">
          {!configured && (
            <div className="alert alert-warn" style={{ marginBottom: 16 }}>
              Firebase is not configured yet. Copy <code>.env.example</code> to <code>.env</code>{' '}
              and add your project keys, then reload.
            </div>
          )}

          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className="auth-tab"
              aria-selected={mode === 'signin'}
              onClick={() => {
                setMode('signin')
                setError(null)
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              className="auth-tab"
              aria-selected={mode === 'signup'}
              onClick={() => {
                setMode('signup')
                setError(null)
              }}
            >
              Create account
            </button>
          </div>

          <button
            type="button"
            className="btn btn-lg btn-block google-btn"
            disabled={busy || !configured}
            onClick={() => void run(signInWithGoogle)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"
              />
              <path
                fill="#FBBC05"
                d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.65 3.58 9 3.58Z"
              />
            </svg>
            Continue with Google
          </button>

          <div className="or-line" style={{ margin: '18px 0' }}>
            or
          </div>

          <form className="stack gap-3" onSubmit={submit}>
            {mode === 'signup' && (
              <div className="field">
                <label htmlFor="name">Your name</label>
                <input
                  id="name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  placeholder="Alex Nguyen"
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                className="input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@school.nsw.edu.au"
              />
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder={mode === 'signup' ? 'At least 6 characters' : ''}
              />
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <button className="btn btn-primary btn-lg btn-block" disabled={busy || !configured}>
              {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="tiny faint center" style={{ marginTop: 18 }}>
            Scriber is a practice tool. It is not affiliated with NESA, and it does not replace the
            writer you are approved to work with in the exam.
          </p>
        </div>
      </section>
    </div>
  )
}
