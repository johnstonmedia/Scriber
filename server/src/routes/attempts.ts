import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { db, type AttemptRow } from '../db.js'
import { requireUser } from '../auth.js'

export const attemptsRouter = Router()

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function toAttempt(row: AttemptRow, options: { includeBody: boolean }) {
  const base = {
    id: row.id,
    paperId: row.paper_id,
    title: row.title,
    ruleProfile: row.rule_profile,
    stats: parseJson<Record<string, unknown>>(row.stats, {}),
    durationMs: row.duration_ms,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  if (!options.includeBody) return base
  return {
    ...base,
    answerText: row.answer_text,
    atoms: parseJson<unknown[]>(row.atoms, []),
    log: parseJson<unknown[]>(row.log, []),
  }
}

const attemptBody = z.object({
  paperId: z.string().uuid().nullish(),
  title: z.string().trim().min(1).max(160),
  ruleProfile: z.enum(['strict', 'assisted']),
  answerText: z.string().max(400_000).optional(),
  atoms: z.array(z.unknown()).max(200_000).optional(),
  log: z.array(z.unknown()).max(50_000).optional(),
  stats: z.record(z.string(), z.unknown()).optional(),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
  status: z.enum(['in_progress', 'finished']).optional(),
})

attemptsRouter.use(requireUser)

attemptsRouter.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 200')
    .all(req.user!.id) as AttemptRow[]
  res.json({ attempts: rows.map((row) => toAttempt(row, { includeBody: false })) })
})

attemptsRouter.get('/:id', (req, res) => {
  const row = db
    .prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as AttemptRow | undefined
  if (!row) {
    res.status(404).json({ error: 'Practice session not found.' })
    return
  }
  res.json({ attempt: toAttempt(row, { includeBody: true }) })
})

attemptsRouter.post('/', (req, res) => {
  const parsed = attemptBody.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Could not save this practice session.' })
    return
  }
  const data = parsed.data

  if (data.paperId) {
    const owns = db
      .prepare('SELECT 1 FROM papers WHERE id = ? AND user_id = ?')
      .get(data.paperId, req.user!.id)
    if (!owns) {
      res.status(404).json({ error: 'Paper not found.' })
      return
    }
  }

  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO attempts
       (id, user_id, paper_id, title, rule_profile, answer_text, atoms, stats, log,
        duration_ms, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    req.user!.id,
    data.paperId ?? null,
    data.title,
    data.ruleProfile,
    data.answerText ?? '',
    JSON.stringify(data.atoms ?? []),
    JSON.stringify(data.stats ?? {}),
    JSON.stringify(data.log ?? []),
    data.durationMs ?? 0,
    data.status ?? 'in_progress',
    now,
    now,
  )

  const row = db.prepare('SELECT * FROM attempts WHERE id = ?').get(id) as AttemptRow
  res.status(201).json({ attempt: toAttempt(row, { includeBody: true }) })
})

attemptsRouter.patch('/:id', (req, res) => {
  const row = db
    .prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as AttemptRow | undefined
  if (!row) {
    res.status(404).json({ error: 'Practice session not found.' })
    return
  }
  const parsed = attemptBody.partial().safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Could not save this practice session.' })
    return
  }
  const d = parsed.data

  db.prepare(
    `UPDATE attempts SET
       title = ?, rule_profile = ?, answer_text = ?, atoms = ?, stats = ?, log = ?,
       duration_ms = ?, status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    d.title ?? row.title,
    d.ruleProfile ?? row.rule_profile,
    d.answerText ?? row.answer_text,
    d.atoms ? JSON.stringify(d.atoms) : row.atoms,
    d.stats ? JSON.stringify(d.stats) : row.stats,
    d.log ? JSON.stringify(d.log) : row.log,
    d.durationMs ?? row.duration_ms,
    d.status ?? row.status,
    new Date().toISOString(),
    row.id,
  )

  const updated = db.prepare('SELECT * FROM attempts WHERE id = ?').get(row.id) as AttemptRow
  res.json({ attempt: toAttempt(updated, { includeBody: true }) })
})

attemptsRouter.delete('/:id', (req, res) => {
  const result = db
    .prepare('DELETE FROM attempts WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user!.id)
  if (result.changes === 0) {
    res.status(404).json({ error: 'Practice session not found.' })
    return
  }
  res.json({ ok: true })
})
