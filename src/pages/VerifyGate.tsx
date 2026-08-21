import { useState } from 'react'
import { useAuth } from '../lib/auth'

/**
 * Blocks the whole app — not just org actions — for an account with a
 * pending invite until its email is verified. An invite means someone
 * specifically expects this address to end up in their class; letting it
 * sit unverified while the account quietly practises solo defeats that, so
 * this gate sits ahead of everything else Shell renders, onboarding
 * included.
 */
export function VerifyGate() {
  const { user, pendingInvites, sendVerificationEmail, refreshEmailVerified, signOut } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resent, setResent] = useState(false)

  if (!user) return null

  async function checkVerified() {
    setBusy(true)
    setError(null)
    try {
      const verified = await refreshEmailVerified()
      if (!verified) {
        setError("That email isn't verified yet — click the link in the email first.")
      }
    } finally {
      setBusy(false)
    }
  }

  const orgNames = pendingInvites.map((i) => i.orgName).join(', ')

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
          <h1>Verify your email to continue.</h1>
          <p className="lede">
            {orgNames || 'An organisation'} invited this address — confirming it's really yours
            comes before anything else.
          </p>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card card card-pad">
          <div className="stack gap-3">
            <h2>Check your inbox</h2>
            <p className="small muted">
              We sent a verification link to <strong>{user.email}</strong> when you signed up.
              Click it, then come back here.
            </p>
            {error && <div className="alert alert-error">{error}</div>}
            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              disabled={busy}
              onClick={() => void checkVerified()}
            >
              {busy ? 'Checking…' : "I've verified — continue"}
            </button>
            <button
              type="button"
              className="btn btn-block"
              disabled={busy || resent}
              onClick={() =>
                void sendVerificationEmail()
                  .then(() => setResent(true))
                  .catch((err) => setError(err instanceof Error ? err.message : 'Could not resend that email.'))
              }
            >
              {resent ? 'Sent — check your inbox' : 'Resend verification email'}
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
