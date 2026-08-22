/**
 * The small amount of plumbing every route repeats: JSON in, JSON out, one
 * method, and errors that say what went wrong without leaking a stack trace
 * to whoever asked.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

/** A failure the caller is allowed to see the reason for. */
export class HttpError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message?: string) {
    super(message ?? code)
    this.status = status
    this.code = code
  }
}

/**
 * The Chrome extension calls these routes from a chrome-extension:// origin,
 * which is opaque and can't be predicted per-install. Every extension route
 * authenticates by bearer token rather than by origin, so reflecting the
 * origin is safe here — the token is what grants access, not where the
 * request came from. Browsers never attach cookies to these calls, so there
 * is no cross-site request forgery surface to protect.
 */
function applyCors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin
  res.setHeader('Access-Control-Allow-Origin', typeof origin === 'string' ? origin : '*')
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '86400')
}

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<unknown>

/**
 * Wraps a route: sets CORS, answers preflight, enforces the method, and turns
 * whatever the handler returns into a JSON body. An HttpError becomes its own
 * status and code; anything else is logged and reported as a plain 500, since
 * an unexpected failure's message is for us, not for the caller.
 */
export function route(method: 'GET' | 'POST', handler: Handler) {
  return async (req: VercelRequest, res: VercelResponse) => {
    applyCors(req, res)
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    if (req.method !== method) {
      res.status(405).json({ error: 'method-not-allowed' })
      return
    }
    try {
      const body = await handler(req, res)
      if (res.writableEnded) return
      res.status(200).json(body ?? { ok: true })
    } catch (error) {
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.code, message: error.message })
        return
      }
      console.error('Unhandled API error', error)
      res.status(500).json({ error: 'internal' })
    }
  }
}

/** Reads a JSON body whether the platform parsed it for us or not. */
export function jsonBody(req: VercelRequest): Record<string, unknown> {
  const raw = req.body
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'bad-json', 'The request body is not valid JSON.')
    }
  }
  return raw as Record<string, unknown>
}

export function requireString(source: Record<string, unknown>, key: string, max = 512): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, 'missing-field', `"${key}" is required.`)
  }
  if (value.length > max) {
    throw new HttpError(400, 'field-too-long', `"${key}" is longer than ${max} characters.`)
  }
  return value.trim()
}
