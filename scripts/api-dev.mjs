/**
 * Runs the Vercel API routes locally, against the emulators.
 *
 * Vercel's own routing only exists on Vercel, so without this the backend
 * could only ever be exercised by deploying it — which is a poor place to
 * find out that pairing is broken. This maps /api/<path> onto the matching
 * file in api/ with the same request and response objects Vercel passes, so
 * the handlers run unmodified.
 *
 * Dev only. Nothing here ships.
 */

import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099'
process.env.GCLOUD_PROJECT ??= 'demo-scriber'
process.env.PUBLIC_ROOT_DOMAIN ??= 'localhost'

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'api')
const PORT = Number(process.env.API_PORT ?? 5174)

/** Reads the body Vercel would have parsed for us. */
function readBody(req) {
  return new Promise((done) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return done(undefined)
      try {
        done(JSON.parse(raw))
      } catch {
        done(raw)
      }
    })
  })
}

/** The handful of VercelResponse methods the routes actually use. */
function decorate(res) {
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
    return res
  }
  Object.defineProperty(res, 'writableEnded', {
    get: () => res.finished || res.writableFinished,
    configurable: true,
  })
  return res
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (!url.pathname.startsWith('/api/')) {
    res.statusCode = 404
    res.end('not an api route')
    return
  }

  const route = url.pathname.slice('/api/'.length)
  const candidate = join(API_DIR, `${route}.ts`)
  if (!existsSync(candidate)) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'no-such-route', route }))
    return
  }

  try {
    const module = await import(pathToFileURL(candidate).href)
    req.query = Object.fromEntries(url.searchParams)
    req.body = await readBody(req)
    await module.default(req, decorate(res))
  } catch (error) {
    console.error(`api ${route} threw`, error)
    if (!res.writableEnded) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'internal', message: String(error) }))
    }
  }
})

server.listen(PORT, () => console.log(`api dev server on http://localhost:${PORT}`))
