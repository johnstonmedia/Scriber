import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { OAuth2Client } from 'google-auth-library'
import { z } from 'zod'
import { db, type UserRow } from '../db.js'
import { env } from '../env.js'
import { clearSession, issueSession, requireUser, toPublicUser } from '../auth.js'

export const authRouter = Router()

const googleClient = env.googleClientId ? new OAuth2Client(env.googleClientId) : null

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
  name: z.string().trim().min(1).max(80).optional(),
})

function findByEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
}

function nameFromEmail(email: string) {
  const local = email.split('@')[0]!.replace(/[._-]+/g, ' ')
  return local.replace(/\b\w/g, (c) => c.toUpperCase())
}

authRouter.post('/register', async (req, res) => {
  const parsed = credentials.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid details.' })
    return
  }
  const { email, password, name } = parsed.data

  if (findByEmail(email)) {
    res.status(409).json({ error: 'An account already exists for that email.' })
    return
  }

  const id = randomUUID()
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, settings, created_at)
     VALUES (?, ?, ?, ?, '{}', ?)`,
  ).run(id, email, name?.trim() || nameFromEmail(email), await bcrypt.hash(password, 12), new Date().toISOString())

  issueSession(res, id)
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow
  res.status(201).json({ user: toPublicUser(row) })
})

authRouter.post('/login', async (req, res) => {
  const parsed = credentials.omit({ name: true }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter your email and password.' })
    return
  }
  const { email, password } = parsed.data
  const row = findByEmail(email)

  // Compare against a dummy hash when the account is missing so that a wrong
  // email and a wrong password take the same amount of time to answer.
  const hash = row?.password_hash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin'
  const ok = await bcrypt.compare(password, hash)

  if (!row || !row.password_hash || !ok) {
    res.status(401).json({
      error: row && !row.password_hash
        ? 'That account uses Google sign-in. Continue with Google instead.'
        : 'Email or password is incorrect.',
    })
    return
  }

  issueSession(res, row.id)
  res.json({ user: toPublicUser(row) })
})

authRouter.post('/google', async (req, res) => {
  if (!googleClient) {
    res.status(503).json({ error: 'Google sign-in is not configured on this server.' })
    return
  }
  const credential = z.string().min(10).safeParse(req.body?.credential)
  if (!credential.success) {
    res.status(400).json({ error: 'Missing Google credential.' })
    return
  }

  let payload
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential.data,
      audience: env.googleClientId,
    })
    payload = ticket.getPayload()
  } catch {
    res.status(401).json({ error: 'Google sign-in could not be verified.' })
    return
  }

  if (!payload?.sub || !payload.email || !payload.email_verified) {
    res.status(401).json({ error: 'Google account has no verified email address.' })
    return
  }

  const email = payload.email.toLowerCase()
  const now = new Date().toISOString()
  let row = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(payload.sub) as
    | UserRow
    | undefined

  if (!row) {
    const existing = findByEmail(email)
    if (existing) {
      // Same person signing in a second way — link Google to the existing account.
      db.prepare('UPDATE users SET google_sub = ?, picture = COALESCE(picture, ?) WHERE id = ?')
        .run(payload.sub, payload.picture ?? null, existing.id)
      row = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as UserRow
    } else {
      const id = randomUUID()
      db.prepare(
        `INSERT INTO users (id, email, name, google_sub, picture, settings, created_at)
         VALUES (?, ?, ?, ?, ?, '{}', ?)`,
      ).run(id, email, payload.name ?? nameFromEmail(email), payload.sub, payload.picture ?? null, now)
      row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow
    }
  }

  issueSession(res, row.id)
  res.json({ user: toPublicUser(row) })
})

authRouter.post('/logout', (_req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

authRouter.get('/me', (req, res) => {
  res.json({
    user: req.user ? toPublicUser(req.user) : null,
    googleEnabled: Boolean(env.googleClientId),
    googleClientId: env.googleClientId || null,
  })
})

const profileUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

authRouter.patch('/me', requireUser, (req, res) => {
  const parsed = profileUpdate.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid profile update.' })
    return
  }
  const user = req.user!
  const name = parsed.data.name ?? user.name
  const settings = parsed.data.settings
    ? JSON.stringify(parsed.data.settings)
    : user.settings

  db.prepare('UPDATE users SET name = ?, settings = ? WHERE id = ?').run(name, settings, user.id)
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow
  res.json({ user: toPublicUser(row) })
})
