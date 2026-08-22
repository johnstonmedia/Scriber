/**
 * What the supervision extension reports while a student sits a test.
 *
 * This is the one thing a web page genuinely cannot see. A browser tab is
 * walled off from every other tab by design, so Scriber's own page can only
 * ever say "I lost focus" — never where the focus went. An extension holding
 * the tabs permission can, and the difference between "left the exam tab" and
 * "left the exam tab and opened a search engine" is the whole point of
 * supervision.
 *
 * The extension has no Firebase privileges. It posts here with the token it
 * was issued at pairing, this route decides whether that student is really
 * sitting that test, and only then does anything reach Firestore.
 */

import { FieldValue } from 'firebase-admin/firestore'
import { db } from '../_lib/admin.js'
import { requireExtension } from '../_lib/auth.js'
import { HttpError, jsonBody, requireString, route } from '../_lib/http.js'

/** Anything under the platform's own domain is the exam itself, not a distraction. */
function isOwnHost(host: string, rootDomain: string): boolean {
  return host === rootDomain || host.endsWith(`.${rootDomain}`) || host === 'localhost'
}

type Tab = { title: string; host: string; active: boolean }

/** Trusts nothing about shape or size — this arrives from an extension. */
function readTabs(value: unknown): Tab[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 50).map((raw) => {
    const tab = (raw ?? {}) as Record<string, unknown>
    return {
      title: String(tab.title ?? '').slice(0, 160),
      host: String(tab.host ?? '').toLowerCase().slice(0, 120),
      active: tab.active === true,
    }
  })
}

export default route('POST', async (req) => {
  const caller = await requireExtension(req)
  const body = jsonBody(req)
  const orgId = requireString(body, 'orgId', 128)
  const testId = requireString(body, 'testId', 128)
  const focused = body.focused === true
  const tabs = readTabs(body.tabs)

  const rootDomain = (process.env.PUBLIC_ROOT_DOMAIN ?? 'pracscriber.com').toLowerCase()

  const testRef = db().collection('organisations').doc(orgId).collection('tests').doc(testId)
  const participantRef = testRef.collection('participants').doc(caller.uid)
  const [test, participant] = await Promise.all([testRef.get(), participantRef.get()])

  if (!test.exists || !participant.exists) {
    throw new HttpError(404, 'not-a-participant', 'You are not in that test.')
  }
  // A finished test stops accepting reports — no point recording a student's
  // browsing after the exam is over, and it would be misleading in the feed.
  if (test.get('phase') === 'finished') return { ok: true, ignored: 'test-finished' }

  const foreign = tabs.filter((tab) => tab.host && !isOwnHost(tab.host, rootDomain))
  const previous: string[] = Array.isArray(participant.get('reportedHosts'))
    ? (participant.get('reportedHosts') as string[])
    : []
  const seen = new Set(previous)
  const opened = foreign.filter((tab) => !seen.has(tab.host))

  const batch = db().batch()
  batch.set(
    participantRef,
    {
      extension: {
        connected: true,
        seenAt: FieldValue.serverTimestamp(),
        focused,
        tabCount: tabs.length,
        otherTabs: foreign.map((tab) => ({ title: tab.title, host: tab.host, active: tab.active })),
      },
      reportedHosts: [...new Set([...previous, ...foreign.map((tab) => tab.host)])].slice(-100),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  // One alert per newly-seen site, not one per report — a supervisor watching
  // a class does not need the same tab announced every few seconds.
  const name = String(participant.get('name') ?? '')
  for (const tab of opened) {
    batch.set(testRef.collection('alerts').doc(), {
      uid: caller.uid,
      name,
      type: 'other-tab-opened',
      detail: tab.title ? `${tab.host} — ${tab.title}` : tab.host,
      at: FieldValue.serverTimestamp(),
    })
  }

  batch.set(caller.tokenRef, { lastSeenAt: FieldValue.serverTimestamp() }, { merge: true })
  await batch.commit()

  return { ok: true, alerted: opened.length }
})
