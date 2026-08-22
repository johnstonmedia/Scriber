/**
 * The bridge between a Scriber page and this extension.
 *
 * A page cannot talk to an extension directly without knowing its ID, and an
 * ID changes between a local build and the published one. A content script
 * sidesteps that entirely: it already belongs to both worlds.
 *
 * It does two things. It marks the document so the page can tell the
 * extension is installed — the waiting room needs to say so before a test
 * starts, not after. And it relays the page's announcements about which test
 * is being sat, so the background worker knows when to report and when to
 * stop.
 */

const MARK = 'scriberExtension'

// Set at document_start so the page sees it on first render, and re-set after
// any framework rewrite of the root element's attributes.
const mark = () => {
  document.documentElement.dataset[MARK] = chrome.runtime.getManifest().version
}
mark()
document.addEventListener('DOMContentLoaded', mark)

window.addEventListener('message', (event) => {
  // Only this page, and only messages that say they are ours.
  if (event.source !== window) return
  const data = event.data
  if (!data || data.source !== 'scriber-page') return

  if (data.type === 'test-start' || data.type === 'test-end') {
    chrome.runtime.sendMessage({
      type: data.type,
      orgId: data.orgId ?? null,
      testId: data.testId ?? null,
      origin: window.location.origin,
    })
  }
})

// The page asks whether a token is paired; the popup is where pairing
// happens, so this only reports state.
window.addEventListener('scriber:ask-status', () => {
  chrome.runtime.sendMessage({ type: 'status' }, (reply) => {
    window.dispatchEvent(new CustomEvent('scriber:status', { detail: reply ?? { paired: false } }))
  })
})
