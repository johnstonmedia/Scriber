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
import { Home } from './pages/Home'
import { SignIn } from './pages/SignIn'
import { Dashboard } from './pages/Dashboard'
import { ExamRoom } from './pages/ExamRoom'
import { SessionReview } from './pages/SessionReview'
import { Settings } from './pages/Settings'
import { Organisations } from './pages/Organisations'
import { OrganisationConsole } from './pages/OrganisationConsole'
import { SiteAdmin } from './pages/SiteAdmin'

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

function TopBar() {
  const { user, memberships, pendingInvites, siteAdmin, signOut } = useAuth()
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()

  return (
    <header className="topbar no-print">
      <NavLink to="/" className="brand">
        <span className="brand-mark">S</span>
        Scriber
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
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }} className="muted">
        Loading Scriber…
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<SignIn />} />
        <Route path="*" element={<Home />} />
      </Routes>
    )
  }

  // The exam room takes over the whole window — no chrome to distract.
  const bare = location.pathname.startsWith('/exam')

  return (
    <div className="app-shell">
      {!bare && <TopBar />}
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/exam" element={<ExamRoom />} />
        <Route path="/sessions/:id" element={<SessionReview />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/organisations" element={<Organisations />} />
        <Route path="/organisations/:orgId" element={<OrganisationConsole />} />
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
