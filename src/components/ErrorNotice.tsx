import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { submitSupportReport, userMessage, type AppError } from '../lib/errors'

/**
 * The one way a failure is shown to a user: a code, and an offer to ask for
 * help. Never an instruction — most people can't deploy a security rule or
 * build a database index, and asking them to makes a fault of ours look like
 * a fault of theirs. The diagnosis rides along with the report instead.
 */
export function ErrorNotice({ error, onDismiss }: { error: AppError | null; onDismiss?: () => void }) {
  const { user } = useAuth()
  const [sent, setSent] = useState(false)
  if (!error) return null

  return (
    <div className="alert alert-error" style={{ marginBottom: 16 }}>
      <div className="row gap-3 wrap">
        <span className="grow">{userMessage(error.code)}</span>
        {sent ? (
          <span className="small muted">Report sent — thank you.</span>
        ) : (
          <button
            className="btn btn-sm"
            onClick={() => {
              setSent(true)
              void submitSupportReport({
                code: error.code,
                uid: user?.uid ?? null,
                email: user?.email ?? null,
                path: window.location.pathname + window.location.search,
                cause: error.cause,
              }).catch(() => undefined)
            }}
          >
            Request help
          </button>
        )}
        {onDismiss && (
          <button className="btn btn-sm btn-ghost" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  )
}
