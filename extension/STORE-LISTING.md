# Publishing the Scriber extension

Everything the Chrome Web Store asks for, written out. Build the upload with:

```
node scripts/build-extension.mjs
```

That produces `dist-extension/scriber-extension-<version>.zip` with the
development host stripped out. Never upload `extension/` directly — it lists
`http://localhost:5173`, and a reviewer reads that as an extension that talks
to whatever happens to be running on their own machine.

## Before the first upload

1. A Google account you're willing to have permanently attached to the
   listing. Use a role account (`support@pracscriber.com`), not a personal
   one — the developer account cannot be transferred later without support
   involvement.
2. A one-off **US$5** registration fee at
   <https://chrome.google.com/webstore/devconsole>.
3. Verify the publisher: the store shows an "unverified publisher" warning
   otherwise, which is not what you want on an extension a school is being
   asked to trust. Verification means proving you control `pracscriber.com`
   in Google Search Console, then linking it in the developer account.

## Visibility — pick this deliberately

| Setting | Who can install | When it fits |
| --- | --- | --- |
| **Public** | Anyone, appears in search | Once you want schools finding it on their own |
| **Unlisted** | Anyone with the link | **Start here.** Same install flow, no store search presence while you're still shipping changes weekly |
| **Private** | One Google Workspace domain | Only useful if you're publishing on a school's behalf |

Unlisted still goes through full review, and still gives you a permanent
extension ID and a real install link to put in Scriber. The only thing it
costs you is store search traffic, which is worth nothing while there is one
school on the platform.

## For schools running managed Chromebooks

This is worth telling every school you demo to, because it turns installation
from a per-student instruction into an administrator's afternoon:

> Google Admin console → Devices → Chrome → Apps & extensions → Users &
> browsers → select the student OU → add by extension ID → set to **Force
> install**.

Force-installed extensions cannot be removed by the student, which is exactly
the property a supervised assessment wants. Give the school the extension ID
once you have it.

## Listing fields

**Name**

```
Scriber Exam Supervision
```

**Short description** (132 characters max — the manifest's `description`)

```
Lets a supervisor see which other tabs are open during a Scriber exam, and puts practice one click away the rest of the time.
```

**Category**: Education
**Language**: English (Australia)

**Detailed description**

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

## Privacy tab — the part that gets submissions rejected

**Single purpose** (one sentence, and they mean one)

```
Report which browser tabs are open to the supervisor of a Scriber exam, while that exam is running.
```

**Permission justifications** — each of these is a required free-text field:

| Permission | Justification to paste |
| --- | --- |
| `tabs` | Reading tab titles and hostnames is the extension's entire purpose: a supervisor needs to know whether a student sitting a supervised exam has opened another site. A web page cannot access this. Titles and hostnames only are read, never full URLs, and only while an exam is in progress. |
| `storage` | Stores the pairing token that identifies which Scriber student this browser belongs to, and the ID of the exam currently in progress. The exam ID is kept in session storage and is discarded when the browser closes. |
| `alarms` | A 30-second heartbeat during an exam, so a supervisor can tell the difference between a student who has done nothing and an extension that has stopped running. |
| `host_permissions` (`https://*.pracscriber.com/*`) | The extension communicates only with Scriber's own servers, to receive the start and end of an exam from the Scriber page and to send tab reports back. It runs on no other site. |
| Remote code | **No.** All code is contained in the package. |

**Data usage disclosures** — tick these and nothing else:

- Collects **Website content**: yes — tab titles and hostnames, during an exam.
- Collects **Authentication information**: yes — the pairing token.
- Everything else (personally identifiable information, health, financial,
  location, personal communications, user activity beyond the above): **no**.

Then confirm all three certifications:

- Data is not sold to third parties.
- Data is not used or transferred for purposes unrelated to the item's single
  purpose.
- Data is not used or transferred to determine creditworthiness or for
  lending.

**Privacy policy URL**

```
https://pracscriber.com/privacy
```

That page must describe the extension's data handling specifically, or review
will bounce it. It does — see `src/pages/Privacy.tsx`.

## Graphics you have to supply

| Asset | Size | Required |
| --- | --- | --- |
| Store icon | 128×128 PNG | Yes — `extension/icons/icon-128.png` |
| Screenshot | 1280×800 or 640×400 PNG | Yes, at least one |
| Small promo tile | 440×280 PNG | Only for featuring |

For the screenshot, the most honest one is the supervisor's monitor view with
a student's tab list showing — it demonstrates the single purpose in one
image, which is exactly what a reviewer is looking for. Take it at 1280×800
against demo data, never a real student's name.

## After it is approved

Review usually takes a few days; extensions requesting `tabs` are more often
pulled for a manual look, so allow a week for the first submission.

Once it is live you get a permanent extension ID and a URL like:

```
https://chromewebstore.google.com/detail/scriber-exam-supervision/<extension-id>
```

Paste that into **Site admin → Public site → Extension install link**. The
install prompt and the Settings page both read it from there, so it takes
effect immediately with no deploy. Until it is set, both fall back to a store
search, which is a poor experience — set it the day it is approved.

## Shipping an update

1. Bump `version` in `extension/manifest.json` (or `--version 1.1.0`).
2. `node scripts/build-extension.mjs`
3. Upload the new zip to the existing item and submit.

The extension ID never changes, so the link in Scriber stays correct. Chrome
updates installed copies within a few hours. Anything that adds a permission
resets installed users to a disabled state until they accept it — so avoid
adding permissions in the middle of an exam period.
