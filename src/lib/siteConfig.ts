/**
 * Platform-wide switches, currently just the "coming soon" lock.
 *
 * Locked, the whole app is a holding page for everyone except a signed-in
 * site admin, who still reaches every page normally. The flag is public to
 * read on purpose — the app has to decide what to render before it knows who
 * is looking — and only a site admin can write it (see firestore.rules).
 */

import { doc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore'
import { db } from './firebase'

export type SiteConfig = {
  locked: boolean
  message: string
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  locked: false,
  message: 'Scriber is getting ready. Check back soon.',
}

const configDoc = doc(db, 'siteConfig', 'site')

export function subscribeSiteConfig(cb: (config: SiteConfig) => void): Unsubscribe {
  return onSnapshot(
    configDoc,
    (snapshot) => {
      const data = snapshot.data()
      cb({
        locked: data?.locked === true,
        message: typeof data?.message === 'string' && data.message ? data.message : DEFAULT_SITE_CONFIG.message,
      })
    },
    // A read failure must never lock people out of a site that isn't locked.
    () => cb(DEFAULT_SITE_CONFIG),
  )
}

export async function setSiteLock(locked: boolean, message?: string): Promise<void> {
  await setDoc(configDoc, message === undefined ? { locked } : { locked, message }, { merge: true })
}
