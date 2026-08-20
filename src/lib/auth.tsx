import { MEMORY_PRESETS, type MemoryPreset, type MemorySettings } from '../scribe/workingMemory'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db, firebaseConfigured } from './firebase'
import { listMyMemberships, listMyPendingInvites, type Membership, type PendingInvite } from './org'
import { isSiteAdmin as checkSiteAdmin, canCreateOrg as checkCanCreateOrg } from './siteAdmin'
import { clearFiles } from './fileStore'

export type Settings = {
  ruleProfile: 'strict' | 'assisted'
  readBackRate: number
  recogniserLanguage: string
  showLiveText: boolean
  fontSize: 'small' | 'medium' | 'large'
  /** Which writer you are practising against. */
  writerPreset: MemoryPreset
  /** Resolved limits for that writer. */
  memory: MemorySettings
  /** For shared/lab computers — wipe locally-saved exam papers on sign-out. */
  clearFilesOnSignOut: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  ruleProfile: 'strict',
  readBackRate: 0.95,
  recogniserLanguage: 'en-AU',
  showLiveText: true,
  fontSize: 'medium',
  writerPreset: 'realistic',
  memory: MEMORY_PRESETS.realistic!.settings,
  clearFilesOnSignOut: false,
}

export type Profile = {
  uid: string
  email: string
  name: string
  photoUrl: string | null
}

