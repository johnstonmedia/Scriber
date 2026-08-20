import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  addStudentToClass,
  createClass,
  deleteClass,
  deleteOrgPaper,
  getOrganisation,
  inviteMember,
  listAllClasses,
  listInvites,
  listJoinRequests,
  listMembers,
  listMyClasses,
  listOrgDomains,
  listOrgPapers,
  removeStudentFromClass,
  setClassQuestions,
  uploadOrgPaper,
  type Invite,
  type JoinRequest,
  type Membership,
  type Organisation,
  type OrgClass,
  type OrgDomain,
  type OrgPaper,
  type OrgRole,
} from '../lib/org'
import { canExtractQuestions, extractQuestions } from '../lib/questionExtract'
import { ClassTests } from '../components/ClassTests'
import { OrgAdminDashboard } from './OrgAdminDashboard'

type Tab = 'papers' | 'classes' | 'members' | 'tests'

/**
 * One console, adapted to whoever is looking at it. A student sees their
 * classes and the papers assigned to them. A teacher additionally manages
 * classes, distributes papers, and sees the roster (read-only). An admin is
 * routed to a wholly separate dashboard (OrgAdminDashboard) built for
 * running the organisation itself, not for practising in it.
 */
export function OrganisationConsole() {
  const { orgId } = useParams<{ orgId: string }>()
  const { user, memberships, siteAdmin, refreshMemberships } = useAuth()
  const navigate = useNavigate()

  const membership = memberships.find((m) => m.orgId === orgId)
  // A site admin can step into any organisation as its admin, even without
  // ever having joined it — firestore.rules grants this the same way.
  const actingAsSiteAdmin = !membership && siteAdmin
  const role: OrgRole | null = membership?.role ?? (siteAdmin ? 'admin' : null)
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
  const [domains, setDomains] = useState<OrgDomain[]>([])

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
        const [nextInvites, nextRequests, nextDomains] = await Promise.all([
          listInvites(orgId),
          listJoinRequests(orgId),
          listOrgDomains(orgId),
        ])
        setInvites(nextInvites)
        setRequests(nextRequests)
        setDomains(nextDomains)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this organisation.')
    }
  }, [orgId, user, role, isStaff, isAdmin])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!orgId) return null

  if (!membership && !siteAdmin) {
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

  if (isAdmin && org) {
    return (
      <OrgAdminDashboard
        orgId={orgId}
        org={org}
        user={user!}
        actingAsSiteAdmin={!!actingAsSiteAdmin}
        classes={classes}
        myClasses={myClasses}
        papers={papers}
        members={members}
        invites={invites}
        requests={requests}
        domains={domains}
        error={error}
        notice={notice}
        setError={setError}
        setNotice={setNotice}
        refresh={refresh}
        navigate={navigate}
        refreshMemberships={refreshMemberships}
        handleCreateClass={handleCreateClass}
        handleInvite={handleInvite}
        handleUploadPaper={handleUploadPaper}
      />
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{org?.name ?? membership?.orgName ?? 'Organisation'}</h1>
          <p className="muted">{role === 'teacher' ? 'You are a teacher' : 'You are a student'}</p>
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
        <button className={`btn btn-sm ${tab === 'tests' ? 'btn-primary' : ''}`} onClick={() => setTab('tests')}>
          Tests
        </button>
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
                canManage={isStaff && c.teacherIds.includes(user!.uid)}
                currentUid={user!.uid}
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
              <span className="badge">{m.role}</span>
            </div>
          ))}
          {members.length === 0 && <div className="empty" style={{ border: 'none' }}>No other members yet.</div>}
        </div>
      )}

      {tab === 'tests' && (
        <ClassTests orgId={orgId} classes={myClasses} papers={papers} canCreate={isStaff} currentUid={user!.uid} />
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
export function QuestionAssignment({
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

export function ClassCard({
  orgClass,
  orgId,
  members,
  canManage,
  currentUid,
  onChange,
}: {
  orgClass: OrgClass
  orgId: string
  members: Membership[]
  canManage: boolean
  currentUid: string
  onChange: () => void
}) {
  const students = members.filter((m) => orgClass.studentIds.includes(m.uid))
  const available = members.filter((m) => m.role === 'student' && !orgClass.studentIds.includes(m.uid))
  const [inviteNotice, setInviteNotice] = useState<string | null>(null)

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
      {canManage && (
        <form
          className="row gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const form = new FormData(e.currentTarget)
            const email = String(form.get('email') ?? '').trim()
            if (!email) return
            void inviteMember(orgId, email, 'student', currentUid, orgClass.id).then(() => {
              e.currentTarget.reset()
              setInviteNotice(`Invited ${email} — they'll join this class once they sign up and verify their email.`)
            })
          }}
        >
          <input
            className="input grow"
            name="email"
            type="email"
            placeholder="Not on Scriber yet? Invite by email"
            required
          />
          <button className="btn btn-sm btn-primary">Invite</button>
        </form>
      )}
      {inviteNotice && <p className="small muted">{inviteNotice}</p>}
    </article>
  )
}
