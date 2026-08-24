import { MEMORY_PRESETS, type MemoryPreset, type MemorySettings } from '../scribe/workingMemory'
import type { Calibration } from '../scribe/calibration'
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
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db, firebaseConfigured } from './firebase'
import { consumeHandoff } from './hostOrg'
import {
  joinInvitesPredatingAccount,
  listMyMemberships,
  listMyPendingInvites,
  type Membership,
  type PendingInvite,
} from './org'
import {
  isSiteAdmin as checkSiteAdmin,
  canCreateOrg as checkCanCreateOrg,
  canCalibrate as checkCanCalibrate,
} from './siteAdmin'
import { clearFiles } from './fileStore'

export type Settings = {
  ruleProfile: 'strict' | 'assisted'
  readBackRate: number
  recogniserLanguage: string
  showLiveText: boolean
  fontSize: 'small' | 'medium' | 'large'
  /**
   * What this student's pauses mean, measured from them reading aloud. Null
   * until they do it — see scribe/calibration.ts. Only consulted under the
   * HSC writer profile, where a writer may supply punctuation at all.
   */
  calibration: Calibration | null
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
  calibration: null,
  writerPreset: 'realistic',
  memory: MEMORY_PRESETS.realistic!.settings,
  clearFilesOnSignOut: false,
}

