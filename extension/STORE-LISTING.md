# Publishing the Scriber extension

A click-by-click walkthrough, in the order you'll actually do it. Everything
the Chrome Web Store asks for is written out below to paste.

Build the upload first:

```
npm run build:extension     # → dist-extension/scriber-extension-1.0.0.zip
npm run store:shots         # → dist-extension/store/01-supervisor-monitor.png
```

**Never upload `extension/` itself.** Its manifest lists
`http://localhost:5173` so the content script runs against the dev server,
and a reviewer reads that as an extension that talks to whatever happens to
be running on their own machine. The build strips it.

---

## Step 1 — Register (once, ~10 minutes, US$5)

**Where:** <https://chrome.google.com/webstore/devconsole>

1. Sign in with the Google account that will own this listing forever. Use a
   role account — `support@pracscriber.com` — not your personal one. The
   developer account cannot be transferred later without going through Google
   support, and a listing stranded on a personal account is a real problem the
   day someone else runs the business.
2. Accept the Developer Agreement.
3. Pay the **one-off US$5** registration fee. Card details go to Google
   Payments; there's no subscription and no per-item cost.
4. You land on an empty **Items** page.

## Step 2 — Fill in the account, before you touch the item

**Where:** left sidebar → **Account**

Three things here block publication if you skip them, and the error messages
you get later won't point you back to this page:

| Field | What to do |
| --- | --- |
| **Publisher name** | `Johnston Media` or `Scriber` — shown under the extension's title on the listing |
| **Contact email** | Use the role account, then click **Verify** and click the link Google emails. An unverified contact email blocks submission outright. |
| **Trader status** | Declare **Trader** if you intend to charge schools. This is an EU Digital Services Act requirement and it is mandatory — an undeclared item can't be distributed in the EU. Declaring trader also requires a physical address and phone number, which are shown publicly on the listing. |

Becoming a verified publisher is **not** on this page — it is a field on the
item, so it comes later, at Step 4b. Nothing about it exists until an item
does.

## Step 3 — Create the item and get your extension ID

**Where:** **Items** → **+ New Item** (top right)

1. Drag in `dist-extension/scriber-extension-1.0.0.zip`.
2. Upload. Google unpacks it and creates a **draft**.

**You now have the permanent extension ID, before review.** Look at the
address bar:

```
https://chrome.google.com/webstore/devconsole/<publisher>/<EXTENSION-ID>/edit
```

That 32-character lowercase string is the ID. It never changes across
updates. Copy it now — a school can start setting up force-install with it
while review is still running.

The draft opens with four tabs down the left: **Store listing**, **Privacy
practices**, **Distribution**, and **Package**.

## Step 4a — Store listing tab

**Product details**

| Field | Value |
| --- | --- |
| Title | `Scriber Exam Supervision` |
| Summary | Pre-filled from the manifest — 132 characters max |
| Description | The long block below |
| Category | **Education** |
| Language | **English (Australia)** |

Description to paste:

```
Scriber Exam Supervision is for students sitting a supervised practice exam on Scriber, and for the teachers supervising them.

During a test — and only during a test — it tells the supervisor which other tabs the student has open. A web page cannot see this on its own: the browser walls every page off from every other tab, so without this extension Scriber can only report that a student left the exam, never where they went. That difference is the whole reason this exists.

Outside a test it reports nothing at all. There is no session to report against, and nothing is sent.

WHAT THE SUPERVISOR SEES
• Tab titles and site names (for example "Google Search — google.com")
• Whether the browser window is focused
• Nothing else

WHAT IT NEVER SENDS
• Full web addresses, which carry search terms and document names
• Page contents, form fields, keystrokes or passwords
• Anything whatsoever outside a running test

HOW IT IS SET UP
Sign in to Scriber, open Settings, and choose "Pair this extension". Pairing links the extension to your Scriber account so a report can be matched to the right student. It grants the extension no access to your Scriber account.

REQUIREMENTS
A Scriber account that belongs to a school or organisation. Personal Scriber accounts never sit supervised tests and do not need this extension.

Scriber is an independent practice tool for students with a writer or scribe exam provision. It is not affiliated with or endorsed by NESA.
```

**Graphics** — the store will not let you submit without the first two:

| Asset | Size | Where it comes from |
| --- | --- | --- |
| Store icon | 128×128 PNG | `extension/icons/icon-128.png` |
| Screenshot (≥1, ≤5) | 1280×800 PNG | `dist-extension/store/01-supervisor-monitor.png` |
| Small promo tile | 440×280 PNG | Optional — only used if Google features you |
| Marquee | 1400×560 PNG | Optional, same |

`npm run store:shots` generates the screenshot from the real supervisor
monitor against seeded demo data — invented names, never a real student. It
shows all three states side by side on purpose: a student with only Scriber
open, one with a search engine open, and one whose extension isn't reporting
at all. A reviewer assessing "does the single purpose match what it does" can
answer it from that one image, which is the whole job of the screenshot for
an extension asking for `tabs`.

## Step 4b — Become a verified publisher

**Where:** the same **Store listing** tab, further down — the **Official URL**
pull-down.

There is no "verify my account" button anywhere in the Chrome Web Store, and
looking for one on the Account page is a dead end. Verification happens in a
different Google product entirely, and the store only reads the result:

1. Next to **Official URL**, click **Add a new site**. It opens **Google
   Search Console** in a new tab.
