import { Link } from 'react-router-dom'
import { BrandMark } from '../components/BrandMark'

/**
 * What the world sees while the site is locked. A site admin signing in
 * passes straight through this — the sign-in link stays, deliberately quiet,
 * so there's still a way in without a secret URL.
 */
export function ComingSoon({ message }: { message: string }) {
  return (
    <div className="auth-screen">
      <div className="auth-panel" style={{ textAlign: 'center' }}>
        <div className="auth-card stack gap-4">
          <div className="brand" style={{ justifyContent: 'center' }}>
            <BrandMark />
            Scriber
          </div>
          <h1 style={{ margin: 0 }}>Coming soon</h1>
          <p className="muted">{message}</p>
          <Link className="btn btn-ghost btn-sm" to="/login" style={{ alignSelf: 'center' }}>
            Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
