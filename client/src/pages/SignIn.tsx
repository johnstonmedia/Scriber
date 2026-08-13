import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { GoogleButton } from '../components/GoogleButton'

export function SignIn() {
  const { signIn, signUp, signInWithGoogle, googleEnabled, googleClientId } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
      } else {
        await signUp(email, password, name || undefined)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function handleGoogle(credential: string) {
    setError(null)
    setBusy(true)
    try {
      await signInWithGoogle(credential)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
    } finally {
      setBusy(false)
    }
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
              <span>"comma", "full stop", "new paragraph", "capital sydney" — nothing is added for you.</span>
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
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
              />
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
              {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          {googleEnabled && googleClientId && (
            <>
              <div className="or-line" style={{ margin: '18px 0' }}>
                or
              </div>
              <GoogleButton
                clientId={googleClientId}
                onCredential={handleGoogle}
                onError={setError}
              />
            </>
          )}

          <p className="tiny faint center" style={{ marginTop: 18 }}>
            Scriber is a practice tool. It is not affiliated with NESA, and it does not replace the
            writer you are approved to work with in the exam.
          </p>
        </div>
      </section>
    </div>
  )
}
