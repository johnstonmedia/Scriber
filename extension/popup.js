/**
 * The popup has two jobs and no more: pair this browser once, and the rest of
 * the time get the student into practice in one click.
 */

const DEFAULT_ORIGIN = 'https://app.pracscriber.com'

const el = (id) => document.getElementById(id)

/**
 * Pair against whichever Scriber the student actually uses — their school's
 * subdomain, or a local build during development — rather than assuming the
 * public one. Falls back to the public app when no Scriber tab is open.
 */
async function scriberOrigin() {
  const tabs = await chrome.tabs.query({ url: ['https://*.pracscriber.com/*', 'http://localhost:5173/*'] })
  const url = tabs[0]?.url
  if (!url) return DEFAULT_ORIGIN
  try {
    return new URL(url).origin
  } catch {
    return DEFAULT_ORIGIN
  }
}

async function render() {
  const { token } = await chrome.storage.local.get('token')
  const session = (await chrome.storage.session.get('session')).session ?? null

  el('pair-view').hidden = !!token
  el('ready-view').hidden = !token
  el('badge').hidden = !session

  if (!token) return

  el('state').textContent = session ? 'Supervising an exam' : 'Paired and ready'
  el('state').dataset.live = String(!!session)
  el('state-detail').textContent = session
    ? 'Your open tabs are visible to your supervisor until the test ends.'
    : 'Nothing is being reported. This starts by itself when you sit a test, and stops when it ends.'
  el('practise').href = `${await scriberOrigin()}/exam`
}

el('pair-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const button = el('pair-submit')
  const error = el('pair-error')
  error.hidden = true
  button.disabled = true
  button.textContent = 'Pairing…'

  try {
    const origin = await scriberOrigin()
    const response = await fetch(`${origin}/api/extension/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: el('code').value.trim().toUpperCase() }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.message ?? "That code didn't work.")

    await chrome.storage.local.set({ token: body.token })
    chrome.runtime.sendMessage({ type: 'paired' })
    await render()
  } catch (failure) {
    error.textContent = failure instanceof Error ? failure.message : "That code didn't work."
    error.hidden = false
  } finally {
    button.disabled = false
    button.textContent = 'Pair'
  }
})

el('unpair').addEventListener('click', async () => {
  await chrome.storage.local.remove('token')
  await chrome.storage.session.remove('session')
  await render()
})

void render()
