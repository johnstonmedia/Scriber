import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  addStudentToClass,
  approveJoinRequest,
  createClass,
  deleteClass,
  deleteOrgPaper,
  denyJoinRequest,
  getOrganisation,
  inviteMember,
  listAllClasses,
  listInvites,
  listJoinRequests,
  listMembers,
  listMyClasses,
  listOrgPapers,
  removeMember,
  removeStudentFromClass,
  resetMemberPassword,
  revokeInvite,
  setClassQuestions,
  updateMemberRole,
  uploadOrgPaper,
  type Invite,
  type JoinRequest,
  type Membership,
  type Organisation,
  type OrgClass,
  type OrgPaper,
  type OrgRole,
} from '../lib/org'
import { canExtractQuestions, extractQuestions } from '../lib/questionExtract'

type Tab = 'papers' | 'classes' | 'members' | 'requests' | 'settings'

/**
 * One console, adapted to whoever is looking at it. A student sees their
 * classes and the papers assigned to them. A teacher additionally manages
 * classes and distributes papers. An admin additionally manages the roster,
 * invites, join requests and the organisation's own settings.
 */
export function OrganisationConsole() {
  const { orgId } = useParams<{ orgId: string }>()
  const { user, memberships, refreshMemberships } = useAuth()
  const navigate = useNavigate()

  const membership = memberships.find((m) => m.orgId === orgId)
  const role: OrgRole | null = membership?.role ?? null
  const isStaff = role === 'teacher' || role === 'admin'
  const isAdmin = role === 'admin'

  const [org, setOrg] = useState<Organisation | null>(null)
  const [tab, setTab] = useState<Tab>('papers')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [classes, setClasses] = useState<OrgClass[]>([])
  const [papers, setPapers] = useState<OrgPaper[]>([])
  const [members, setMembers] = useState<Membership[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [requests, setRequests] = useState<JoinRequest[]>([])

  const refresh = useCallback(async () => {
    if (!orgId || !user || !role) return
    setError(null)
    try {
      const [nextOrg, nextClasses, nextPapers] = await Promise.all([
        getOrganisation(orgId),
        isStaff ? listAllClasses(orgId) : listMyClasses(orgId, user.uid),
        listOrgPapers(orgId),
      ])
      setOrg(nextOrg)
      setClasses(nextClasses)
      setPapers(nextPapers)
      if (isStaff) {
        setMembers(await listMembers(orgId))
      }
      if (isAdmin) {
        const [nextInvites, nextRequests] = await Promise.all([
          listInvites(orgId),
          listJoinRequests(orgId),
        ])
        setInvites(nextInvites)
        setRequests(nextRequests)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this organisation.')
    }
  }, [orgId, user, role, isStaff, isAdmin])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!orgId) return null

  if (!membership) {
    return (
      <div className="page">
        <div className="alert alert-warn">
          You are not a member of this organisation.{' '}
          <Link to="/organisations">Find it in the directory</Link> to request access.
        </div>
      </div>
    )
  }

  const myClasses = isAdmin ? classes : isStaff ? classes.filter((c) => c.teacherIds.includes(user!.uid)) : classes

  async function handleCreateClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!orgId || !user) return
    const formEl = event.currentTarget
    const form = new FormData(formEl)
    const name = String(form.get('name') ?? '').trim()
    if (!name) return
    try {
      await createClass(orgId, name, user.uid)
      formEl.reset()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that class.')
    }
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!orgId || !user) return
    const formEl = event.currentTarget
    const form = new FormData(formEl)
    const email = String(form.get('email') ?? '').trim()
    const inviteRole = String(form.get('role') ?? 'student') as OrgRole
    if (!email) return
    try {
      await inviteMember(orgId, email, inviteRole, user.uid)
      formEl.reset()
      setNotice(`Invited ${email}.`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that invite.')
    }
  }

  async function handleUploadPaper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!orgId || !user) return
    const formEl = event.currentTarget
    const form = new FormData(formEl)
    const file = form.get('file') as File
    if (!file?.size) {
      setError('Choose a file first.')
      return
    }
    try {
      const questions = canExtractQuestions(file.type) ? await extractQuestions(file) : []
      await uploadOrgPaper(orgId, user.uid, file, {
        title: String(form.get('title') || '').trim() || file.name.replace(/\.[^.]+$/, ''),
        subject: String(form.get('subject') || '').trim() || undefined,
        year: Number(form.get('year')) || undefined,
        readingMinutes: Number(form.get('readingMinutes') ?? 10),
        workingMinutes: Number(form.get('workingMinutes') ?? 120),
        classIds: myClasses
          .filter((c) => form.getAll('classIds').includes(c.id))
          .map((c) => c.id),
        questions,
      })
      formEl.reset()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{org?.name ?? membership.orgName}</h1>
          <p className="muted">
            {role === 'admin' ? 'You are the admin' : role === 'teacher' ? 'You are a teacher' : 'You are a student'}
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      {notice && <div className="alert alert-info" style={{ marginBottom: 16 }}>{notice}</div>}

      <div className="row gap-2 wrap" style={{ marginBottom: 22 }}>
        <button className={`btn btn-sm ${tab === 'papers' ? 'btn-primary' : ''}`} onClick={() => setTab('papers')}>
          Papers
        </button>
        <button className={`btn btn-sm ${tab === 'classes' ? 'btn-primary' : ''}`} onClick={() => setTab('classes')}>
          Classes
        </button>
        {isStaff && (
          <button className={`btn btn-sm ${tab === 'members' ? 'btn-primary' : ''}`} onClick={() => setTab('members')}>
            Members
          </button>
        )}
        {isAdmin && (
          <>
            <button
              className={`btn btn-sm ${tab === 'requests' ? 'btn-primary' : ''}`}
              onClick={() => setTab('requests')}
            >
              Requests{requests.length > 0 ? ` (${requests.length})` : ''}
            </button>
            <button
              className={`btn btn-sm ${tab === 'settings' ? 'btn-primary' : ''}`}
              onClick={() => setTab('settings')}
            >
              Settings
            </button>
          </>
        )}
      </div>

      {tab === 'papers' && (
        <div className="stack gap-4">
          {isStaff && (
            <form className="card card-pad stack gap-3" onSubmit={handleUploadPaper}>
              <h2>Distribute a paper</h2>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                <div className="field">
                  <label htmlFor="opFile">File (PDF, image or text)</label>
                  <input id="opFile" name="file" type="file" className="input" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" required />
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
          )}

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
                    {isStaff && (
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => void deleteOrgPaper(orgId, p).then(refresh)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  {isStaff && (
                    <QuestionAssignment paper={p} orgId={orgId} classes={myClasses} onChange={refresh} />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'classes' && (
        <div className="stack gap-4">
          {isStaff && (
            <form className="card card-pad row gap-2" onSubmit={handleCreateClass}>
              <input name="name" className="input" placeholder="Year 12 English Advanced" required />
              <button className="btn btn-primary">Create class</button>
            </form>
          )}
          <div className="grid grid-cards">
            {classes.map((c) => (
              <ClassCard
                key={c.id}
                orgClass={c}
                orgId={orgId}
                members={members}
                canManage={isAdmin || (isStaff && c.teacherIds.includes(user!.uid))}
                onChange={refresh}
              />
            ))}
          </div>
          {classes.length === 0 && <div className="empty">No classes yet.</div>}
        </div>
      )}

      {isStaff && tab === 'members' && (
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
              {isAdmin ? (
                <select
                  className="input"
                  style={{ maxWidth: 140 }}
                  value={m.role}
                  onChange={(e) =>
                    void updateMemberRole(orgId, m.uid, e.target.value as OrgRole).then(refresh)
                  }
                >
                  <option value="student">Student</option>
                  <option value="teacher">Teacher</option>
                  <option value="admin">Admin</option>
                </select>
              ) : (
                <span className="badge">{m.role}</span>
              )}
              {isAdmin && (
                <>
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
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => void removeMember(orgId, m.uid).then(refresh)}
                  >
                    Remove
                  </button>
                </>
              )}
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
            {invites.filter((i) => i.status === 'pending').length > 0 && (
              <div className="stack gap-2" style={{ marginTop: 14 }}>
                {invites
                  .filter((i) => i.status === 'pending')
                  .map((invite) => (
                    <div className="row gap-2" key={invite.email}>
                      <span className="grow small">{invite.email} — invited as {invite.role}</span>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => void revokeInvite(orgId, invite.email).then(refresh)}
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {isAdmin && tab === 'requests' && (
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
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => void approveJoinRequest(orgId, r).then(refresh)}
                >
                  Approve
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => void denyJoinRequest(orgId, r.uid).then(refresh)}
                >
                  Deny
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {isAdmin && tab === 'settings' && org && (
        <div className="card card-pad stack gap-3" style={{ maxWidth: 480 }}>
          <h2>{org.name}</h2>
          <p className="small muted">
            Created {new Date(org.createdAt).toLocaleDateString('en-AU')}
          </p>
          <button
            className="btn btn-danger"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => {
              if (confirm(`Leave "${org.name}"? If you are the only admin, nobody else can manage it.`)) {
                void removeMember(orgId, user!.uid).then(() => {
                  void refreshMemberships()
                  navigate('/organisations')
                })
              }
            }}
          >
            Leave organisation
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Lets a teacher/admin send a specific subset of a paper's extracted
 * questions to one class and a different subset to another. A class left
 * unchecked for every question keeps seeing the whole paper, unchanged from
 * before this existed — assigning a subset is opt-in per class.
 */
function QuestionAssignment({
  paper,
  orgId,
  classes,
  onChange,
}: {
  paper: OrgPaper
  orgId: string
  classes: OrgClass[]
  onChange: () => void
}) {
  const [open, setOpen] = useState(false)
  if (paper.questions.length < 2) return null

  return (
    <div className="stack gap-2">
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen((v) => !v)} style={{ alignSelf: 'flex-start' }}>
        {open ? 'Hide' : 'Assign'} questions to classes ({paper.questions.length} extracted)
      </button>
      {open && (
        <div className="stack gap-3" style={{ padding: '4px 0 10px' }}>
          {classes.length === 0 && (
            <div className="small muted">Create a class first to assign specific questions to it.</div>
          )}
          {classes.map((c) => {
            const assigned = new Set(paper.classQuestions[c.id] ?? [])
            return (
              <div key={c.id} className="stack gap-1">
                <strong className="small">{c.name}</strong>
                <div className="row gap-3 wrap">
                  {paper.questions.map((q) => (
                    <label key={q.id} className="row gap-1 small" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={assigned.has(q.id)}
                        onChange={(e) => {
                          const next = new Set(assigned)
                          if (e.target.checked) next.add(q.id)
                          else next.delete(q.id)
                          void setClassQuestions(orgId, paper.id, c.id, [...next]).then(onChange)
                        }}
                      />
                      Q{q.index}
                    </label>
                  ))}
                </div>
                {assigned.size === 0 && <span className="small muted">Whole paper — no subset assigned.</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ClassCard({
  orgClass,
  orgId,
  members,
  canManage,
  onChange,
}: {
  orgClass: OrgClass
  orgId: string
  members: Membership[]
  canManage: boolean
  onChange: () => void
}) {
  const students = members.filter((m) => orgClass.studentIds.includes(m.uid))
  const available = members.filter((m) => m.role === 'student' && !orgClass.studentIds.includes(m.uid))

  return (
    <article className="card card-pad stack gap-3">
      <div className="row gap-2">
        <h3 className="grow">{orgClass.name}</h3>
        {canManage && (
          <button
            className="btn btn-sm btn-danger"
            onClick={() => void deleteClass(orgId, orgClass.id).then(onChange)}
          >
            Delete
          </button>
        )}
      </div>
      <div className="small muted">{students.length} student{students.length === 1 ? '' : 's'}</div>
      {students.map((s) => (
        <div className="row gap-2" key={s.uid}>
          <span className="grow small">{s.name}</span>
          {canManage && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => void removeStudentFromClass(orgId, orgClass.id, s.uid).then(onChange)}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {canManage && available.length > 0 && (
        <select
          className="input"
          value=""
          onChange={(e) => {
            if (e.target.value) void addStudentToClass(orgId, orgClass.id, e.target.value).then(onChange)
          }}
        >
          <option value="">Add a student…</option>
          {available.map((m) => (
            <option key={m.uid} value={m.uid}>
              {m.name}
            </option>
          ))}
        </select>
      )}
    </article>
  )
}
