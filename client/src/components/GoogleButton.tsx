import { useEffect, useRef } from 'react'

type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string
        callback: (response: { credential: string }) => void
      }) => void
      renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
    }
  }
}

let scriptPromise: Promise<void> | null = null

function loadGoogleScript(): Promise<void> {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-gsi]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.gsi = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google sign-in could not be loaded.'))
    document.head.append(script)
  })
  return scriptPromise
}

type Props = {
  clientId: string
  onCredential: (credential: string) => void
  onError: (message: string) => void
}

/** Renders Google's own "Sign in with Google" button. */
export function GoogleButton({ clientId, onCredential, onError }: Props) {
  const holder = useRef<HTMLDivElement>(null)
  // Keep the latest callbacks without re-rendering Google's button.
  const callbacks = useRef({ onCredential, onError })
  callbacks.current = { onCredential, onError }

  useEffect(() => {
    let cancelled = false
    loadGoogleScript()
      .then(() => {
        if (cancelled || !holder.current) return
        const google = (window as unknown as { google?: GoogleIdentity }).google
        if (!google) throw new Error('Google sign-in is unavailable.')
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => callbacks.current.onCredential(response.credential),
        })
        google.accounts.id.renderButton(holder.current, {
          theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          width: 360,
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
        })
      })
      .catch((error: Error) => !cancelled && callbacks.current.onError(error.message))

    return () => {
      cancelled = true
    }
  }, [clientId])

  return <div ref={holder} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />
}
