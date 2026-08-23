import { useState, type FormEvent } from 'react'
import { Link, type NavigateFunction } from 'react-router-dom'
import {
  addOrgDomain,
  approveJoinRequest,
  denyJoinRequest,
  removeMember,
  removeOrgDomain,
  resetMemberPassword,
  revokeInvite,
  updateMemberRole,
  setOrgSlug,
  updateOrganisation,
  compressLogo,
  type Invite,
  type JoinRequest,
  type Membership,
  type Organisation,
  type OrgClass,
  type OrgDomain,
  type OrgPaper,
  type OrgRole,
} from '../lib/org'
import { ClassTests } from '../components/ClassTests'
import { ClassCard, QuestionAssignment } from './OrganisationConsole'
import { ErrorNotice } from '../components/ErrorNotice'
import { SeatMeter } from '../components/SeatMeter'
import { appError, type AppError } from '../lib/errors'

type Section =
  | 'overview'
  | 'roster'
  | 'classes'
  | 'papers'
  | 'tests'
  | 'requests'
  | 'domains'
  | 'settings'
  | 'integrations'

type Props = {
  orgId: string
  org: Organisation
  user: { uid: string; email: string; name: string }
  actingAsSiteAdmin: boolean
  classes: OrgClass[]
  myClasses: OrgClass[]
  papers: OrgPaper[]
  members: Membership[]
  invites: Invite[]
  requests: JoinRequest[]
  domains: OrgDomain[]
  error: string | null
  notice: string | null
  setError: (message: string | null) => void
  setNotice: (message: string | null) => void
  refresh: () => Promise<void>
  navigate: NavigateFunction
  refreshMemberships: () => Promise<void>
  handleCreateClass: (event: FormEvent<HTMLFormElement>) => void
  handleInvite: (event: FormEvent<HTMLFormElement>) => void
  handleUploadPaper: (event: FormEvent<HTMLFormElement>) => void
}

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'roster', label: 'Roster' },
  { id: 'classes', label: 'Classes' },
  { id: 'papers', label: 'Papers' },
  { id: 'tests', label: 'Tests' },
  { id: 'requests', label: 'Requests' },
  { id: 'domains', label: 'Auto-join domains' },
  { id: 'settings', label: 'Settings' },
  { id: 'integrations', label: 'Integrations' },
]

/**
 * The organisation admin's own console — deliberately not the same view a
 * teacher or student gets. It's built for running the school on Scriber:
 * roster and invites, class setup, the paper library, join requests, the
 * domains that auto-join new accounts, the org's own settings, and (stubbed
 * for now) LMS/SSO integrations.
 */
