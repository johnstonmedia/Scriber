import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { resetMemberPassword } from '../lib/org'
import {
  deleteOrganisation,
  grantOrgCreator,
  listOrganisationsWithCounts,
  listOrgCreators,
  revokeOrgCreator,
  type OrganisationSummary,
} from '../lib/siteAdmin'
import { DEFAULT_SITE_CONFIG, setSiteLock, subscribeSiteConfig } from '../lib/siteConfig'

/**
 * Platform-wide oversight — organisations and accounts, never content. There
 * is nowhere on this page to open a student's papers or dictated practice
 * sessions; firestore.rules doesn't grant a site admin that access at all.
 */
export function SiteAdmin() {
  const { user, siteAdmin, loading } = useAuth()
  const [orgs, setOrgs] = useState<OrganisationSummary[]>([])
  const [creators, setCreators] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [lookupEmail, setLookupEmail] = useState('')
  const [lookupResult, setLookupResult] = useState<string | null>(null)
  const [newCreatorEmail, setNewCreatorEmail] = useState('')

  useEffect(() => {
    if (!siteAdmin) return
    listOrganisationsWithCounts()
      .then(setOrgs)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load organisations.'))
    listOrgCreators()
      .then(setCreators)
      .catch(() => undefined)
  }, [siteAdmin])

  if (loading) return null

  if (!siteAdmin) {
    return (
      <div className="page">
        <div className="alert alert-error">You do not have site admin access.</div>
      </div>
    )
  }

  async function refresh() {
    setOrgs(await listOrganisationsWithCounts())
  }

  async function refreshCreators() {
    setCreators(await listOrgCreators())
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Site admin</h1>
          <p className="muted">
            Organisations and accounts, platform-wide. This view has no access to any student's
            papers or dictated practice sessions — that stays private, including from here.
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      {notice && <div className="alert alert-info" style={{ marginBottom: 16 }}>{notice}</div>}

      <SiteLockPanel />

      <section className="card card-pad stack gap-3" style={{ marginBottom: 24, maxWidth: 480 }}>
        <h2>Look up an account</h2>
        <form
          className="row gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            setLookupResult(null)
            setError(null)
            try {
              // Password reset only needs the email — no uid lookup required.
              await resetMemberPassword(lookupEmail.trim())
              setLookupResult(`Password reset email sent to ${lookupEmail.trim()}.`)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not send that reset email.')
            }
          }}
        >
          <input
            className="input grow"
            type="email"
            placeholder="student@school.edu"
            value={lookupEmail}
            onChange={(e) => setLookupEmail(e.target.value)}
            required
          />
          <button className="btn btn-primary">Send password reset</button>
        </form>
        {lookupResult && <p className="small muted">{lookupResult}</p>}
      </section>

      <section className="card card-pad stack gap-3" style={{ marginBottom: 24, maxWidth: 480 }}>
        <h2>Who can create an organisation</h2>
        <p className="small muted" style={{ marginTop: -8 }}>
          Signing up doesn't let anyone start a new organisation on their own — grant an email
          access here first. Whoever creates one becomes its admin.
        </p>
        <form
          className="row gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!user) return
            void grantOrgCreator(newCreatorEmail.trim(), user.uid).then(() => {
              setNewCreatorEmail('')
              void refreshCreators()
            })
          }}
        >
          <input
            className="input grow"
            type="email"
            placeholder="principal@school.edu"
            value={newCreatorEmail}
            onChange={(e) => setNewCreatorEmail(e.target.value)}
            required
          />
          <button className="btn btn-primary">Grant</button>
        </form>
        {creators.length > 0 && (
          <div className="stack gap-2">
            {creators.map((email) => (
              <div className="row gap-2" key={email}>
                <span className="grow small">{email}</span>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => void revokeOrgCreator(email).then(refreshCreators)}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ marginBottom: 12 }}>Organisations</h2>
        {orgs.length === 0 ? (
          <div className="empty">No organisations have been created yet.</div>
        ) : (
          <div className="card">
            {orgs.map((org, i) => (
              <div
                key={org.id}
                className="row gap-3 wrap"
                style={{ padding: '14px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
              >
                <div className="grow">
                  <strong>{org.name}</strong>
                  <div className="small muted">
                    {org.memberCount} member{org.memberCount === 1 ? '' : 's'} · created{' '}
                    {new Date(org.createdAt).toLocaleDateString('en-AU')}
                  </div>
                </div>
                <Link className="btn btn-sm" to={`/organisations/${org.id}`}>
                  Open
                </Link>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => {
                    if (
                      confirm(
                        `Permanently delete "${org.name}" and every member, class and distributed paper in it? This cannot be undone.`,
                      )
                    ) {
                      void deleteOrganisation(org.id).then(() => {
                        setNotice(`"${org.name}" was deleted.`)
                        void refresh()
                      })
                    }
                  }}
                >
                  Delete organisation
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * The "coming soon" switch. Locked, everyone but a signed-in site admin sees
 * a holding page instead of the app — which means whoever flips this can
 * still work on the site normally while it's shut to the world.
 */
function SiteLockPanel() {
  const [config, setConfig] = useState(DEFAULT_SITE_CONFIG)
  const [message, setMessage] = useState(DEFAULT_SITE_CONFIG.message)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(
    () =>
      subscribeSiteConfig((next) => {
        setConfig(next)
        // Don't overwrite what's being typed right now.
        if (!touched) setMessage(next.message)
      }),
    [touched],
  )

  return (
    <section className="card card-pad stack gap-3" style={{ marginBottom: 24, maxWidth: 480 }}>
      <div className="row gap-2">
        <h2 className="grow" style={{ margin: 0 }}>
          Site lock
        </h2>
        <span className={`badge ${config.locked ? 'badge-warn' : 'badge-good'}`}>
          {config.locked ? 'Locked' : 'Open'}
        </span>
      </div>
      <p className="small muted">
        Locked, everyone sees a coming-soon page. You keep full access while signed in as a site
        admin.
      </p>
      <div className="field">
        <label htmlFor="lockMessage">What visitors see</label>
        <input
          id="lockMessage"
          className="input"
          value={message}
          onChange={(e) => {
            setTouched(true)
            setMessage(e.target.value)
          }}
        />
      </div>
      <button
        className={`btn ${config.locked ? 'btn-primary' : 'btn-danger'}`}
        style={{ alignSelf: 'flex-start' }}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await setSiteLock(!config.locked, message)
            setTouched(false)
          } finally {
            setBusy(false)
          }
        }}
      >
        {config.locked ? 'Unlock the site' : 'Lock the site'}
      </button>
    </section>
  )
}
