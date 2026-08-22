import { useEffect, useState } from 'react'
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { useHostRedirect } from './lib/useHostRedirect'
import { hostKind, type HostOrg } from './lib/hostOrg'
import { Home } from './pages/Home'
import { SignIn } from './pages/SignIn'
import { Welcome } from './pages/Welcome'
import { VerifyGate } from './pages/VerifyGate'
import { Dashboard } from './pages/Dashboard'
import { ExamRoom } from './pages/ExamRoom'
import { SessionReview } from './pages/SessionReview'
import { Settings } from './pages/Settings'
import { Organisations } from './pages/Organisations'
import { OrganisationConsole } from './pages/OrganisationConsole'
import { TestMonitor } from './pages/TestMonitor'
import { SiteAdmin } from './pages/SiteAdmin'
import { ComingSoon } from './pages/ComingSoon'
import { DEFAULT_SITE_CONFIG, subscribeSiteConfig } from './lib/siteConfig'
import { BrandLockup } from './components/BrandMark'

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('scriber-theme') as 'light' | 'dark') ?? 'light',
  )
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('scriber-theme', theme)
  }, [theme])
  return { theme, toggle: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')) }
}

/**
 * On a school's own subdomain the bar carries both marks: the school's,
 * because this address is theirs, and Scriber's, because the tool is not.
 * A student should never be unclear about which they are looking at, and a
 * school should never look like it built this.
 */
function TopBar({ host }: { host: HostOrg | null }) {
  const { user, memberships, pendingInvites, siteAdmin, signOut } = useAuth()
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()

  return (
    <header
      className="topbar no-print"
      style={host ? { borderBottomColor: host.branding.accentColor } : undefined}
    >
      {host && (
        <span className="host-brand">
          {host.branding.logoDataUrl && <img src={host.branding.logoDataUrl} alt="" />}
          <span className="host-brand-name">{host.name}</span>
          <span className="host-brand-sep" aria-hidden="true" />
        </span>
      )}
      <NavLink to="/" className="brand">
        <BrandLockup />
      </NavLink>

      <nav className="row gap-1">
        <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          Papers
        </NavLink>
        <NavLink
          to="/organisations"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          Organisations
          {pendingInvites.length > 0 && <span className="nav-dot" aria-label="Pending invite" />}
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          Settings
        </NavLink>
        {siteAdmin && (
          <NavLink to="/admin" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            Site admin
          </NavLink>
        )}
      </nav>

      {memberships.length > 0 && (
        <select
          className="input org-switcher"
          onChange={(e) => e.target.value && navigate(`/organisations/${e.target.value}`)}
          value=""
          aria-label="Jump to an organisation"
        >
          <option value="">Your organisations…</option>
          {memberships.map((m) => (
            <option key={m.orgId} value={m.orgId}>
              {m.role === 'admin' ? '★ ' : ''}
              {m.orgName || m.orgId}
            </option>
          ))}
        </select>
      )}

      <div className="spacer" />

      <button className="btn btn-sm btn-ghost" onClick={toggle} aria-label="Switch theme">
        {theme === 'light' ? '🌙' : '☀️'}
      </button>
      <span className="small muted">{user?.name}</span>
      <button className="btn btn-sm" onClick={() => void signOut()}>
        Sign out
      </button>
    </header>
  )
}

function Shell() {
  const { user, loading, onboarded, pendingInvites, siteAdmin } = useAuth()
  const location = useLocation()
  const [siteConfig, setSiteConfig] = useState(DEFAULT_SITE_CONFIG)
  const host = useHostRedirect()
  const kind = hostKind()

  useEffect(() => subscribeSiteConfig(setSiteConfig), [])

  // Mid-hop to another subdomain. Saying where they're going matters: the
  // address bar is about to change to one they may not recognise.
  if (host.leavingFor) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }} className="muted">
        Taking you to {host.leavingFor}…
      </div>
    )
  }

  if (loading || host.org === undefined) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }} className="muted">
        Loading Scriber…
      </div>
    )
  }

  // Locked, nobody but a signed-in site admin gets past the holding page —
  // and they work on it exactly as normal, since otherwise locking the site
  // would lock out the only person who can unlock it. /login stays reachable
  // so there is still a way in.
  if (siteConfig.locked && !siteAdmin) {
    return (
      <Routes>
        <Route path="/login" element={<SignIn />} />
        <Route path="*" element={<ComingSoon message={siteConfig.message} />} />
      </Routes>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<SignIn />} />
        {/*
          The public site explains Scriber to somebody who has never seen it,
          and only the public address has anyone to explain it to. On app. or
          a school's own subdomain an anonymous visitor came here to sign in,
          so send them there rather than selling to them.
        */}
        {kind === 'marketing' ? (
          <Route path="*" element={<Home content={siteConfig.content} />} />
        ) : (
          <Route path="*" element={<Navigate to="/login" replace />} />
        )}
      </Routes>
    )
  }

  // An invite means a specific organisation is expecting this address —
  // verifying it comes before anything else on the platform, onboarding
  // included, not just before accepting the invite itself.
  if (pendingInvites.length > 0 && !user.emailVerified) {
    return <VerifyGate />
  }

  // A brand-new account goes straight to the one-time walkthrough — every
  // other route redirects there first, same as signed-out users land on
  // /login before anything else.
  if (!onboarded && location.pathname !== '/welcome') {
    return (
      <Routes>
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    )
  }

  // The exam room and the welcome walkthrough take over the whole window —
  // no chrome to distract.
  const bare = location.pathname.startsWith('/exam') || location.pathname === '/welcome'

  return (
    <div className="app-shell">
      {/* A notice the site admin set — outages, term dates. Never in the exam
          room, where nothing may compete with the paper. */}
      {siteConfig.content.banner && !bare && (
        <div className="site-banner no-print">{siteConfig.content.banner}</div>
      )}
      {!bare && <TopBar host={host.org} />}
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/exam" element={<ExamRoom />} />
        <Route path="/sessions/:id" element={<SessionReview />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/organisations" element={<Organisations />} />
        <Route path="/organisations/:orgId" element={<OrganisationConsole />} />
        <Route path="/organisations/:orgId/tests/:testId" element={<TestMonitor />} />
        <Route path="/admin" element={<SiteAdmin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  )
}
