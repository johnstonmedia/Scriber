import Database from 'better-sqlite3'
import { env } from './env.js'

export const db = new Database(env.dbFile)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    password_hash  TEXT,
    google_sub     TEXT UNIQUE,
    picture        TEXT,
    settings       TEXT NOT NULL DEFAULT '{}',
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS papers (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    subject      TEXT,
    year         INTEGER,
    reading_minutes INTEGER NOT NULL DEFAULT 5,
    working_minutes INTEGER NOT NULL DEFAULT 120,
    file_name    TEXT NOT NULL,
    mime_type    TEXT NOT NULL,
    byte_size    INTEGER NOT NULL,
    storage_key  TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attempts (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    paper_id     TEXT REFERENCES papers(id) ON DELETE SET NULL,
    title        TEXT NOT NULL,
    rule_profile TEXT NOT NULL,
    answer_text  TEXT NOT NULL DEFAULT '',
    atoms        TEXT NOT NULL DEFAULT '[]',
    stats        TEXT NOT NULL DEFAULT '{}',
    log          TEXT NOT NULL DEFAULT '[]',
    duration_ms  INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'in_progress',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_papers_user   ON papers(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, created_at DESC);
`)

export type UserRow = {
  id: string
  email: string
  name: string
  password_hash: string | null
  google_sub: string | null
  picture: string | null
  settings: string
  created_at: string
}

export type PaperRow = {
  id: string
  user_id: string
  title: string
  subject: string | null
  year: number | null
  reading_minutes: number
  working_minutes: number
  file_name: string
  mime_type: string
  byte_size: number
  storage_key: string
  created_at: string
}

export type AttemptRow = {
  id: string
  user_id: string
  paper_id: string | null
  title: string
  rule_profile: string
  answer_text: string
  atoms: string
  stats: string
  log: string
  duration_ms: number
  status: string
  created_at: string
  updated_at: string
}
