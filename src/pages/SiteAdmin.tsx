import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { createOrganisation, inviteMember, resetMemberPassword, setOrgPlan } from '../lib/org'
import {
  deleteOrganisation,
  grantOrgCreator,
  listOrganisationsWithCounts,
  listOrgCreators,
  revokeOrgCreator,
  type OrganisationSummary,
} from '../lib/siteAdmin'
import {
  DEMO_SEATS,
  SEAT_TIERS,
  demoPlan,
  licensedPlan,
  planExpired,
  planLabel,
} from '../lib/seats'
import {
  deleteDemoRequest,
  listDemoRequests,
  setDemoRequestStatus,
  type DemoRequest,
} from '../lib/demoRequests'
import {
  DEFAULT_SITE_CONFIG,
  setSiteContent,
  setSiteLock,
  subscribeSiteConfig,
  type SiteContent,
} from '../lib/siteConfig'
import { rootDomain } from '../lib/hostOrg'

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
      <SiteContentEditor />
      <DemoRequestQueue onOrgCreated={() => void refresh()} />

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
                  <div className="tiny" style={{ marginTop: 4 }}>
                    <span
                      className={`badge ${
                        org.plan.studentSeats === null
                          ? 'badge-warn'
                          : planExpired(org.plan)
                            ? 'badge-live'
                            : org.plan.kind === 'demo'
                              ? 'badge-accent'
                              : 'badge-good'
                      }`}
                    >
                      {planLabel(org.plan)}
                    </span>
                    {planExpired(org.plan) && (
                      <span className="muted"> · demo expired {new Date(org.plan.expiresAt!).toLocaleDateString('en-AU')}</span>
                    )}
                  </div>
                </div>
                <SeatTierPicker
                  org={org}
                  onChanged={() => {
                    setNotice(`Updated the plan for "${org.name}".`)
                    void refresh()
                  }}
                  onError={setError}
                />
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
 * How many students a school is licensed for. Only a site admin can change
 * this — firestore.rules refuses a plan write from a school's own admin, so
 * this control is the only place a ceiling moves.
 */
function SeatTierPicker({
  org,
  onChanged,
  onError,
}: {
  org: OrganisationSummary
  onChanged: () => void
  onError: (message: string) => void
}) {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)

  const current = org.plan.kind === 'demo' ? 'demo' : String(org.plan.studentSeats ?? '')

  async function apply(value: string) {
    if (!user || value === current) return
    setBusy(true)
    try {
      await setOrgPlan(
        org.id,
        value === 'demo'
          ? demoPlan(user.uid)
          : value === ''
            ? { ...licensedPlan(0, user.uid), studentSeats: null }
            : licensedPlan(Number(value), user.uid),
      )
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not change that plan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <label className="row gap-2" style={{ alignItems: 'center' }}>
      <span className="tiny muted">Seats</span>
      <select
        className="input"
        style={{ width: 150 }}
        disabled={busy}
        value={current}
        onChange={(e) => void apply(e.target.value)}
        aria-label={`Student seats for ${org.name}`}
      >
        <option value="demo">Demo — {DEMO_SEATS}</option>
        {SEAT_TIERS.map((tier) => (
          <option key={tier} value={tier}>
            Up to {tier}
          </option>
        ))}
        <option value="">No limit</option>
      </select>
    </label>
  )
}

/**
 * Schools that asked for a demo on the public site.
 *
 * "Start demo" does the whole thing in one go: it creates the organisation,
 * puts it on a demo plan, and invites the person who asked as its admin. They
 * accept from their own email and the school is theirs — no separate
 * onboarding step, and nothing for them to set up first.
 */
