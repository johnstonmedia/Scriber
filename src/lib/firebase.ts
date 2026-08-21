/**
 * Firebase setup.
 *
 * The config values below are the public web-app keys. They are meant to be
 * visible in the bundle — access is controlled by the Firestore security
 * rules in this repo, not by hiding these strings.
 *
 * Deliberately just Auth and Firestore — no Storage. Every file a student or
 * a distributing teacher deals with stays as extracted text in Firestore or
 * on-device (see fileStore.ts and questionExtract.ts), so there's no bucket
 * to provision and no Blaze-plan requirement to run this at all.
 */

import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

/**
 * The project Scriber ships against. Committing these is deliberate: they are
 * the public web-app keys, they are readable in any built bundle anyway, and
 * hard-coding them means a deploy needs no build-time secrets at all.
 *
 * Set the matching VITE_FIREBASE_* variables to point a build somewhere else.
 */
const DEFAULT_CONFIG: FirebaseOptions = {
  apiKey: 'AIzaSyDBqPvwR81AZMqIYEsbihnnbYXUDwBYRzk',
  authDomain: 'pracscriber.firebaseapp.com',
  projectId: 'pracscriber',
  messagingSenderId: '861724048481',
  appId: '1:861724048481:web:ffcc182f1de0104a8abe20',
}

// An unset variable arrives as an empty string in CI, which falls through to
// the default just as an absent one does.
const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || DEFAULT_CONFIG.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || DEFAULT_CONFIG.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || DEFAULT_CONFIG.projectId,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || DEFAULT_CONFIG.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || DEFAULT_CONFIG.appId,
}

/** False until the project keys are filled in, so the UI can explain itself. */
export const firebaseConfigured = Boolean(config.apiKey && config.projectId)

const app = initializeApp(
  firebaseConfigured
    ? config
    : // Placeholder values keep the SDK from throwing at import time; every
      // call still fails until real keys are supplied.
      { apiKey: 'unconfigured', projectId: 'unconfigured', appId: 'unconfigured' },
)

export const auth = getAuth(app)
export const db = getFirestore(app)

/**
 * `npm run emulators` plus `VITE_USE_EMULATORS=true npm run dev` runs the whole
 * app locally with no cloud project at all.
 */
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
