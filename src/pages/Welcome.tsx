import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { emailDomain, findOrgByDomain, joinByDomain, type OrgDomain } from '../lib/org'

type Step = 'choose' | 'verify-for-org'

/**
 * A one-time walkthrough after sign-up (or a Google sign-in that turns out
 * to be brand new): personal practice, or an organisation. Picking
 * organisation checks the account's email domain against every org that has
 * registered one — a match joins instantly, as a student, once the email is
 * verified. No match falls through to the existing directory page, which
 * already knows how to request access to or create an organisation.
 */
export function Welcome() {
  const { user, markOnboarded, sendVerificationEmail, refreshEmailVerified, refreshMemberships } =
    useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('choose')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [matchedOrg, setMatchedOrg] = useState<OrgDomain | null>(null)
  const [resent, setResent] = useState(false)

  if (!user) return null

  async function finishJoining(org: OrgDomain) {
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      await joinByDomain(org.orgId, { uid: user.uid, email: user.email, name: user.name })
      await refreshMemberships()
      await markOnboarded()
      navigate(`/organisations/${org.orgId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join that organisation.')
    } finally {
      setBusy(false)
    }
  }

  async function choosePersonal() {
    setBusy(true)
    try {
      await markOnboarded()
      navigate('/')
    } finally {
      setBusy(false)
    }
  }

  async function chooseOrganisation() {
    setBusy(true)
    setError(null)
    try {
      const org = await findOrgByDomain(emailDomain(user!.email))
      if (!org) {
        // No domain match — the directory already knows how to request
        // access to, or (if permitted) create, an organisation.
        await markOnboarded()
        navigate('/organisations')
        return
      }
      setMatchedOrg(org)
      if (user!.emailVerified) {
        await finishJoining(org)
      } else {
        setStep('verify-for-org')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check your organisation.')
    } finally {
      setBusy(false)
    }
  }

  async function checkVerified() {
    if (!matchedOrg) return
    setBusy(true)
    setError(null)
    try {
      const verified = await refreshEmailVerified()
      if (!verified) {
        setError("That email isn't verified yet — click the link in the email first.")
        return
      }
      await finishJoining(matchedOrg)
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
          <h1>One more thing before you start.</h1>
          <p className="lede">
            Just so the right things show up in your account — this takes a few seconds and you
            won't see it again.
          </p>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card card card-pad">
          {step === 'choose' && (
            <div className="stack gap-3">
              <h2>How will you be using Scriber?</h2>
              <button
                type="button"
                className="btn btn-lg btn-block btn-primary"
                disabled={busy}
                onClick={() => void chooseOrganisation()}
              >
                Organisation account
              </button>
              <p className="small muted" style={{ marginTop: -6 }}>
                For a school or tutoring group. If your email matches one already using Scriber,
                you'll join it automatically.
              </p>
              <button
                type="button"
                className="btn btn-lg btn-block"
                disabled={busy}
                onClick={() => void choosePersonal()}
              >
                Personal account
              </button>
              <p className="small muted" style={{ marginTop: -6 }}>
                Just for you — practise on your own. You can join or create an organisation later
                from the Organisations page any time.
              </p>
              {error && <div className="alert alert-error">{error}</div>}
            </div>
          )}

          {step === 'verify-for-org' && matchedOrg && (
            <div className="stack gap-3">
              <h2>Verify your email to join {matchedOrg.orgName}</h2>
              <p className="small muted">
                Your email address matches {matchedOrg.orgName}'s domain, so you'll join
                automatically — we just need to confirm the address is really yours first. We sent
                a verification link to <strong>{user.email}</strong> when you signed up.
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
              <button
                type="button"
                className="btn btn-ghost btn-block"
                disabled={busy}
                onClick={() => {
                  setStep('choose')
                  setMatchedOrg(null)
                  setError(null)
                }}
              >
                Back
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
