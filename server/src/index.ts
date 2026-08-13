import fs from 'node:fs'
import path from 'node:path'
import express, { type ErrorRequestHandler } from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import multer from 'multer'
import { env } from './env.js'
import { withUser } from './auth.js'
import { authRouter } from './routes/auth.js'
import { papersRouter } from './routes/papers.js'
import { attemptsRouter } from './routes/attempts.js'

const app = express()

app.disable('x-powered-by')
app.set('trust proxy', 1)

app.use(
  cors({
    origin: env.clientOrigin,
    credentials: true,
  }),
)
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())
app.use(withUser)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, googleEnabled: Boolean(env.googleClientId) })
})

app.use('/api/auth', authRouter)
app.use('/api/papers', papersRouter)
app.use('/api/attempts', attemptsRouter)

// Serve the built client when it exists, so `npm start` runs the whole app.
const clientDist = path.resolve(process.cwd(), '../client/dist')
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist))
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `That file is too large. The limit is ${Math.round(env.maxUploadBytes / 1024 / 1024)} MB.`
        : 'Upload failed.'
    res.status(400).json({ error: message })
    return
  }
  if (err instanceof Error && err.message.startsWith('Upload a PDF')) {
    res.status(400).json({ error: err.message })
    return
  }
  console.error('[scriber]', err)
  res.status(500).json({ error: 'Something went wrong on the server.' })
}
app.use(onError)

app.listen(env.port, () => {
  console.log(`[scriber] API listening on http://localhost:${env.port}`)
  if (!env.googleClientId) {
    console.log('[scriber] GOOGLE_CLIENT_ID not set — Google sign-in is hidden.')
  }
})
