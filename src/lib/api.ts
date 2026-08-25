/**
 * Calling Scriber's own backend as the signed-in user.
 *
 * Every route that needs to know who is asking takes a Firebase ID token as a
 * bearer header. That was written out by hand at each call site, which is
 * three lines each time and one of them — refreshing an expired token — is
 * easy to leave out and impossible to notice until somebody has been sitting
 * on the same page for an hour.
 */

import { auth } from './firebase'

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

type Options = {
  method?: 'GET' | 'POST'
  body?: unknown
  signal?: AbortSignal
}

export async function authedFetch<T>(path: string, options: Options = {}): Promise<T> {
  const user = auth.currentUser
  if (!user) throw new ApiError(401, 'signed-out', 'Sign in and try again.')

  // getIdToken refreshes when the token is close to expiry, which is the
  // whole reason this lives in one place.
  const token = await user.getIdToken()

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  })

  if (!response.ok) {
    // The routes answer with { error, message } — see api/_lib/http.ts.
    // Anything that doesn't is something upstream, and its body is not for
    // the user.
    let code = 'request-failed'
    let message = 'That did not work. Try again in a moment.'
    try {
      const body = (await response.json()) as { error?: string; message?: string }
      if (body.error) code = body.error
      if (body.message) message = body.message
    } catch {
      /* not JSON — keep the generic message */
    }
    throw new ApiError(response.status, code, message)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
