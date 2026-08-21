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

## Your writer is a person, not a machine

A transcription tool writes every word the instant you say it and never gets
tired. Practising against that teaches a pace no real writer could survive. So
Scriber's writer has human limits, and you have to work with them:

**They're always a beat behind.** Words appear a moment after you say them, and
land at writing pace rather than all at once.

**They can only hold so much.** A gauge under the exam bar fills as your
backlog grows — green while they're keeping up, amber as they fall behind, red
when they're about to lose it. Keep talking through the red and they lose what
they couldn't hold, then stop you: *"Sorry — could you say that again? Carry on
from 'represents discovery as unsettling'."* That is exactly what happens in a
real exam room, and the fix is the same: pause at your punctuation.

**They occasionally check a spelling.** Now and then, on a long or unusual
word, the writer stops and asks you to spell it out — which NESA's rules
expressly permit them to do. The word is held as a blank until you answer, so
the prompt never shows you the letters. Say the letters or type them. Where
spelling is being assessed, what you spell is what gets written.

Three writers are available in Settings:

| Writer | Holds | Starts writing after | Interrupts |
| --- | --- | --- | --- |
| Patient | ~28 words | 0.5s | rarely |
| Realistic (default) | ~18 words | 0.7s | occasionally |
| Demanding | ~12 words | 0.9s | often |

Spelling questions never fire in the first 45 seconds, never twice within two
minutes, and are capped per session — a real writer settles into the rhythm
before they start interrupting.

## The stack

Scriber is a **static site backed by Firebase**, so there is no server to run or
pay for.

- **React + TypeScript + Vite** — no UI framework; the design system is plain
  CSS custom properties with light and dark themes.
- **Firebase Auth** — Google sign-in and email/password.
- **Cloud Firestore** — settings, paper metadata, practice sessions, and
  organisation-distributed papers as extracted text.
- **IndexedDB** — a student's own exam paper files, held on their own device.
  They are never uploaded; only a paper's details go to Firestore.
- **Web Speech API** — dictation (Chrome, Edge or Safari) and read-backs. Where
  speech recognition is unavailable, a keyboard box accepts the same dictation,
  commands and all.
- **pdfjs-dist** — renders PDF papers; images and text files also work.

Everything a student owns lives under their own user document:

```
users/{uid}
users/{uid}/papers/{paperId}
users/{uid}/attempts/{attemptId}
```

which reduces the security rules to a single ownership check. `firestore.rules`
denies everything else, including any path outside that tree. There is no
Cloud Storage bucket at all — an organisation's distributed papers are parsed
into text client-side and stored in Firestore the same as everything else
(see "Organisations" below), so Scriber runs on Firestore and Auth alone.

### Layout

```
src/scribe/      the scribe engine — commands, parsing, rendering
src/pages/       sign-in, dashboard, exam room, session review, settings
src/lib/         firebase setup, auth context, Firestore access, local file store
scripts/         security-rule checks and an end-to-end browser run
```

---

## Setting up Firebase

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Authentication → Sign-in method** — enable **Email/Password** and **Google**.
3. **Firestore Database** — create one (production mode; the rules in this repo
   replace the defaults).
4. **Project settings → Your apps → Web app** — register one and copy the config.
5. Copy `.env.example` to `.env` and paste the values in, or edit the defaults in
   `src/lib/firebase.ts`.

A student's own exam papers never leave the device, and an organisation's
*distributed* papers are parsed into text client-side and stored in Firestore
(see "Organisations" below) — nothing here needs Cloud Storage or the Blaze
plan; the free Spark tier is enough.

Then publish the rules and indexes:

```bash
npx firebase login
npx firebase deploy --only firestore:rules,firestore:indexes
```

`firestore:indexes` matters as much as the rules do — two of the organisation
queries (`listMyMemberships`, `listMyPendingInvites`) are collection-group
queries that Firestore refuses to run without their index deployed. Skipping
this step doesn't error visibly: a user's own organisation just silently
fails to show up as theirs, and the directory offers them "Request access"
to something they already created or joined. Re-run this command any time
`firestore.indexes.json` changes, and give a newly-created index a minute or
two to finish building in the Firebase console before relying on it.

