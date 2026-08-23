import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  acceptInvite,
  createOrganisation,
  listOrganisationDirectory,
  normaliseSlug,
  requestToJoin,
  setOrgSlug,
  withdrawJoinRequest,
  type Organisation,
} from '../lib/org'
import { rootDomain } from '../lib/hostOrg'

/**
 * Where a signed-in user finds organisations: the ones they already belong
 * to, an invite waiting on their email, or a search to find one and request
 * access. There's deliberately no browsable list of every school on the
 * platform — you have to already know its name. Creating a new organisation
 * also happens here.
 */
export function Organisations() {
  const { user, memberships, pendingInvites, canCreateOrg, refreshMemberships, orgStateError } = useAuth()
  const navigate = useNavigate()

  const [directory, setDirectory] = useState<Organisation[] | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [requested, setRequested] = useState<Set<string>>(new Set())

  const myOrgIds = new Set(memberships.map((m) => m.orgId))

  // Fetched once, on the first search — never on page load, so there's
  // nothing to browse without typing something first.
  async function ensureDirectoryLoaded() {
    if (directory !== null) return
    try {
      setDirectory(await listOrganisationDirectory())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not search organisations.')
    }
  }

  const term = searchTerm.trim().toLowerCase()
  const results =
    term.length < 2
      ? []
      : (directory ?? []).filter((org) => !myOrgIds.has(org.id) && org.name.toLowerCase().includes(term))

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
    const wanted = String(form.get('slug') ?? '').trim() || name
    setCreating(true)
    setError(null)
    try {
      const org = await createOrganisation(user.uid, { email: user.email, name: user.name }, name)
      // The address is claimed separately and deliberately not waited on.
      // Uniqueness lives in its own collection, so a name somebody else holds
      // must not cost you the organisation you just made — and neither must a
      // slow write: the organisation exists, and an address that fails to
      // stick is a field in Settings, not a reason to leave somebody looking
      // at a spinner.
      void setOrgSlug(org.id, wanted).catch(() => undefined)
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
      {orgStateError && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          Couldn't load your organisations ({orgStateError}) — your existing memberships and admin
          roles may not be showing correctly.{' '}
          <button className="btn btn-sm" onClick={() => void refreshMemberships()}>
            Try again
          </button>
        </div>
      )}

      {showCreate && (
        <form className="card card-pad stack gap-3" style={{ marginBottom: 24 }} onSubmit={handleCreate}>
          <h2>New organisation</h2>
          <p className="small muted">
            You become its admin — you can invite teachers and students, and approve requests to
            join, right away.
          </p>
          <div className="field" style={{ maxWidth: 360 }}>
            <label htmlFor="orgName">Organisation name</label>
            <input
              id="orgName"
              name="name"
              className="input"
              placeholder="Northside High School"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                // Follow the name until the admin edits the address itself,
                // then leave theirs alone.
                if (!slugTouched) setSlug(normaliseSlug(e.target.value) ?? '')
              }}
            />
          </div>
          <div className="field" style={{ maxWidth: 360 }}>
            <label htmlFor="orgSlug">Web address</label>
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <input
                id="orgSlug"
                name="slug"
                className="input"
                placeholder="northside"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  setSlug(e.target.value)
                }}
                style={{ maxWidth: 190 }}
              />
              <span className="small muted">.{rootDomain()}</span>
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>
              Your school's own address. Anyone who belongs here is taken to it automatically when
              they sign in; anyone who doesn't is sent back to the main site.
            </p>
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
        <p className="small muted" style={{ marginTop: -6, marginBottom: 12 }}>
          Search by name — there's no list to browse, so you'll need to know what your school or
          tutoring group is called on Scriber.
        </p>
        <input
          className="input"
          style={{ maxWidth: 360, marginBottom: 16 }}
          placeholder="Search organisations…"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value)
            void ensureDirectoryLoaded()
          }}
        />
        {term.length >= 2 && (
          <div className="card">
            {results.length === 0 ? (
              <div className="empty" style={{ border: 'none' }}>
                No organisation matches "{searchTerm.trim()}".
              </div>
            ) : (
              results.map((org, index) => (
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
              ))
            )}
          </div>
        )}
      </section>
    </div>
  )
}