2. Add `pracscriber.com` and verify it. For a domain property that means a
   **DNS TXT record**, which you add in Cloudflare in the same DNS tab as the
   A records — type `TXT`, name `@`, content the string Google gives you.
   Cloudflare's DNS is fast, so verification usually passes within a minute.
3. Back in the Chrome dashboard, reload and pick `pracscriber.com` from the
   **Official URL** pull-down. The list only ever contains domains already
   verified to the signed-in Google account, which is why it is empty before
   you do step 2.

Use the **same Google account** for Search Console as the developer account,
or the domain will not appear in the list.

What it changes: the listing shows a linked official URL under the title
instead of a bare publisher name. Without it, the Details section reads
*"Offered by: <your publisher name>"* with nothing backing it — a weak signal
for something a school is being asked to install on student machines.

## Step 5 — Privacy practices tab

**This is where submissions actually stall.** Every field is required and
vague answers get bounced.

**Single purpose** — one sentence, and they mean one:

```
Report which browser tabs are open to the supervisor of a Scriber exam, while that exam is running.
```

**Permission justifications** — a free-text box per permission:

| Permission | Paste this |
| --- | --- |
| `tabs` | Reading tab titles and hostnames is the extension's entire purpose: a supervisor needs to know whether a student sitting a supervised exam has opened another site. A web page cannot access this. Titles and hostnames only are read, never full URLs, and only while an exam is in progress. |
| `storage` | Stores the pairing token that identifies which Scriber student this browser belongs to, and the ID of the exam currently in progress. The exam ID is kept in session storage and is discarded when the browser closes. |
| `alarms` | A 30-second heartbeat during an exam, so a supervisor can tell the difference between a student who has done nothing and an extension that has stopped running. |
| Host permission (`https://*.pracscriber.com/*`) | The extension communicates only with Scriber's own servers, to receive the start and end of an exam from the Scriber page and to send tab reports back. It runs on no other site. |

**Are you using remote code?** → **No, I am not using remote code.** True —
everything is in the package, there is no `eval` and nothing is fetched and
executed.

**Data usage** — tick exactly these and nothing else:

- ☑ **Website content** — tab titles and hostnames, during an exam
- ☑ **Authentication information** — the pairing token
- ☐ Personally identifiable information
- ☐ Health, financial, location, personal communications
- ☐ User activity (this means analytics and clickstream; we collect none)

Then tick all three certifications:

- ☑ I do not sell or transfer user data to third parties, outside of the
  approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for
  lending purposes

**Privacy policy URL**

```
https://pracscriber.com/privacy
```

That page must be live and must describe the extension specifically, or
review bounces it. It does — `src/pages/Privacy.tsx` has a dedicated *"The
extension"* section covering what it reads, when, and how to unpair.

## Step 6 — Distribution tab

| Setting | Choose |
| --- | --- |
| Payments | **Free** |
| Visibility | **Unlisted** (see below) |
| Distribution regions | All, unless you have a reason |

**Visibility — pick this deliberately:**

| Option | Who can install | When it fits |
| --- | --- | --- |
| **Public** | Anyone, appears in store search | Once schools should be finding it on their own |
| **Unlisted** | Anyone with the link | **Start here** |
| **Private** | One Google Workspace domain | Only if publishing on a single school's behalf |

Unlisted still gets full review, a permanent ID, and a real install link to
put in Scriber. The only thing it costs is store search traffic, which is
worth nothing while there's one school on the platform — and it means you're
not shipping weekly changes to a publicly listed product. Switch to Public
later from this same tab; it's a one-click change.

## Step 7 — Submit

**Where:** **Submit for review** (top right)

Choose **publish immediately after review passes**, unless you want to hold
it until a specific date.

**How long:** usually a few days. Anything requesting `tabs` is more likely to
get a manual look, so allow a week for the first submission. You'll get an
email either way; rejections name the specific policy and you fix and
resubmit against the same item.

## Step 8 — The day it is approved

1. Copy the public URL:

   ```
   https://chromewebstore.google.com/detail/scriber-exam-supervision/<extension-id>
   ```

2. Paste it into Scriber: **Site admin → Public site → Extension install
   link** → **Save**.

   Both the install prompt and the Settings pairing panel read it from there,
   so it takes effect immediately with no deploy. Until you set it, both fall
   back to a store search that finds nothing — set it the same day.

---

## For schools running managed Chromebooks

Worth telling every school you demo to. It turns installation from a
per-student instruction into one administrator's afternoon:

**Where:** <https://admin.google.com> → **Devices** → **Chrome** → **Apps &
extensions** → **Users & browsers**

1. Select the student organisational unit in the left tree.
2. Click the **+** button (bottom right) → **Add Chrome app or extension by
   ID**.
3. Paste the extension ID. Leave the source as "From the Chrome Web Store" —
   this works for an Unlisted item too.
4. Set **Installation policy** → **Force install**.

Force-installed extensions install silently and **cannot be removed by the
student**, which is exactly the property a supervised assessment wants. Do it
against the student OU only, not staff.

## Shipping an update

1. Bump `version` in `extension/manifest.json` (or `npm run build:extension --
   --version 1.1.0`).
2. `npm run build:extension`
3. Item → **Package** tab → **Upload new package** → **Submit for review**.

The extension ID never changes, so the link in Scriber stays correct, and
Chrome updates installed copies within a few hours.

**One trap:** adding a *new permission* disables the extension for every
existing user until each one accepts the new permission dialog. Never ship a
permission change during an exam period.