Once deployed, add each domain you serve from under **Authentication →
Settings → Authorised domains**, or Google sign-in will refuse to run there.

### Sitting a live test

A test is set up by a teacher against one class: a paper, reading and working
time, the rule profile, and a date and time. Students see it on their
dashboard as an upcoming assessment; the waiting room opens five minutes
before the scheduled time and not a moment earlier.

A live test is not practice with a shared clock. In one:

- **The questions do not exist on the student's device until the test
  starts.** A test snapshots its paper into `tests/{testId}/secure/paper`,
  which `firestore.rules` refuses to serve a student until the test's own
  `phase` leaves the lobby. This is the part that matters: it isn't the UI
  hiding text that was already fetched — the text is never sent, so there is
  nothing in memory, in a network response, or in a React tree to go looking
  for. (Once the test *is* running the questions are on screen, and therefore
  in the page. No browser app can do better than that.)
- **Reading time is enforced.** The writer takes nothing down until the
  teacher moves the class into working time.
- **There is no typing.** The keyboard fallback that practice mode offers is
  absent — a test is dictation or nothing.
- **Nobody hands up early.** Finish stays locked until working time is over,
  or the teacher ends the test for everyone.
- **Only a teacher can pause a student**, for a set number of minutes or
  until they resume them by hand. A pause covers the paper, stops the writer,
  and pushes the deadline out so no working time is lost. A student cannot
  write their own pause fields at all; the rules see to that, not the UI.

The teacher's monitor shows who has logged on, live word counts, a preview of
each answer (click a name to enlarge it), and a running integrity feed.

**What the integrity feed can and cannot see.** It reports what a browser is
allowed to say about its own tab: losing focus or being hidden, copy, cut and
paste, the context menu, and the key combinations that open dev tools. It
also notices the viewport gap that docked dev tools create. It cannot see the
student's other tabs or their other applications by name — no website can;
that is walled off from web content by the browser itself. Anything claiming
otherwise is a native lockdown application, not a web app.

### Screen sharing

Sitting a live test means sharing your screen for its whole length. The
student is asked in the waiting room and must pick their **entire screen** —
a single tab is refused, since a supervisor who can see only the exam can't
see anything worth seeing. Stopping the share mid-test raises an alert and a
banner that won't go away until it's running again. This is how a supervisor
sees the other applications the integrity feed can't name.

The video is a direct browser-to-browser connection and is never recorded or
stored. Firestore carries only the handshake that introduces the two sides,
under the student's own participant document, readable by nobody else.

Two browsers on the same school network can usually reach each other
directly, and then no server is involved at all. Where the network won't
allow it — which is common on school wifi — the connection needs a **TURN
relay**, and that is the one part of Scriber that needs a real backend:

1. Get a TURN server. Any coturn instance works, as do hosted providers
   (Metered, Twilio, Cloudflare) — what matters is that it supports the
   standard TURN REST scheme with a shared secret.
2. Set `TURN_URLS` (comma-separated, e.g.
   `turn:turn.example.com:3478,turns:turn.example.com:5349`) and `TURN_SECRET`
   in the Vercel project's environment variables.
3. Redeploy. `api/ice-servers.ts` starts minting twelve-hour credentials from
   that secret, so the secret itself never reaches a browser.

With those unset the endpoint returns STUN only and sharing still works
wherever a direct connection is possible — it simply fails to connect for
students behind stricter networks. Nothing else in the app depends on this.

### When something goes wrong

Users are shown an error *code* and an offer to send a report — never an
instruction, because most people cannot deploy a security rule or build a
database index, and asking them to makes our fault look like theirs. The
codes and what each one actually means live in `src/lib/errors.ts`; a sent
report lands in `supportReports`, readable only by a site admin.

### Locking the site

**Site admin → Site lock** puts the whole platform behind a coming-soon page.
A signed-in site admin still reaches every page normally, so you can keep
working on a site that's shut to the world.

### Creating the first site admin

Site admin is a platform-wide role — organisations, members, classes and
distributed papers across every school, never a student's own papers or
dictated practice sessions (that boundary is enforced by `firestore.rules`,
not the UI). It's also the only role that can grant an account permission to
create a new organisation in the first place; nobody can self-serve one.

