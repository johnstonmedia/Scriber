# Scriber

A practice tool for students approved for a **writer (scribe)** under NESA exam
provisions. Scriber plays the part of the writer: it writes down exactly what
the student dictates — including the punctuation, capitals and paragraph breaks
they say out loud — and nothing they don't.

Upload a past paper, read it on one side of the screen, dictate your answer on
the other, and finish with a report on the habits worth practising.

---

## Why the strict mode matters

Speech recognition tries to be helpful: it capitalises sentences and inserts
full stops on your behalf. That is precisely the assistance a student will not
receive on exam day, so in **strict mode** Scriber deliberately strips it back
out. Your words arrive in lower case, with no punctuation, and the only marks
that reach the page are the ones you said.

Two rule profiles ship, switchable in Settings:

| Profile | Behaviour |
| --- | --- |
| **Strict** (default) | Lower case, no punctuation except what you dictate. Mirrors the scribe rules used where writing conventions are being assessed — the student dictates every mark, and the scribe adds none. |
| **Assisted** | The writer may add punctuation and capitals unprompted. This matches NESA's general rules for HSC writers, which do permit that. The session report counts every mark the writer supplied, so you can see what you would have missed. |

Strict is the harder and safer way to practise. Assisted is there because it is
what the general HSC rules actually allow — check which applies to your course
and your provision before relying on either.

> Scriber is an independent practice tool. It is not affiliated with or endorsed
> by NESA, and it does not replace the writer you are approved to work with.
> Confirm the current rules with your school and NESA's published guidance.

---

## What the student says

Everything not in this table is written down word for word.

**Punctuation** — `full stop`, `comma`, `question mark`, `exclamation mark`,
`semicolon`, `colon`, `apostrophe`, `open quote` / `close quote`,
`open bracket` / `close bracket`, `dash`, `hyphen`, `ellipsis`, `slash`

**Structure** — `new paragraph`, `new line`

**Capitals** — `capital <word>`, `all caps <word>`, `caps on` / `caps off`

**Corrections** — `scratch that`, `delete last word`, `delete last sentence`

**Read back** — `read back` (last two sentences, as a writer may do),
`read back everything`, `stop reading`

So `capital the war ended comma finally full stop new paragraph` becomes:

```
The war ended, finally.

```

The full list, with alternative phrasings, is in the app under **What to say**.

---

## Running it

Requires Node 20+.

```bash
npm install          # installs both workspaces
npm run dev          # API on :4000, web app on :5173
```

Open http://localhost:5173 and create an account.

## Deploying

The server serves the built client from `client/dist`, so one process runs the
whole app on `PORT`.

**Scriber needs a persistent disk.** Accounts, the SQLite database and every
uploaded paper live under `DATA_DIR`. Serverless hosts that discard the
filesystem between requests — Vercel and Netlify functions among them — will
lose all of it, so pick a host that offers a real volume: Fly.io, Railway,
Render, a VPS, or anything running the Docker image below.

For the same reason, run **one instance**. Scaling past a single machine needs
the database moved off the local volume first.

### Docker

```bash
docker compose up --build -d          # reads JWT_SECRET from .env
```

Or directly:

```bash
docker build -t scriber .
docker run -d -p 8080:8080 \
  -v scriber-data:/data \
  -e JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  -e GOOGLE_CLIENT_ID=<optional> \
  scriber
```

### Fly.io

`fly.toml` is included and configured for a Sydney region with a mounted
volume.

```bash
fly launch --no-deploy --copy-config
fly volumes create scriber_data --size 3 --region syd
fly secrets set JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
fly deploy
fly certs add your-domain.com          # Fly issues the TLS certificate
```

Then point the domain at Fly as `fly certs show` instructs — an `A`/`AAAA`
record to the app's IPs, or a `CNAME` for a subdomain.

### Without containers

```bash
npm ci
npm run build
NODE_ENV=production JWT_SECRET=<32+ random chars> npm start
```

Put it behind a TLS-terminating proxy. The session cookie sets the `secure`
flag in production, so sign-in silently fails over plain HTTP.

### Continuous deployment

`.github/workflows/deploy.yml` typechecks, tests and builds every push and pull
request. Add a `FLY_API_TOKEN` repository secret (`fly tokens create deploy`)
and pushes to `main` deploy automatically; without it the deploy step is
skipped and the workflow is just CI.

### Configuration

Copy `server/.env.example` to `server/.env`. Every value has a working default
in development except `JWT_SECRET`, which is **required** once
`NODE_ENV=production` (in development a secret is generated and cached in
`data/`).

### Google sign-in

Email and password work with no setup. To add Google:

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an **OAuth 2.0 Client ID** of type *Web application*.
2. Add your origins to **Authorised JavaScript origins** —
   `http://localhost:5173` for development, plus your deployed origin.
3. Put the client ID in `server/.env` as `GOOGLE_CLIENT_ID`.

The button appears automatically once the server reports a client ID. Signing in
with Google using an email that already has a password account links the two
rather than creating a duplicate.

---

## The stack

- **Backend** — Node + Express + TypeScript, SQLite via `better-sqlite3`.
  Sessions are JWTs in an httpOnly cookie; passwords are bcrypt-hashed. Uploaded
  papers are stored on disk under `DATA_DIR` and served only to the account that
  uploaded them.
- **Frontend** — React + TypeScript + Vite. No UI framework; the design system
  is plain CSS custom properties with light and dark themes.
- **Speech** — the browser's Web Speech API for dictation (Chrome, Edge or
  Safari) and speech synthesis for read-backs. Where speech recognition is
  unavailable, a keyboard box accepts the same dictation, commands and all.
- **Papers** — PDFs render with `pdfjs-dist`; images and text files are also
  accepted.

SQLite keeps deployment to a single process and one file on disk, which suits a
school or an individual student. The data layer is small and confined to
`server/src/routes`, so moving to Postgres later is a contained change.

### Layout

```
client/src/scribe/     the scribe engine — commands, parsing, rendering
client/src/pages/      sign-in, dashboard, exam room, session review, settings
client/src/lib/        API client and auth context
server/src/routes/     auth, papers, attempts
```

### Tests

```bash
npm test
```

The scribe engine is pure `(state, utterance) -> (state, events)`, and its
behaviour is covered by unit tests in `client/src/scribe/engine.test.ts` —
including that recogniser-supplied punctuation is stripped in strict mode, that
`scratch that` removes the right burst, and that read-back returns the last two
sentences.

---

## Privacy

Everything stays on your own server: accounts, uploaded papers and practice
sessions live in `DATA_DIR`. Dictation is processed by the browser's speech
recognition, which on Chrome means audio is sent to Google for transcription —
worth knowing before dictating anything sensitive.
