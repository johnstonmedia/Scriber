import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  acceptInvite,
  createOrganisation,
  listOrganisationDirectory,
  requestToJoin,
  withdrawJoinRequest,
  type Organisation,
} from '../lib/org'

/**
 * Where a signed-in user finds organisations: the ones they already belong
 * to, an invite waiting on their email, or a directory to browse and request
 * access to. Creating a new organisation also happens here.
 */
export function Organisations() {
  const { user, memberships, pendingInvites, canCreateOrg, refreshMemberships } = useAuth()
  const navigate = useNavigate()

  const [directory, setDirectory] = useState<Organisation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [requested, setRequested] = useState<Set<string>>(new Set())

  useEffect(() => {
    listOrganisationDirectory()
      .then(setDirectory)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load organisations.'))
  }, [])

  const myOrgIds = new Set(memberships.map((m) => m.orgId))

  async function handleAccept(orgId: string) {
    if (!user) return
    setBusy(orgId)
    setError(null)
    try {
      await acceptInvite(orgId, { uid: user.uid, email: user.email, name: user.name })
      await refreshMemberships()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept that invitation.')
    } finally {
      setBusy(null)
    }
  }

  async function handleRequest(orgId: string) {
    if (!user) return
    setBusy(orgId)
    setError(null)
    try {
      await requestToJoin(orgId, { uid: user.uid, email: user.email, name: user.name })
      setRequested((current) => new Set(current).add(orgId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that request.')
    } finally {
      setBusy(null)
    }
  }

  async function handleWithdraw(orgId: string) {
    if (!user) return
    setBusy(orgId)
    try {
      await withdrawJoinRequest(orgId, user.uid)
      setRequested((current) => {
        const next = new Set(current)
        next.delete(orgId)
        return next
      })
    } finally {
      setBusy(null)
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    if (!name) return
    setCreating(true)
    setError(null)
    try {
      const org = await createOrganisation(user.uid, { email: user.email, name: user.name }, name)
      await refreshMemberships()
      navigate(`/organisations/${org.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that organisation.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Organisations</h1>
          <p className="muted">
            A school or tutoring group using Scriber together — shared exam papers, classes, and
            staff who can support your practice.
          </p>
        </div>
        {canCreateOrg && (
          <button className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
            Create an organisation
          </button>
        )}
      </div>

      {!canCreateOrg && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          Creating an organisation is by invitation — ask your site admin for access if your school
          isn't here yet.
        </div>
      )}

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      {showCreate && (
        <form className="card card-pad stack gap-3" style={{ marginBottom: 24 }} onSubmit={handleCreate}>
          <h2>New organisation</h2>
          <p className="small muted">
            You become its admin — you can invite teachers and students, and approve requests to
            join, right away.
          </p>
          <div className="field" style={{ maxWidth: 360 }}>
            <label htmlFor="orgName">Organisation name</label>
            <input id="orgName" name="name" className="input" placeholder="Northside High School" required />
          </div>
          <div className="row gap-2">
            <button className="btn btn-primary" disabled={creating}>
              {creating ? 'Creating…' : 'Create organisation'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {pendingInvites.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ marginBottom: 12 }}>Waiting for you</h2>
          <div className="grid grid-cards">
            {pendingInvites.map((invite) => (
              <article className="card card-pad stack gap-3" key={invite.orgId}>
                <div>
                  <h3>{invite.orgName}</h3>
                  <p className="small muted">Invited as {invite.role}</p>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy === invite.orgId}
                  onClick={() => void handleAccept(invite.orgId)}
                >
                  {busy === invite.orgId ? 'Joining…' : 'Accept invitation'}
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {memberships.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ marginBottom: 12 }}>Your organisations</h2>
          <div className="grid grid-cards">
            {memberships.map((m) => (
              <article className="card card-pad stack gap-3" key={m.orgId}>
                <div>
                  <h3>{m.orgName || m.orgId}</h3>
                  <span className="badge badge-accent">
                    {m.role === 'admin' ? 'Admin' : m.role === 'teacher' ? 'Teacher' : 'Student'}
                  </span>
                </div>
                <Link className="btn btn-primary btn-sm" to={`/organisations/${m.orgId}`}>
                  Open
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 style={{ marginBottom: 12 }}>Find an organisation</h2>
        {directory.length === 0 ? (
          <div className="empty">No organisations have been created yet.</div>
        ) : (
          <div className="card">
            {directory
              .filter((org) => !myOrgIds.has(org.id))
              .map((org, index) => (
                <div
                  key={org.id}
                  className="row gap-3 wrap"
                  style={{
                    padding: '14px 18px',
                    borderTop: index === 0 ? 'none' : '1px solid var(--line)',
                  }}
                >
                  <div className="grow">
                    <strong>{org.name}</strong>
                    {!org.settings.allowJoinRequests && (
                      <div className="tiny muted">Not accepting join requests right now</div>
                    )}
                  </div>
                  {requested.has(org.id) ? (
                    <button
                      className="btn btn-sm"
                      disabled={busy === org.id}
                      onClick={() => void handleWithdraw(org.id)}
                    >
                      Requested — withdraw
                    </button>
                  ) : (
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={busy === org.id || !org.settings.allowJoinRequests}
                      onClick={() => void handleRequest(org.id)}
                    >
                      {busy === org.id ? 'Requesting…' : 'Request access'}
                    </button>
                  )}
                </div>
              ))}
            {directory.every((org) => myOrgIds.has(org.id)) && (
              <div className="empty" style={{ border: 'none' }}>
                You already belong to every listed organisation.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
