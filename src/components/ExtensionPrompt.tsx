import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { extensionInstalled } from '../lib/examExtension'
import { DEFAULT_CONTENT, subscribeSiteConfig } from '../lib/siteConfig'

const DISMISSED_KEY = 'scriber-extension-prompt-dismissed'

/**
 * Asks a student in a school to install the supervision extension.
 *
 * Only shown to people who belong to an organisation, because that is the
 * only place a supervised test happens — a personal account has nobody to be
 * supervised by, and nagging them about a tab monitor would be both useless
 * and slightly sinister.
 *
 * It can be dismissed, and the dismissal sticks, because being reminded on
 * every visit is how a notice becomes something people stop reading. It comes
 * back if the extension still isn't there when a test is actually scheduled,
 * which is the moment it genuinely matters.
 */
export function ExtensionPrompt() {
  const { memberships } = useAuth()
  const [dismissed, setDismissed] = useState(true)
  // Set by a site admin the day the store listing is approved — see
  // docs/chrome-web-store.md.
  const [storeUrl, setStoreUrl] = useState(DEFAULT_CONTENT.extensionUrl)

  useEffect(() => subscribeSiteConfig((config) => setStoreUrl(config.content.extensionUrl)), [])

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY) === 'yes')
    } catch {
      // A browser refusing storage just means we ask again next time.
      setDismissed(false)
    }
  }, [])

  if (memberships.length === 0 || extensionInstalled() || dismissed) return null

  return (
    <div className="extension-prompt no-print">
      <div className="extension-prompt-body">
        <strong>Install the Scriber extension before your next assessment.</strong>
        <p>
          Supervised tests require it. It lets your supervisor see which other tabs you have
          open — only while a test is running, and never at any other time. Without it you can
          still practise, but you may not be able to sit an assessment.
        </p>
      </div>
      <div className="extension-prompt-actions">
        <a
          className="btn btn-primary btn-sm"
          href={storeUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Get the extension
        </a>
        <Link className="btn btn-sm" to="/settings">
          Pair it
        </Link>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => {
            setDismissed(true)
            try {
              localStorage.setItem(DISMISSED_KEY, 'yes')
            } catch {
              /* nothing to remember it with — it will ask again */
            }
          }}
        >
          Not now
        </button>
      </div>
    </div>
  )
}