export type Profile = {
  uid: string
  email: string
  name: string
  photoUrl: string | null
  emailVerified: boolean
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
  /** Whether the invitation-only calibration tab is offered to this account. */
  calibrationTester: boolean
  /** False only for a brand-new account that hasn't been through the welcome walkthrough yet. */
  onboarded: boolean
  /**
   * Set when loading memberships, invites or org-creator access failed —
   * most often a Firestore index that hasn't been deployed yet. Falls back
   * to empty/false so sign-in is never blocked, but that same fallback
   * would otherwise read to a user as "my organisation vanished" with no
   * indication why — surface it instead.
   */
  orgStateError: string | null
  /** Reload memberships/invites after joining, creating, or leaving an org. */
  refreshMemberships: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name?: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  saveSettings: (next: Partial<Settings>) => Promise<void>
  updateName: (name: string) => Promise<void>
  /** Marks the welcome walkthrough done — call once the user has picked personal or organisation. */
  markOnboarded: () => Promise<void>
  /** Re-sends the verification email Firebase sent on sign-up. */
  sendVerificationEmail: () => Promise<void>
  /** Emails a password reset link. Resolves the same way whether or not the account exists. */
  sendPasswordReset: (email: string) => Promise<void>
  /** Firebase caches emailVerified client-side; call after the user says they've clicked the link. */
  refreshEmailVerified: () => Promise<boolean>
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
    emailVerified: user.emailVerified,
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
  const [calibrationTester, setCalibrationTester] = useState(false)
  const [onboarded, setOnboarded] = useState(true)
  const [orgStateError, setOrgStateError] = useState<string | null>(null)

  const loadOrgState = useCallback(async (uid: string, email: string) => {
    // Falls back to empty/false on failure so a network hiccup never blocks
    // sign-in — but a query that needs a Firestore index not yet deployed
    // (collection-group queries do) fails the same way, silently, unless
    // it's at least surfaced: a missing index here reads to a user as "my
    // organisation vanished," not as an error.
    let firstFailure: string | null = null
    const logged = <T,>(label: string, promise: Promise<T>, fallback: T): Promise<T> =>
      promise.catch((err) => {
        console.error(`[org state] ${label} failed — falling back:`, err)
        firstFailure ??= err instanceof Error ? err.message : String(err)
        return fallback
      })
    let [nextMemberships, nextInvites, nextSiteAdmin, nextCanCreateOrg, nextCalibration] = await Promise.all([
      logged('listMyMemberships', listMyMemberships(uid), []),
      email ? logged('listMyPendingInvites', listMyPendingInvites(email), []) : Promise.resolve([]),
      logged('isSiteAdmin', checkSiteAdmin(uid), false),
      email ? logged('canCreateOrg', checkCanCreateOrg(email), false) : Promise.resolve(false),
      email ? logged('canCalibrate', checkCanCalibrate(email), false) : Promise.resolve(false),
    ])
    // A school that added this address before the account existed was
    // enrolling its own student, not inviting a stranger — so verifying the
    // address the school named is itself the acceptance and there is nothing
    // to click. Done here rather than at the moment of verification because
    // an account can arrive already verified (signing in on a new device, or
    // after clicking the link in another tab), and those have to behave the
    // same as clicking "I've verified" in front of us.
    let invites = nextInvites
    const current = auth.currentUser
    const createdAt = Date.parse(current?.metadata.creationTime ?? '')
    if (invites.length > 0 && current?.emailVerified && Number.isFinite(createdAt)) {
      const joined = await joinInvitesPredatingAccount({
        uid,
        email,
        name: current.displayName ?? '',
        accountCreatedAt: createdAt,
      }).catch(() => [])
      if (joined.length > 0) {
        const [freshMemberships, freshInvites] = await Promise.all([
          logged('listMyMemberships', listMyMemberships(uid), nextMemberships),
          logged('listMyPendingInvites', listMyPendingInvites(email), []),
        ])
        nextMemberships = freshMemberships
        invites = freshInvites
      }
    }

    setMemberships(nextMemberships)
    setPendingInvites(invites)
    setSiteAdmin(nextSiteAdmin)
    setCanCreateOrg(nextSiteAdmin || nextCanCreateOrg)
    setCalibrationTester(nextSiteAdmin || nextCalibration)
    setOrgStateError(firstFailure)
  }, [])

  const refreshMemberships = useCallback(async () => {
    if (!user) return
    await loadOrgState(user.uid, user.email)
  }, [user, loadOrgState])

  // Arriving from another subdomain carries a one-off token in the fragment.
  // Spending it before the listener below settles means the page resolves
  // straight into a signed-in state, rather than flashing the sign-in screen
  // to somebody who is already signed in next door.
  useEffect(() => {
    void consumeHandoff()
  }, [])

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
        setCalibrationTester(false)
        setOnboarded(true)
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
          // Missing the field at all means this account predates the welcome
          // walkthrough — never retroactively send an existing user through it.
          setOnboarded(snapshot.data().onboarded !== false)
        } else {
          await setDoc(userDoc, {
            email: profile.email,
            name: profile.name,
            settings: DEFAULT_SETTINGS,
            onboarded: false,
            createdAt: new Date().toISOString(),
          })
          setSettings(DEFAULT_SETTINGS)
          setOnboarded(false)
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
      // Only email/password accounts need this — a Google sign-in arrives
      // pre-verified. Never block on it: verification only gates organisation
      // features, so a slow or failed send shouldn't stop sign-up itself.
      await sendEmailVerification(credential.user).catch(() => undefined)
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

  const markOnboarded = useCallback(async () => {
    if (!user) return
    await setDoc(doc(db, 'users', user.uid), { onboarded: true }, { merge: true })
    setOnboarded(true)
  }, [user])

  const sendVerificationEmail = useCallback(async () => {
    if (!auth.currentUser) return
    await sendEmailVerification(auth.currentUser)
  }, [])

  /**
   * Deliberately swallows "no such account". Reporting it would turn the
   * reset form into a way of asking whether a given email has a Scriber
   * account — which, for a tool used by students with disability provisions,
   * is not a question a stranger gets to ask.
   */
  const sendPasswordReset = useCallback(async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email.trim())
    } catch (error) {
      const code = (error as { code?: string })?.code ?? ''
      if (code === 'auth/user-not-found' || code === 'auth/invalid-email') return
      throw new Error(readableError(error))
    }
  }, [])

  const refreshEmailVerified = useCallback(async () => {
    if (!auth.currentUser) return false
    await reload(auth.currentUser)
    const verified = auth.currentUser.emailVerified
    // reload() only updates the User object's own .emailVerified property —
    // Firestore rules read the claim baked into the ID token itself, which
    // still reflects however things stood when it was last minted. Force a
    // fresh one so a write immediately after this call isn't denied.
    if (verified) await auth.currentUser.getIdToken(true)
    setUser((current) => (current ? { ...current, emailVerified: verified } : current))
    // Reloading the org state is what performs the automatic join, if this
    // account was added to a school before it existed — see loadOrgState.
    if (verified) await refreshMemberships()
    return verified
  }, [refreshMemberships])

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
      calibrationTester,
      onboarded,
      orgStateError,
      refreshMemberships,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      saveSettings,
      updateName,
      markOnboarded,
      sendVerificationEmail,
      sendPasswordReset,
      refreshEmailVerified,
    }),
    [
      user,
      settings,
      loading,
      memberships,
      pendingInvites,
      siteAdmin,
      canCreateOrg,
      calibrationTester,
      onboarded,
      orgStateError,
      refreshMemberships,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      saveSettings,
      updateName,
      markOnboarded,
      sendVerificationEmail,
      sendPasswordReset,
      refreshEmailVerified,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.')
  return value
}
