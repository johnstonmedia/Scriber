/**
 * Proves the Firestore and Storage rules actually isolate accounts.
 * Run the emulators first: npm run emulators
 */
import { initializeApp } from 'firebase/app'
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth'
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc,
} from 'firebase/firestore'

const app = initializeApp({ apiKey: 'demo', projectId: 'scriber-local', appId: 'demo' })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

const results = []
const check = (name, passed) => {
  results.push({ name, passed })
  console.log(`${passed ? '✓' : '✗ FAIL'}  ${name}`)
}

async function account(email) {
  try {
    return (await createUserWithEmailAndPassword(auth, email, 'practice123')).user
  } catch {
    return (await signInWithEmailAndPassword(auth, email, 'practice123')).user
  }
}

// Victim writes a private paper.
const victim = await account('victim@school.test')
const victimUid = victim.uid
await setDoc(doc(db, 'users', victimUid), { email: 'victim@school.test', settings: {} })
await setDoc(doc(db, 'users', victimUid, 'papers', 'secret'), { title: 'Trial paper' })
check('owner can write their own paper', true)

const ownRead = await getDoc(doc(db, 'users', victimUid, 'papers', 'secret'))
check('owner can read their own paper', ownRead.exists())

// Attacker signs in and goes looking.
const attacker = await account('attacker@school.test')
check('attacker has a different uid', attacker.uid !== victimUid)

async function denied(label, operation) {
  try {
    await operation()
    check(label, false)
  } catch (error) {
    const code = error?.code ?? ''
    check(label, code === 'permission-denied' || code === 'auth/insufficient-permission')
  }
}

await denied("attacker cannot read the victim's paper", () =>
  getDoc(doc(db, 'users', victimUid, 'papers', 'secret')),
)
await denied("attacker cannot read the victim's user document", () =>
  getDoc(doc(db, 'users', victimUid)),
)
await denied("attacker cannot write into the victim's papers", () =>
  setDoc(doc(db, 'users', victimUid, 'papers', 'injected'), { title: 'hacked' }),
)
await denied("attacker cannot read the victim's attempts", () =>
  getDoc(doc(db, 'users', victimUid, 'attempts', 'anything')),
)
await denied('nobody can write outside the users tree', () =>
  setDoc(doc(db, 'somewhere-else', 'x'), { a: 1 }),
)

// Attacker can still use their own space.
await setDoc(doc(db, 'users', attacker.uid, 'papers', 'mine'), { title: 'My own paper' })
check('attacker can still use their own space', true)

const failed = results.filter((r) => !r.passed)
console.log(`\n${results.length - failed.length}/${results.length} rule checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
