/**
 * Cloudflare Web Analytics.
 *
 * Chosen because it counts page views without cookies, without a device
 * fingerprint, and without following anybody between sites — which means it
 * needs no consent banner and costs nothing that would have to be explained
 * to a school. The token is not a secret: it identifies the site, and it sits
 * in the page source of every site that uses this.
 *
 * Three places it deliberately does not run.
 *
 *   Development. Otherwise every `npm run dev` reload and every Playwright
 *   run — and the suites here open hundreds of pages — lands in the same
 *   dashboard as real visitors, which makes the numbers worse than having
 *   none.
 *
 *   Any localhost origin, even in a production build, for the same reason
 *   when previewing a build locally.
 *
 *   The exam room. A live test URL carries the organisation and test IDs in
 *   its query string, and those have no business being sent to a third party
 *   just to learn that a page was viewed. Nothing is lost: how many students
 *   sat a test is already known exactly, from the test itself.
 */

const TOKEN = 'c79e4b371f1e49b7807d4f91da886e64'
const BEACON = 'https://static.cloudflareinsights.com/beacon.min.js'

function shouldRun(): boolean {
  if (!import.meta.env.PROD) return false
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return false
  if (window.location.pathname.startsWith('/exam')) return false
  return true
}

/**
 * Called once at startup. Failing to load the beacon must never be visible:
 * a school network that blocks Cloudflare's static host is entirely allowed
 * to, and losing a page-view count is not worth a broken page.
 */
export function startAnalytics(): void {
  if (!shouldRun()) return
  try {
    const script = document.createElement('script')
    script.defer = true
    script.src = BEACON
    script.dataset.cfBeacon = JSON.stringify({ token: TOKEN })
    script.addEventListener('error', () => script.remove())
    document.head.appendChild(script)
  } catch {
    // Nothing here is worth surfacing to anybody.
  }
}
