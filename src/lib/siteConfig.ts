/**
 * Platform-wide settings a site admin controls without a deploy.
 *
 * Two separate things live here and it matters that they stay separate:
 *
 *   locked   Whether the product is open. Locked, the public site turns into
 *            a coming-soon page and the app itself refuses to load for
 *            anyone but a signed-in site admin, who works on it as normal —
 *            otherwise locking would lock out the only person who can unlock.
 *
 *   content  The words on the public site. These are here rather than in the
 *            source so that changing a headline is a text field and not a
 *            release.
 *
 * The document is public to read on purpose: the app has to decide what to
 * render before it knows who is looking. Only a site admin may write it — see
 * firestore.rules.
 */

import { doc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore'
import { db } from './firebase'

export type SiteContent = {
  /** The public site's headline and the sentence under it. */
  heroTitle: string
  heroBody: string
  /** What the primary button says, for anyone not signed in. */
  ctaLabel: string
  /** Shown across the top of every page when set — outages, term dates, notices. */
  banner: string
  /**
   * Where "Get the extension" sends people. Lives here rather than in the
   * source because the Chrome Web Store only issues the real URL once the
   * listing is approved, and that day should not need a deploy.
   */
  extensionUrl: string
}

export type SiteConfig = {
  locked: boolean
  /** Shown on the coming-soon page while locked. */
  message: string
  content: SiteContent
}

export const DEFAULT_CONTENT: SiteContent = {
  heroTitle: 'Practise with a writer before the exam room does.',
  heroBody:
    'Scriber acts as your writer. It writes exactly what you say — nothing more — and it behaves like a real person: a beat of lag, a limited memory, and the occasional “how do you spell that?” It’s the only way to practise the pace an exam actually demands.',
  ctaLabel: 'Start practising free',
  banner: '',
  // A search, until the listing exists. Honest but poor — see
  // docs/chrome-web-store.md.
  extensionUrl: 'https://chromewebstore.google.com/search/scriber',
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  locked: false,
  message: 'Scriber is getting ready. Check back soon.',
  content: DEFAULT_CONTENT,
}

const configDoc = doc(db, 'siteConfig', 'site')

/** An empty string in Firestore means "unset", not "deliberately blank". */
const text = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() ? value : fallback

export function subscribeSiteConfig(cb: (config: SiteConfig) => void): Unsubscribe {
  return onSnapshot(
    configDoc,
    (snapshot) => {
      const data = snapshot.data() ?? {}
      const content = (data.content ?? {}) as Record<string, unknown>
      cb({
        locked: data.locked === true,
        message: text(data.message, DEFAULT_SITE_CONFIG.message),
        content: {
          heroTitle: text(content.heroTitle, DEFAULT_CONTENT.heroTitle),
          heroBody: text(content.heroBody, DEFAULT_CONTENT.heroBody),
          ctaLabel: text(content.ctaLabel, DEFAULT_CONTENT.ctaLabel),
          // The banner is the one field where blank is a real choice — it
          // means "no notice today" rather than "fall back to the default".
          banner: typeof content.banner === 'string' ? content.banner : '',
          extensionUrl: text(content.extensionUrl, DEFAULT_CONTENT.extensionUrl),
        },
      })
    },
    // A read failure must never lock people out of a site that isn't locked.
    () => cb(DEFAULT_SITE_CONFIG),
  )
}

export async function setSiteLock(locked: boolean, message?: string): Promise<void> {
  await setDoc(configDoc, message === undefined ? { locked } : { locked, message }, { merge: true })
}

export async function setSiteContent(content: Partial<SiteContent>): Promise<void> {
  await setDoc(configDoc, { content }, { merge: true })
}
