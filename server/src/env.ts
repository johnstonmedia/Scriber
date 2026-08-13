import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/** Minimal .env loader — keeps the server dependency-light. */
function loadDotEnv() {
  const file = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadDotEnv()

const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR ?? 'data')
fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true })

/**
 * In development we persist a generated secret so restarts don't log everyone
 * out. In production a real secret must be supplied.
 */
function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET
  if (fromEnv && fromEnv.length >= 16) return fromEnv

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET must be set (32+ random characters) when NODE_ENV=production.',
    )
  }

  const cached = path.join(dataDir, '.dev-jwt-secret')
  if (fs.existsSync(cached)) return fs.readFileSync(cached, 'utf8')
  const generated = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(cached, generated, { mode: 0o600 })
  console.warn('[scriber] No JWT_SECRET set — generated a development secret in data/.')
  return generated
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  isProduction: process.env.NODE_ENV === 'production',
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  dbFile: path.join(dataDir, 'scriber.db'),
  jwtSecret: resolveJwtSecret(),
  /** Vite dev server origin, allowed through CORS with credentials. */
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024),
}