type AuthValue = {
  user: Profile | null
  settings: Settings
  loading: boolean
  configured: boolean
  /** Every organisation this account belongs to, across all of them. */
  memberships: Membership[]
  /** Invites addressed to this account's email, not yet accepted. */
  pendingInvites: PendingInvite[]
  /** Platform-wide administrator — see siteAdmin.ts. Never grants content access. */
  siteAdmin: boolean
  /** Whether this account may create a new organisation — always true for a site admin. */
  canCreateOrg: boolean
  /** Reload memberships/invites after joining, creating, or leaving an org. */
  refreshMemberships: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name?: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  saveSettings: (next: Partial<Settings>) => Promise<void>
  updateName: (name: string) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

function nameFromEmail(email: string) {
  const local = email.split('@')[0] ?? 'Student'
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function toProfile(user: FirebaseUser): Profile {
  return {
    uid: user.uid,
    email: user.email ?? '',
    name: user.displayName || nameFromEmail(user.email ?? 'student'),
    photoUrl: user.photoURL,
  }
}

/** Firebase reports errors by code; these are the ones a student can act on. */
function readableError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? ''
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address does not look right.'
    case 'auth/missing-password':
      return 'Enter your password.'
    case 'auth/weak-password':
      return 'Use a password of at least 6 characters.'
    case 'auth/email-already-in-use':
      return 'An account already exists for that email. Try signing in.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password is incorrect.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was closed before it finished.'
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in window. Allow pop-ups and try again.'
    case 'auth/account-exists-with-different-credential':
      return 'That email is already registered with a password. Sign in with your password instead.'
    case 'auth/operation-not-allowed':
      return 'That sign-in method is not enabled on this Firebase project.'
    case 'auth/unauthorized-domain':
      return 'This domain is not authorised in the Firebase console under Authentication → Settings.'
    default:
      return error instanceof Error ? error.message : 'Sign-in failed.'
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(firebaseConfigured)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([])
  const [siteAdmin, setSiteAdmin] = useState(false)
  const [canCreateOrg, setCanCreateOrg] = useState(false)

  const loadOrgState = useCallback(async (uid: string, email: string) => {
    // Falls back to empty/false on failure so a network hiccup never blocks
    // sign-in — but a query that needs a Firestore index not yet deployed
    // (collection-group queries do) fails the same way, silently, unless
    // it's at least logged: a missing index here reads to a user as "my
    // organisation vanished," not as an error.
    const logged = <T,>(label: string, promise: Promise<T>, fallback: T): Promise<T> =>
      promise.catch((err) => {
        console.error(`[org state] ${label} failed — falling back:`, err)
        return fallback
      })
    const [nextMemberships, nextInvites, nextSiteAdmin, nextCanCreateOrg] = await Promise.all([
      logged('listMyMemberships', listMyMemberships(uid), []),
      email ? logged('listMyPendingInvites', listMyPendingInvites(email), []) : Promise.resolve([]),
      logged('isSiteAdmin', checkSiteAdmin(uid), false),
      email ? logged('canCreateOrg', checkCanCreateOrg(email), false) : Promise.resolve(false),
    ])
    setMemberships(nextMemberships)
    setPendingInvites(nextInvites)
    setSiteAdmin(nextSiteAdmin)
    setCanCreateOrg(nextSiteAdmin || nextCanCreateOrg)
  }, [])

  const refreshMemberships = useCallback(async () => {
    if (!user) return
    await loadOrgState(user.uid, user.email)
  }, [user, loadOrgState])

  useEffect(() => {
    if (!firebaseConfigured) return
    return onAuthStateChanged(auth, async (current) => {
      if (!current) {
        setUser(null)
        setSettings(DEFAULT_SETTINGS)
        setMemberships([])
        setPendingInvites([])
        setSiteAdmin(false)
        setCanCreateOrg(false)
        setLoading(false)
        return
      }

      const profile = toProfile(current)
      setUser(profile)

      // The user document holds settings and doubles as the ownership anchor
      // for the papers and attempts subcollections.
      const userDoc = doc(db, 'users', current.uid)
      try {
        const snapshot = await getDoc(userDoc)
        if (snapshot.exists()) {
          setSettings({ ...DEFAULT_SETTINGS, ...(snapshot.data().settings ?? {}) })
        } else {
          await setDoc(userDoc, {
            email: profile.email,
            name: profile.name,
            settings: DEFAULT_SETTINGS,
            createdAt: new Date().toISOString(),
          })
          setSettings(DEFAULT_SETTINGS)
        }
      } catch {
        // Offline or rules not deployed yet — practise with the defaults.
        setSettings(DEFAULT_SETTINGS)
      }

      await loadOrgState(profile.uid, profile.email)
      setLoading(false)
    })
  }, [loadOrgState])

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (error) {
      throw new Error(readableError(error))
    }
  }, [])

  const signUp = useCallback(async (email: string, password: string, name?: string) => {
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password)
      const displayName = name?.trim() || nameFromEmail(email)
      await updateProfile(credential.user, { displayName })
      setUser(toProfile({ ...credential.user, displayName } as FirebaseUser))
    } catch (error) {
      throw new Error(readableError(error))
    }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      await signInWithPopup(auth, provider)
    } catch (error) {
      throw new Error(readableError(error))
    }
  }, [])

  const signOut = useCallback(async () => {
    // Exam papers are namespaced by uid, so another account signing in can
    // never read them through the app — but on a shared school computer,
    // leftover files otherwise sit in IndexedDB indefinitely after a student
    // walks away, inspectable by anyone with access to that browser profile.
    // Off by default: clearing on every sign-out would force re-attaching
    // papers each session on a personal device, which is the common case.
    if (user && settings.clearFilesOnSignOut) {
      await clearFiles(user.uid).catch(() => undefined)
    }
    await firebaseSignOut(auth)
  }, [user, settings.clearFilesOnSignOut])

  const saveSettings = useCallback(
    async (next: Partial<Settings>) => {
      const merged = { ...settings, ...next }
      setSettings(merged) // switches feel instant
      if (!user) return
      await setDoc(doc(db, 'users', user.uid), { settings: merged }, { merge: true })
    },
    [settings, user],
  )

  const updateName = useCallback(
    async (name: string) => {
      if (!auth.currentUser || !user) return
      await updateProfile(auth.currentUser, { displayName: name })
      await setDoc(doc(db, 'users', user.uid), { name }, { merge: true })
      setUser({ ...user, name })
    },
    [user],
  )

  const value = useMemo<AuthValue>(
    () => ({
      user,
      settings,
      loading,
      configured: firebaseConfigured,
      memberships,
      pendingInvites,
      siteAdmin,
      canCreateOrg,
      refreshMemberships,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      saveSettings,
      updateName,
    }),
    [
      user,
      settings,
      loading,
      memberships,
      pendingInvites,
      siteAdmin,
      canCreateOrg,
      refreshMemberships,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      saveSettings,
      updateName,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.')
  return value
}
