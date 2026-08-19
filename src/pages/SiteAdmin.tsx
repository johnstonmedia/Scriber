import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { resetMemberPassword } from '../lib/org'
import {
  deleteOrganisation,
  listOrganisationsWithCounts,
  type OrganisationSummary,
} from '../lib/siteAdmin'

/**
 * Platform-wide oversight — organisations and accounts, never content. There
 * is nowhere on this page to open a student's papers or dictated practice
 * sessions; firestore.rules doesn't grant a site admin that access at all.
 */
export function SiteAdmin() {
  const { siteAdmin, loading } = useAuth()
  const [orgs, setOrgs] = useState<OrganisationSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [lookupEmail, setLookupEmail] = useState('')
  const [lookupResult, setLookupResult] = useState<string | null>(null)

  useEffect(() => {
    if (!siteAdmin) return
    listOrganisationsWithCounts()
      .then(setOrgs)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load organisations.'))
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
