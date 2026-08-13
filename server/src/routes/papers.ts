import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { db, type PaperRow } from '../db.js'
import { env } from '../env.js'
import { requireUser } from '../auth.js'

export const papersRouter = Router()

const ALLOWED = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
])

const upload = multer({
  limits: { fileSize: env.maxUploadBytes, files: 1 },
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, env.uploadDir),
    // Generated name only — the original filename never touches the filesystem.
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10).replace(/[^A-Za-z0-9.]/g, '')
      cb(null, `${randomUUID()}${ext}`)
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      cb(new Error('Upload a PDF, image, or text file.'))
      return
    }
    cb(null, true)
  },
})

function toPaper(row: PaperRow) {
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    year: row.year,
    readingMinutes: row.reading_minutes,
    workingMinutes: row.working_minutes,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    fileUrl: `/api/papers/${row.id}/file`,
  }
}

papersRouter.use(requireUser)

papersRouter.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM papers WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user!.id) as PaperRow[]
  res.json({ papers: rows.map(toPaper) })
})

const paperMeta = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  subject: z.string().trim().max(80).optional(),
  year: z.coerce.number().int().min(1980).max(2100).optional(),
  readingMinutes: z.coerce.number().int().min(0).max(60).optional(),
  workingMinutes: z.coerce.number().int().min(1).max(600).optional(),
})

papersRouter.post('/', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Choose an exam paper to upload.' })
    return
  }
  const parsed = paperMeta.safeParse(req.body)
  if (!parsed.success) {
    fs.rmSync(req.file.path, { force: true })
    res.status(400).json({ error: 'Check the paper details and try again.' })
    return
  }

  const id = randomUUID()
  // The browser-supplied filename is data, not a path — strip any directory parts.
  const originalName = path.basename(req.file.originalname).slice(0, 160)
  const title = parsed.data.title?.trim() || originalName.replace(/\.[^.]+$/, '')

  db.prepare(
    `INSERT INTO papers
       (id, user_id, title, subject, year, reading_minutes, working_minutes,
        file_name, mime_type, byte_size, storage_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    req.user!.id,
    title,
    parsed.data.subject ?? null,
    parsed.data.year ?? null,
    parsed.data.readingMinutes ?? 5,
    parsed.data.workingMinutes ?? 120,
    originalName,
    req.file.mimetype,
    req.file.size,
    path.basename(req.file.filename),
    new Date().toISOString(),
  )

  const row = db.prepare('SELECT * FROM papers WHERE id = ?').get(id) as PaperRow
  res.status(201).json({ paper: toPaper(row) })
})

papersRouter.patch('/:id', (req, res) => {
  const row = db
    .prepare('SELECT * FROM papers WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as PaperRow | undefined
  if (!row) {
    res.status(404).json({ error: 'Paper not found.' })
    return
  }
  const parsed = paperMeta.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Check the paper details and try again.' })
    return
  }
  const next = parsed.data
  db.prepare(
    `UPDATE papers SET title = ?, subject = ?, year = ?, reading_minutes = ?, working_minutes = ?
     WHERE id = ?`,
  ).run(
    next.title?.trim() || row.title,
    next.subject ?? row.subject,
    next.year ?? row.year,
    next.readingMinutes ?? row.reading_minutes,
    next.workingMinutes ?? row.working_minutes,
    row.id,
  )
  const updated = db.prepare('SELECT * FROM papers WHERE id = ?').get(row.id) as PaperRow
  res.json({ paper: toPaper(updated) })
})

papersRouter.get('/:id/file', (req, res) => {
  const row = db
    .prepare('SELECT * FROM papers WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as PaperRow | undefined
  if (!row) {
    res.status(404).json({ error: 'Paper not found.' })
    return
  }
  // storage_key is a generated UUID filename, but resolve-and-check anyway so a
  // tampered row can never read outside the upload directory.
  const filePath = path.resolve(env.uploadDir, row.storage_key)
  if (!filePath.startsWith(path.resolve(env.uploadDir) + path.sep) || !fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File is no longer available.' })
    return
  }
  res.setHeader('Content-Type', row.mime_type)
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.file_name)}"`)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  fs.createReadStream(filePath).pipe(res)
})

papersRouter.delete('/:id', (req, res) => {
  const row = db
    .prepare('SELECT * FROM papers WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as PaperRow | undefined
  if (!row) {
    res.status(404).json({ error: 'Paper not found.' })
    return
  }
  db.prepare('DELETE FROM papers WHERE id = ?').run(row.id)
  const filePath = path.resolve(env.uploadDir, row.storage_key)
  if (filePath.startsWith(path.resolve(env.uploadDir) + path.sep)) {
    fs.rmSync(filePath, { force: true })
  }
  res.json({ ok: true })
})
