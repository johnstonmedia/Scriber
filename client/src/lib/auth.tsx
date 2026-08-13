import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, type User } from './api'

export type Settings = {
  ruleProfile: 'strict' | 'assisted'
  readBackRate: number
  recogniserLanguage: string
  showLiveText: boolean
  fontSize: 'small' | 'medium' | 'large'
}

export const DEFAULT_SETTINGS: Settings = {
  ruleProfile: 'strict',
  readBackRate: 0.95,
  recogniserLanguage: 'en-AU',
  showLiveText: true,
  fontSize: 'medium',
}

type AuthValue = {
  user: User | null
  settings: Settings
  loading: boolean
  googleEnabled: boolean
  googleClientId: string | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name?: string) => Promise<void>
  signInWithGoogle: (credential: string) => Promise<void>
  signOut: () => Promise<void>
  saveSettings: (next: Partial<Settings>) => Promise<void>
  updateName: (name: string) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

function settingsOf(user: User | null): Settings {
  return { ...DEFAULT_SETTINGS, ...((user?.settings ?? {}) as Partial<Settings>) }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [googleEnabled, setGoogleEnabled] = useState(false)
  const [googleClientId, setGoogleClientId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .session()
      .then((data) => {
        if (cancelled) return
        setUser(data.user)
        setGoogleEnabled(data.googleEnabled)
        setGoogleClientId(data.googleClientId)
      })
      .catch(() => {
        /* Offline or server down — the login screen surfaces it on submit. */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { user } = await api.login({ email, password })
    setUser(user)
  }, [])

  const signUp = useCallback(async (email: string, password: string, name?: string) => {
    const { user } = await api.register({ email, password, name })
    setUser(user)
  }, [])

  const signInWithGoogle = useCallback(async (credential: string) => {
    const { user } = await api.loginWithGoogle(credential)
    setUser(user)
  }, [])

  const signOut = useCallback(async () => {
    await api.logout()
    setUser(null)
  }, [])

  const saveSettings = useCallback(
    async (next: Partial<Settings>) => {
      const merged = { ...settingsOf(user), ...next }
      // Update locally first so switches feel instant.
      setUser((current) => (current ? { ...current, settings: merged } : current))
      const { user: saved } = await api.updateProfile({ settings: merged })
      setUser(saved)
    },
    [user],
  )

  const updateName = useCallback(async (name: string) => {
    const { user } = await api.updateProfile({ name })
    setUser(user)
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      settings: settingsOf(user),
      loading,
      googleEnabled,
      googleClientId,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      saveSettings,
      updateName,
    }),
    [user, loading, googleEnabled, googleClientId, signIn, signUp, signInWithGoogle, signOut, saveSettings, updateName],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.')
  return value
}
