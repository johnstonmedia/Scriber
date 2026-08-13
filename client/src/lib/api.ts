/**
 * Thin wrapper over the Node API. Every request carries the session cookie.
 */

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      ...init,
      headers:
        init.body instanceof FormData
          ? init.headers
          : { 'Content-Type': 'application/json', ...init.headers },
    })
  } catch {
    throw new ApiError('Cannot reach the Scriber server. Is it running?', 0)
  }

  if (response.status === 204) return undefined as T

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ?? 'Something went wrong.'
    throw new ApiError(message, response.status)
  }
  return payload as T
}

export type User = {
  id: string
  email: string
  name: string
  picture: string | null
  settings: Record<string, unknown>
  hasPassword: boolean
  linkedGoogle: boolean
}

export type Paper = {
  id: string
  title: string
  subject: string | null
  year: number | null
  readingMinutes: number
  workingMinutes: number
  fileName: string
  mimeType: string
  byteSize: number
  createdAt: string
  fileUrl: string
}

export type AttemptSummary = {
  id: string
  paperId: string | null
  title: string
  ruleProfile: 'strict' | 'assisted'
  stats: Record<string, never> | Record<string, unknown>
  durationMs: number
  status: 'in_progress' | 'finished'
  createdAt: string
  updatedAt: string
}

export type Attempt = AttemptSummary & {
  answerText: string
  atoms: unknown[]
  log: unknown[]
}

export const api = {
  session: () =>
    request<{ user: User | null; googleEnabled: boolean; googleClientId: string | null }>(
      '/auth/me',
    ),

  register: (body: { email: string; password: string; name?: string }) =>
    request<{ user: User }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),

  login: (body: { email: string; password: string }) =>
    request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  loginWithGoogle: (credential: string) =>
    request<{ user: User }>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    }),

  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  updateProfile: (body: { name?: string; settings?: Record<string, unknown> }) =>
    request<{ user: User }>('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),

  papers: () => request<{ papers: Paper[] }>('/papers'),

  uploadPaper: (form: FormData) =>
    request<{ paper: Paper }>('/papers', { method: 'POST', body: form }),

  updatePaper: (id: string, body: Record<string, unknown>) =>
    request<{ paper: Paper }>(`/papers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deletePaper: (id: string) => request<{ ok: true }>(`/papers/${id}`, { method: 'DELETE' }),

  attempts: () => request<{ attempts: AttemptSummary[] }>('/attempts'),

  attempt: (id: string) => request<{ attempt: Attempt }>(`/attempts/${id}`),

  createAttempt: (body: Record<string, unknown>) =>
    request<{ attempt: Attempt }>('/attempts', { method: 'POST', body: JSON.stringify(body) }),

  updateAttempt: (id: string, body: Record<string, unknown>) =>
    request<{ attempt: Attempt }>(`/attempts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteAttempt: (id: string) => request<{ ok: true }>(`/attempts/${id}`, { method: 'DELETE' }),

  /** The paper file needs the cookie too, so fetch it as a blob URL. */
  paperBlobUrl: async (paper: Paper) => {
    const response = await fetch(`${BASE}/papers/${paper.id}/file`, {
      credentials: 'include',
    })
    if (!response.ok) throw new ApiError('Could not open that paper.', response.status)
    return URL.createObjectURL(await response.blob())
  },
}