export function OrgAdminDashboard(props: Props) {
  const {
    orgId,
    org,
    user,
    actingAsSiteAdmin,
    classes,
    myClasses,
    papers,
    members,
    invites,
    requests,
    domains,
    error,
    notice,
    setError,
    setNotice,
    refresh,
    handleCreateClass,
    handleInvite,
    handleUploadPaper,
  } = props

  const [section, setSection] = useState<Section>('overview')
  const pendingInvites = invites.filter((i) => i.status === 'pending')
  const studentCount = members.filter((m) => m.role === 'student').length
  const teacherCount = members.filter((m) => m.role === 'teacher').length
  const adminCount = members.filter((m) => m.role === 'admin').length

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div className="grow">
          <h1>{org.name}</h1>
          <p className="muted">{actingAsSiteAdmin ? 'You are viewing as site admin' : 'Admin dashboard'}</p>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      {notice && <div className="alert alert-info" style={{ marginBottom: 16 }}>{notice}</div>}

      <div className="admin-layout">
        <nav className="admin-sidebar">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`nav-link ${section === s.id ? 'active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
              {s.id === 'requests' && requests.length > 0 ? ` (${requests.length})` : ''}
            </button>
          ))}
        </nav>

        <div className="admin-content">
          {section === 'overview' && (
            <div className="stack gap-4">
              <div className="stat-grid">
                <div className="stat">
                  <div className="value">{studentCount}</div>
                  <div className="label">Students</div>
                </div>
                <div className="stat">
                  <div className="value">{teacherCount}</div>
                  <div className="label">Teachers</div>
                </div>
                <div className="stat">
                  <div className="value">{adminCount}</div>
                  <div className="label">Admins</div>
                </div>
                <div className="stat">
                  <div className="value">{classes.length}</div>
                  <div className="label">Classes</div>
                </div>
                <div className="stat">
                  <div className="value">{papers.length}</div>
                  <div className="label">Papers distributed</div>
                </div>
                <div className="stat">
                  <div className="value">{requests.length}</div>
                  <div className="label">Pending requests</div>
                </div>
                <div className="stat">
                  <div className="value">{pendingInvites.length}</div>
                  <div className="label">Pending invites</div>
                </div>
                <div className="stat">
                  <div className="value">{domains.length}</div>
                  <div className="label">Auto-join domains</div>
                </div>
              </div>
              <SeatMeter plan={org.plan} members={members} invites={invites} />
              {requests.length > 0 && (
                <div className="insight insight-watch">
                  {requests.length} join request{requests.length === 1 ? '' : 's'} waiting —{' '}
                  <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => setSection('requests')}>
                    Review
                  </button>
                </div>
              )}
            </div>
          )}

          {section === 'roster' && (
            <>
            <SeatMeter plan={org.plan} members={members} invites={invites} />
            <div className="card">
              {members.map((m, i) => (
                <div
                  key={m.uid}
                  className="row gap-3 wrap"
                  style={{ padding: '14px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
                >
                  <div className="grow">
                    <strong>{m.name}</strong>
                    <div className="small muted">{m.email}</div>
                  </div>
                  <select
                    className="input"
                    style={{ maxWidth: 140 }}
                    value={m.role}
                    onChange={(e) => void updateMemberRole(orgId, m.uid, e.target.value as OrgRole).then(refresh)}
                  >
                    <option value="student">Student</option>
                    <option value="teacher">Teacher</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      resetMemberPassword(m.email)
                        .then(() => setNotice(`Password reset email sent to ${m.email}.`))
                        .catch((err) => setError(err instanceof Error ? err.message : 'Could not send reset email.'))
                    }
                  >
                    Reset password
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => void removeMember(orgId, m.uid).then(refresh)}>
                    Remove
                  </button>
                </div>
              ))}

              <div style={{ padding: '18px', borderTop: members.length > 0 ? '1px solid var(--line)' : 'none' }}>
                <form className="row gap-2 wrap" onSubmit={handleInvite}>
                  <input name="email" type="email" className="input" placeholder="Invite by email" required style={{ maxWidth: 260 }} />
                  <select name="role" className="input" style={{ maxWidth: 140 }} defaultValue="student">
                    <option value="student">Student</option>
                    <option value="teacher">Teacher</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button className="btn btn-primary">Invite</button>
                </form>
                {pendingInvites.length > 0 && (
                  <div className="stack gap-2" style={{ marginTop: 14 }}>
                    {pendingInvites.map((invite) => (
                      <div className="row gap-2" key={invite.email}>
                        <span className="grow small">{invite.email} — invited as {invite.role}</span>
                        <button className="btn btn-sm btn-ghost" onClick={() => void revokeInvite(orgId, invite.email).then(refresh)}>
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            </>
          )}

          {section === 'classes' && (
            <div className="stack gap-4">
              <form className="card card-pad row gap-2" onSubmit={handleCreateClass}>
                <input name="name" className="input" placeholder="Year 12 English Advanced" required />
                <button className="btn btn-primary">Create class</button>
              </form>
              <div className="grid grid-cards">
                {classes.map((c) => (
                  <ClassCard
                    key={c.id}
                    orgClass={c}
                    orgId={orgId}
                    members={members}
                    canManage
                    currentUid={user.uid}
                    onChange={refresh}
                  />
                ))}
              </div>
              {classes.length === 0 && <div className="empty">No classes yet.</div>}
            </div>
          )}

          {section === 'papers' && (
            <div className="stack gap-4">
              <form className="card card-pad stack gap-3" onSubmit={handleUploadPaper}>
                <h2>Distribute a paper</h2>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                  <div className="field">
                    <label htmlFor="opFile">File (PDF or text)</label>
                    <input id="opFile" name="file" type="file" className="input" accept=".pdf,.txt" required />
                  </div>
                  <div className="field">
                    <label htmlFor="opTitle">Title</label>
                    <input id="opTitle" name="title" className="input" placeholder="2023 English Advanced Paper 1" />
                  </div>
                  <div className="field">
                    <label htmlFor="opSubject">Subject</label>
                    <input id="opSubject" name="subject" className="input" />
                  </div>
                  <div className="field">
                    <label htmlFor="opYear">Year</label>
                    <input id="opYear" name="year" type="number" className="input" />
                  </div>
                  <div className="field">
                    <label htmlFor="opReading">Reading time (min)</label>
                    <input id="opReading" name="readingMinutes" type="number" className="input" defaultValue={10} />
                  </div>
                  <div className="field">
                    <label htmlFor="opWorking">Working time (min)</label>
                    <input id="opWorking" name="workingMinutes" type="number" className="input" defaultValue={120} />
                  </div>
                </div>
                {myClasses.length > 0 && (
                  <div className="field">
                    <label>Assign to (leave blank for the whole organisation)</label>
                    <div className="row gap-3 wrap">
                      {myClasses.map((c) => (
                        <label key={c.id} className="row gap-2" style={{ cursor: 'pointer' }}>
                          <input type="checkbox" name="classIds" value={c.id} />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
                  Distribute
                </button>
              </form>

              <div className="card">
                {papers.length === 0 ? (
                  <div className="empty" style={{ border: 'none' }}>No papers distributed yet.</div>
                ) : (
                  papers.map((p, i) => (
                    <div
                      key={p.id}
                      className="stack gap-2"
                      style={{ padding: '14px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
                    >
                      <div className="row gap-3 wrap">
                        <div className="grow">
                          <strong>{p.title}</strong>
                          <div className="small muted">
                            {[p.subject, p.year].filter(Boolean).join(' · ') || 'No subject set'} ·{' '}
                            {p.readingMinutes} min reading · {p.workingMinutes} min working
                          </div>
                        </div>
                        <Link className="btn btn-sm btn-primary" to={`/exam?org=${orgId}&paper=${p.id}`}>
                          Start practice
                        </Link>
                      </div>
                      <QuestionAssignment paper={p} orgId={orgId} classes={myClasses} onChange={refresh} />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {section === 'tests' && (
            <ClassTests orgId={orgId} classes={myClasses} papers={papers} canCreate currentUid={user.uid} onPapersChanged={refresh} />
          )}

          {section === 'requests' && (
            <div className="card">
              {requests.length === 0 ? (
                <div className="empty" style={{ border: 'none' }}>No pending requests.</div>
              ) : (
                requests.map((r, i) => (
                  <div
                    key={r.uid}
                    className="row gap-3"
                    style={{ padding: '14px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
                  >
                    <div className="grow">
                      <strong>{r.name}</strong>
                      <div className="small muted">{r.email}</div>
                    </div>
                    <button className="btn btn-sm btn-primary" onClick={() => void approveJoinRequest(orgId, r).then(refresh)}>
                      Approve
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => void denyJoinRequest(orgId, r.uid).then(refresh)}>
                      Deny
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {section === 'domains' && (
            <div className="card card-pad stack gap-3" style={{ maxWidth: 480 }}>
              <h2>Auto-join domains</h2>
              <p className="small muted" style={{ marginTop: -8 }}>
                Anyone who verifies an email on one of these domains joins {org.name} automatically, as a
                student — no invite or approval needed. Add every domain your school uses, including separate
                student and staff domains.
              </p>
              <form
                className="row gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  const form = new FormData(e.currentTarget)
                  const domain = String(form.get('domain') ?? '').trim().toLowerCase()
                  if (!domain) return
                  void addOrgDomain(orgId, org.name, domain, user.uid).then(() => {
                    e.currentTarget.reset()
                    void refresh()
                  })
                }}
              >
                <input
                  className="input grow"
                  name="domain"
                  placeholder="student.northside.nsw.edu.au"
                  required
                  pattern="[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
                />
                <button className="btn btn-primary">Add</button>
              </form>
              {domains.length > 0 && (
                <div className="stack gap-2">
                  {domains.map((d) => (
                    <div className="row gap-2" key={d.domain}>
                      <span className="grow small mono">{d.domain}</span>
                      <button className="btn btn-sm btn-ghost" onClick={() => void removeOrgDomain(d.domain).then(refresh)}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === 'settings' && <OrgSettings {...props} />}

          {section === 'integrations' && <Integrations />}
        </div>
      </div>
    </div>
  )
}

/**
 * Editable org-wide settings: display name, default rule profile new papers
 * suggest, and whether the directory accepts join requests at all. Leaving
 * (or, for a site admin looking in, a pointer to the real deletion tool) is
 * folded in here too, as the natural "danger zone."
 */
function OrgSettings({ orgId, org, user, actingAsSiteAdmin, navigate, refresh, refreshMemberships }: Props) {
  const [name, setName] = useState(org.name)
  const [ruleProfile, setRuleProfile] = useState(org.settings.defaultRuleProfile)
  const [allowJoinRequests, setAllowJoinRequests] = useState(org.settings.allowJoinRequests)
  const [identifyBy, setIdentifyBy] = useState(org.settings.identifyBy)
  const [slug, setSlug] = useState(org.slug ?? '')
  const [slugError, setSlugError] = useState<string | null>(null)
  const [accentColor, setAccentColor] = useState(org.branding.accentColor)
  const [tagline, setTagline] = useState(org.branding.tagline)
  const [logoDataUrl, setLogoDataUrl] = useState(org.branding.logoDataUrl)
  const [logoError, setLogoError] = useState<AppError | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    setSlugError(null)
    try {
      // The subdomain is claimed separately because uniqueness lives in its
      // own collection — and if somebody else already holds it, the rest of
      // the settings should still save rather than being lost to the error.
      const wanted = slug.trim() ? slug.trim() : null
      if (wanted !== (org.slug ?? null)) {
        try {
          const claimed = await setOrgSlug(orgId, wanted)
          setSlug(claimed ?? '')
        } catch (err) {
          setSlugError(err instanceof Error ? err.message : 'Could not claim that address.')
        }
      }
      await updateOrganisation(orgId, {
        name,
        settings: { defaultRuleProfile: ruleProfile, allowJoinRequests, identifyBy },
        branding: { accentColor, tagline, logoDataUrl },
      })
      await refresh()
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stack gap-4">
      <form className="card card-pad stack gap-3" style={{ maxWidth: 480 }} onSubmit={save}>
        <h2>Organisation settings</h2>
        <div className="field">
          <label htmlFor="orgName">Name</label>
          <input id="orgName" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="orgRuleProfile">Default rule profile for new papers</label>
          <select
            id="orgRuleProfile"
            className="input"
            value={ruleProfile}
            onChange={(e) => setRuleProfile(e.target.value as 'strict' | 'assisted')}
          >
            <option value="strict">Strict</option>
            <option value="assisted">Assisted</option>
          </select>
        </div>
        <label className="row gap-2" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={allowJoinRequests}
            onChange={(e) => setAllowJoinRequests(e.target.checked)}
          />
          List {org.name} in the directory and accept join requests
        </label>

        <hr className="divider" />

        <div className="field">
          <label htmlFor="orgSlug">Web address</label>
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <input
              id="orgSlug"
              className="input"
              value={slug}
              placeholder="stpauls"
              onChange={(e) => setSlug(e.target.value)}
              style={{ maxWidth: 200 }}
            />
            <span className="small muted">.pracscriber.com</span>
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            Your own address. Staff and students who belong to {org.name} are taken here
            automatically; anyone who doesn't is sent back to the main site. Leave it blank to
            use the main site only.
          </p>
          {slugError && (
            <p className="small" style={{ color: 'var(--live)' }}>
              {slugError}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="orgIdentifyBy">Printed answers are headed with</label>
          <select
            id="orgIdentifyBy"
            className="input"
            value={identifyBy}
            onChange={(e) => setIdentifyBy(e.target.value as 'examNumber' | 'name')}
          >
            <option value="examNumber">Exam number — marked anonymously</option>
            <option value="name">Student name — for younger years</option>
          </select>
          <p className="small muted" style={{ marginTop: 6 }}>
            An exam number lets a marker work through a stack of papers without knowing whose
            is whose. Students without a number assigned fall back to their name, so nothing
            prints unidentified.
          </p>
        </div>

        <hr className="divider" />

        <div>
          <h3 style={{ margin: 0 }}>Branding</h3>
          <p className="small muted" style={{ marginTop: 4 }}>
            Shown to your students on this page and while they sit a test.
          </p>
        </div>
        <div className="field">
          <label htmlFor="orgTagline">Tagline</label>
          <input
            id="orgTagline"
            className="input"
            value={tagline}
            placeholder="Excellence in every voice"
            onChange={(e) => setTagline(e.target.value)}
          />
        </div>
        <div className="field" style={{ maxWidth: 200 }}>
          <label htmlFor="orgAccent">Accent colour</label>
          <input
            id="orgAccent"
            type="color"
            className="input"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="orgLogo">Logo</label>
          <div className="row gap-3 wrap">
            {logoDataUrl && <img src={logoDataUrl} alt="" style={{ height: 44 }} />}
            <input
              id="orgLogo"
              type="file"
              className="input grow"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                setLogoError(null)
                try {
                  setLogoDataUrl(await compressLogo(file))
                } catch (err) {
                  setLogoError(appError('SCR-310', err))
                }
              }}
            />
            {logoDataUrl && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLogoDataUrl(null)}>
                Remove
              </button>
            )}
          </div>
          <span className="tiny muted">
            Shrunk to a small thumbnail and stored with the organisation — keep it simple.
          </span>
        </div>
        <ErrorNotice error={logoError} onDismiss={() => setLogoError(null)} />

        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <p className="small muted">Saved.</p>}
      </form>

      <div className="card card-pad stack gap-3" style={{ maxWidth: 480 }}>
        <h2>Danger zone</h2>
        <p className="small muted">Created {new Date(org.createdAt).toLocaleDateString('en-AU')}</p>
        {actingAsSiteAdmin ? (
          <p className="small muted">
            You're viewing this as site admin, not a member — there's nothing here to leave. Delete this
            organisation from the <Link to="/admin">Site admin</Link> page.
          </p>
        ) : (
          <button
            className="btn btn-danger"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => {
              if (confirm(`Leave "${org.name}"? If you are the only admin, nobody else can manage it.`)) {
                void removeMember(orgId, user.uid).then(() => {
                  void refreshMemberships()
                  navigate('/organisations')
                })
              }
            }}
          >
            Leave organisation
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * LTI 1.3 (and similar SSO/rostering) needs a signed JWKS endpoint and an
 * OAuth2 token exchange — real backend compute that this static-hosted app
 * doesn't have yet. This stands in for that until it's built, so the admin
 * dashboard has a real place for it rather than nothing at all.
 */
function Integrations() {
  return (
    <div className="stack gap-4">
      <div className="card card-pad stack gap-3" style={{ maxWidth: 640 }}>
        <h2>LMS &amp; single sign-on</h2>
        <p className="small muted">
          Coming soon: connect Scriber as an LTI 1.3 tool in Canvas, Schoolbox, Moodle or any other
          LMS your school already uses, so a class roster and its assignments show up here without a
          separate invite step. Google Classroom and Microsoft Entra ID / Teams sign-in are on the
          same list.
        </p>
        <p className="small muted">
          This needs a small amount of backend beyond what static hosting can serve on its own — a
          signed key endpoint and a token exchange — so it's being built as its own piece of work.
          Domain auto-join and teacher-issued invites (see Roster and Auto-join domains) cover
          getting a class onto Scriber in the meantime.
        </p>
      </div>
    </div>
  )
}
