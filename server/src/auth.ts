import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env } from './env.js'
import { db, type UserRow } from './db.js'

const COOKIE_NAME = 'scriber_session'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export type PublicUser = {
  id: string
  email: string
  name: string
  picture: string | null
  settings: Record<string, unknown>
  hasPassword: boolean
  linkedGoogle: boolean
}

export function toPublicUser(row: UserRow): PublicUser {
  let settings: Record<string, unknown> = {}
  try {
    settings = JSON.parse(row.settings) as Record<string, unknown>
  } catch {
    settings = {}
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    picture: row.picture,
    settings,
    hasPassword: row.password_hash !== null,
    linkedGoogle: row.google_sub !== null,
  }
}

export function issueSession(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: '30d' })
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    maxAge: MAX_AGE_MS,
    path: '/',
  })
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/' })
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow
    }
  }
}

function readUser(req: Request): UserRow | null {
  const token = req.cookies?.[COOKIE_NAME]
  if (!token) return null
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub?: string }
    if (!payload.sub) return null
    const row = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(payload.sub) as UserRow | undefined
    return row ?? null
  } catch {
    return null
  }
}

/** Attaches req.user when a valid session cookie is present. */
export function withUser(req: Request, _res: Response, next: NextFunction) {
  const user = readUser(req)
  if (user) req.user = user
  next()
}

/** Rejects the request unless signed in. */
export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Not signed in.' })
    return
  }
  next()
}