function DemoRequestQueue({ onOrgCreated }: { onOrgCreated: () => void }) {
  const { user } = useAuth()
  const [requests, setRequests] = useState<DemoRequest[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showHandled, setShowHandled] = useState(false)

  const refresh = () =>
    listDemoRequests()
      .then(setRequests)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load demo requests.'))

  useEffect(() => {
    void refresh()
  }, [])

  async function startDemo(request: DemoRequest) {
    if (!user) return
    setBusy(request.id)
    setError(null)
    try {
      // The site admin creates it and is its first admin; the school's own
      // contact is invited straight in alongside them, so nobody is waiting
      // on anybody to hand anything over.
      const org = await createOrganisation(
        user.uid,
        { email: user.email, name: user.name },
        request.organisation,
        demoPlan(user.uid),
      )
      await inviteMember(org.id, request.email, 'admin', user.uid)
      await setDemoRequestStatus(request.id, 'approved', user.uid, org.id)
      await refresh()
      onOrgCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start that demo.')
    } finally {
      setBusy(null)
    }
  }

  async function mark(request: DemoRequest, status: DemoRequest['status']) {
    if (!user) return
    setBusy(request.id)
    try {
      await setDemoRequestStatus(request.id, status, user.uid)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const all = requests ?? []
  // Declined requests are the only ones that drop out of the default view. A
  // school whose demo has started is still a live conversation, and hiding it
  // the instant the button is pressed takes away the outcome of the very
  // action just taken. Delete is how a row leaves for good.
  const open = all.filter((r) => r.status !== 'declined')
  const waiting = all.filter((r) => r.status === 'new' || r.status === 'contacted')
  const shown = showHandled ? all : open

  return (
    <section className="card card-pad stack gap-3" style={{ marginBottom: 24, maxWidth: 760 }}>
      <div className="row gap-2" style={{ alignItems: 'baseline' }}>
        <h2 className="grow" style={{ margin: 0 }}>
          Demo requests
        </h2>
        {waiting.length > 0 && <span className="badge badge-accent">{waiting.length} waiting</span>}
      </div>
      <p className="small muted" style={{ marginTop: -8 }}>
        Schools that filled in the form on the public site. Starting a demo creates the
        organisation on a {DEMO_SEATS}-student plan and invites them in as its admin.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {requests === null ? (
        <p className="small muted">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="empty" style={{ border: 'none' }}>
          {all.length === 0 ? 'No school has asked for a demo yet.' : 'Nothing waiting.'}
        </div>
      ) : (
        <div className="stack gap-3">
          {shown.map((request) => (
            <div
              key={request.id}
              className="stack gap-2"
              style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}
            >
              <div className="row gap-2 wrap" style={{ alignItems: 'baseline' }}>
                <strong className="grow">{request.organisation}</strong>
                <span className={`badge ${request.status === 'approved' ? 'badge-good' : 'badge-accent'}`}>
                  {request.status}
                </span>
                <span className="tiny muted">
                  {new Date(request.createdAt).toLocaleDateString('en-AU')}
                </span>
              </div>
              <div className="small">
                {request.contactName}
                {request.role && <span className="muted"> · {request.role}</span>} ·{' '}
                <a href={`mailto:${request.email}`}>{request.email}</a>
                {request.students && <span className="muted"> · {request.students} students</span>}
              </div>
              {request.message && <p className="small muted">{request.message}</p>}
              <div className="row gap-2 wrap">
                {request.orgId ? (
                  <Link className="btn btn-sm" to={`/organisations/${request.orgId}`}>
                    Open their organisation
                  </Link>
                ) : (
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy === request.id}
                    onClick={() => void startDemo(request)}
                  >
                    {busy === request.id ? 'Starting…' : 'Start demo'}
                  </button>
                )}
                {request.status === 'new' && (
                  <button
                    className="btn btn-sm"
                    disabled={busy === request.id}
                    onClick={() => void mark(request, 'contacted')}
                  >
                    Mark contacted
                  </button>
                )}
                {request.status !== 'declined' && !request.orgId && (
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={busy === request.id}
                    onClick={() => void mark(request, 'declined')}
                  >
                    Decline
                  </button>
                )}
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={busy === request.id}
                  onClick={() => {
                    if (confirm(`Delete the request from ${request.organisation}?`)) {
                      void deleteDemoRequest(request.id).then(refresh)
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {all.length > open.length && (
        <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowHandled((v) => !v)}>
          {showHandled ? 'Show only what needs attention' : `Show all ${all.length}`}
        </button>
      )}
    </section>
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
        Locked, the public site becomes a coming-soon page and nobody can reach the app at
        all — not students, not schools, not staff. You keep full access while signed in as a
        site admin, since otherwise locking the site would lock out the only person who can
        unlock it.
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


/**
 * The words on the public site, editable without a deploy.
 *
 * These are the things most likely to want changing on a Tuesday afternoon —
 * a headline that isn't landing, a notice about a maintenance window — and
 * none of them are worth a release. Anything structural still lives in the
 * source.
 */
function SiteContentEditor() {
  const [config, setConfig] = useState(DEFAULT_SITE_CONFIG)
  const [draft, setDraft] = useState<SiteContent | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => subscribeSiteConfig(setConfig), [])

  // Only adopt what's live until the admin starts typing — otherwise a
  // snapshot landing mid-edit would wipe what they were writing.
  const value = draft ?? config.content
  const edit = (patch: Partial<SiteContent>) => {
    setSaved(false)
    setDraft({ ...value, ...patch })
  }

  return (
    <section className="card card-pad stack gap-3" style={{ marginBottom: 24, maxWidth: 620 }}>
      <div>
        <h2 style={{ margin: 0 }}>Public site</h2>
        <p className="small muted" style={{ marginTop: 6 }}>
          What people see at {rootDomain()} before they sign in. Saved changes appear
          immediately — there is no deploy.
        </p>
      </div>

      <div className="field">
        <label htmlFor="scBanner">Notice bar</label>
        <input
          id="scBanner"
          className="input"
          placeholder="Leave blank for none"
          value={value.banner}
          onChange={(e) => edit({ banner: e.target.value })}
        />
        <p className="small muted" style={{ marginTop: 6 }}>
          Shown across the top of every page, signed in or not. Use it for outages and term
          dates, and clear it when it stops being true.
        </p>
      </div>

      <div className="field">
        <label htmlFor="scTitle">Headline</label>
        <input
          id="scTitle"
          className="input"
          value={value.heroTitle}
          onChange={(e) => edit({ heroTitle: e.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor="scBody">Opening paragraph</label>
        <textarea
          id="scBody"
          className="input"
          rows={4}
          value={value.heroBody}
          onChange={(e) => edit({ heroBody: e.target.value })}
        />
      </div>

      <div className="field" style={{ maxWidth: 260 }}>
        <label htmlFor="scCta">Main button</label>
        <input
          id="scCta"
          className="input"
          value={value.ctaLabel}
          onChange={(e) => edit({ ctaLabel: e.target.value })}
        />
      </div>

      <div className="row gap-2">
        <button
          className="btn btn-primary"
          disabled={busy || draft === null}
          onClick={async () => {
            if (!draft) return
            setBusy(true)
            try {
              await setSiteContent(draft)
              setDraft(null)
              setSaved(true)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {draft !== null && (
          <button className="btn btn-ghost" onClick={() => setDraft(null)} disabled={busy}>
            Discard
          </button>
        )}
        {saved && <span className="small muted" style={{ alignSelf: 'center' }}>Saved.</span>}
      </div>
    </section>
  )
}
