/**
 * What the supervisor actually gets to see.
 *
 * A web page is walled off from every other tab, so Scriber's own page can
 * only ever report "I lost focus" — never where the focus went. This worker
 * holds the tabs permission and can say, which is the difference between
 * "left the exam" and "left the exam and opened a search engine".
 *
 * It reports only while a test is being sat. Outside a test it knows nothing
 * and sends nothing: the permission exists for the exam room, and using it
 * the rest of the time would be surveillance rather than supervision.
 *
 * Reporting is event-driven — a new or switched tab is sent at once, because
 * that is the moment a supervisor needs — with a slow heartbeat behind it so
 * a quiet session still proves the extension is alive.
 */

const SESSION_KEY = 'session'
const TOKEN_KEY = 'token'
const HEARTBEAT = 'scriber-heartbeat'

const getSession = async () => (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] ?? null
const getToken = async () => (await chrome.storage.local.get(TOKEN_KEY))[TOKEN_KEY] ?? null

async function setSession(session) {
  if (session) {
    await chrome.storage.session.set({ [SESSION_KEY]: session })
    // 30s is the floor Chrome allows for an alarm; tab events carry anything
    // that actually matters, so this is only a liveness signal.
    await chrome.alarms.create(HEARTBEAT, { periodInMinutes: 0.5 })
  } else {
    await chrome.storage.session.remove(SESSION_KEY)
    await chrome.alarms.clear(HEARTBEAT)
  }
  await paintBadge(!!session)
}

async function paintBadge(active) {
  await chrome.action.setBadgeText({ text: active ? 'ON' : '' })
  await chrome.action.setBadgeBackgroundColor({ color: '#1F5FD8' })
}

/**
 * Titles and hostnames only — never full URLs, which carry search terms and
 * document names a supervisor has no business reading. Knowing a student
 * opened a search engine is the point; knowing what they typed into it is
 * not.
 */
async function collectTabs() {
  const tabs = await chrome.tabs.query({})
  return tabs.map((tab) => {
    let host = ''
    try {
      host = new URL(tab.url ?? '').hostname
    } catch {
      host = ''
    }
    return { title: tab.title ?? '', host, active: tab.active === true }
  })
}

async function report() {
  const [session, token] = await Promise.all([getSession(), getToken()])
  if (!session || !token) return

  const windows = await chrome.windows.getAll().catch(() => [])
  const focused = windows.some((w) => w.focused)

  try {
    const response = await fetch(`${session.origin}/api/extension/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        orgId: session.orgId,
        testId: session.testId,
        focused,
        tabs: await collectTabs(),
      }),
    })
    // A token the backend no longer recognises means the pairing is gone;
    // stop rather than retrying against it every few seconds.
    if (response.status === 401) {
      await chrome.storage.local.remove(TOKEN_KEY)
      await setSession(null)
    }
  } catch {
    // Offline, or the page is gone. The next event tries again.
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'test-start') {
    void setSession({ orgId: message.orgId, testId: message.testId, origin: message.origin }).then(report)
    return false
  }
  if (message?.type === 'test-end') {
    void setSession(null)
    return false
  }
  if (message?.type === 'status') {
    void (async () => {
      const [session, token] = await Promise.all([getSession(), getToken()])
      sendResponse({ paired: !!token, supervising: !!session })
    })()
    return true
  }
  if (message?.type === 'paired') {
    void paintBadge(false)
    return false
  }
  return false
})

// A tab appearing or being switched to is exactly the event worth sending at
// once — waiting up to half a minute would make the feed useless.
chrome.tabs.onCreated.addListener(() => void report())
chrome.tabs.onActivated.addListener(() => void report())
chrome.tabs.onRemoved.addListener(() => void report())
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.status === 'complete' || change.title) void report()
})
chrome.windows.onFocusChanged.addListener(() => void report())
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT) void report()
})