There's no in-app way to create the *first* site admin, since granting it
already requires being one. Create it by hand once:

1. Have that person sign up in the app first, so their account exists.
2. **Authentication → Users** — find them by email, copy their **User UID**.
3. **Firestore Database** — create a collection named exactly `siteAdmins`
   at the root, if it doesn't exist yet.
4. Add a document whose **Document ID is that UID**, with any field at all
   (existence is the only thing checked, e.g. `grantedAt: <today's date>`).

They'll see a **Site admin** link after reloading. From there they can grant
site admin to others, and grant specific emails permission to create an
organisation, both from the Site Admin page — no more manual console work.

### Running it

Requires Node 20+.

```bash
npm install
npm run dev            # http://localhost:5173
```

To work with no cloud project at all, run everything against the local
emulators:

```bash
npm run emulators                    # in one terminal
VITE_USE_EMULATORS=true npm run dev  # in another
```

---

## Deploying

`npm run build` produces a static `dist/` that any static host will serve.

### GitHub Pages

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.

1. **Settings → Pages → Source: GitHub Actions**.
2. Nothing else — the Firebase web config is committed in `src/lib/firebase.ts`,
   so the build needs no secrets. To target a different project, set the six
   `VITE_FIREBASE_*` values under **Settings → Secrets and variables → Actions
   → Variables** and they take precedence.
3. For a project site at `https://<user>.github.io/Scriber/`, also set
   `VITE_BASE` to `/Scriber/`. On a custom domain, leave it unset.

The build writes a `404.html` copy of the app so deep links work — GitHub Pages
has no SPA rewrite of its own.

### Vercel

The only host here that runs the `api/` functions, so it's the one to use if
screen sharing has to work behind a school network (see "Screen sharing").

1. **vercel.com → Add New → Project**, import this repository.
2. Vercel reads `vercel.json`: framework Vite, build `npm run build`, output
   `dist`. Leave all of it alone.
3. Under **Environment Variables**, leave the `VITE_FIREBASE_*` values unset
   unless you're pointing at a different Firebase project — the committed
   config in `src/lib/firebase.ts` is the default. Do **not** set `VITE_BASE`;
   Vercel serves from the root.
4. Deploy, then add the deployment's domain under Firebase **Authentication →
   Settings → Authorised domains**, or Google sign-in will refuse to run on
   it. Add both the production domain and any custom domain.
5. Optional, for TURN: add `TURN_URLS` and `TURN_SECRET` and redeploy.

`vercel.json` rewrites everything except `/api/*` to `index.html`, so deep
links work without the `404.html` trick GitHub Pages needs.

### Render

`render.yaml` is included. Render → **New → Blueprint**, point it at this repo,
then add the `VITE_FIREBASE_*` values under the service's Environment settings.
The free Static Site tier covers this app, custom domain and TLS included.

### Firebase Hosting

Since the backend is already Firebase, this keeps everything in one project and
one command:

```bash
npm run deploy         # builds, then firebase deploy
npx firebase hosting:channel:deploy preview   # a shareable preview URL
```

Add the custom domain under **Hosting → Add custom domain**; Firebase issues the
certificate.

---

## Tests

```bash
npm test               # scribe engine unit tests
npm run test:rules     # proves the security rules isolate accounts (emulators must be running)
npm run e2e            # full browser run against the emulators
```

The scribe engine is a pure `(state, utterance) -> (state, events)` reducer, so
its behaviour is covered directly — including that recogniser-supplied
punctuation is stripped in strict mode, that `scratch that` removes the right
burst, and that read-back returns the last two sentences.

`test:rules` signs in as two accounts and confirms that one cannot read or write
the other's papers, sessions or profile, and that nothing outside the `users`
tree is writable at all.

---

## Privacy

Practice sessions and uploaded papers are private to the account that created
them, enforced by the security rules rather than by the UI. Dictation is
processed by the browser's speech recognition, which on Chrome means audio is
sent to Google for transcription — worth knowing before dictating anything
sensitive.
