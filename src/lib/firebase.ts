/**
 * Firebase setup.
 *
 * The config values below are the public web-app keys. They are meant to be
 * visible in the bundle — access is controlled by the Firestore and Storage
 * security rules in this repo, not by hiding these strings.
 */

import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectStorageEmulator, getStorage } from 'firebase/storage'

const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
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
export const storage = getStorage(app)

/**
 * `npm run emulators` plus `VITE_USE_EMULATORS=true npm run dev` runs the whole
 * app locally with no cloud project at all.
 */
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectStorageEmulator(storage, '127.0.0.1', 9199)
}
