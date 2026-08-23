/**
 * Packages the extension for the Chrome Web Store.
 *
 * The manifest in extension/ is the one you load unpacked while developing,
 * and it lists http://localhost:5173 so the content script runs against the
 * dev server. That host has no business in a published listing — a reviewer
 * reads it as an extension that talks to whatever is running on the
 * reviewer's own machine, and it is one of the more reliable ways to have a
 * submission rejected.
 *
 * So the store build is generated rather than maintained: this strips the
 * development host from both host_permissions and the content script matches,
 * and refuses to build if anything else that only makes sense locally is
 * still in there.
 *
 *   node scripts/build-extension.mjs            → dist-extension/scriber-extension-1.0.0.zip
 *   node scripts/build-extension.mjs --version 1.1.0
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'

const SOURCE = 'extension'
const OUT = 'dist-extension'
const STAGE = join(OUT, 'extension')

/** Hosts that exist for development and must never reach a published listing. */
const DEV_HOST_PATTERN = /localhost|127\.0\.0\.1|0\.0\.0\.0|\.local\b/

const args = process.argv.slice(2)
const versionArg = args.indexOf('--version')
const override = versionArg >= 0 ? args[versionArg + 1] : null

const manifest = JSON.parse(readFileSync(join(SOURCE, 'manifest.json'), 'utf8'))
if (override) manifest.version = override

const stripDevHosts = (list) => (list ?? []).filter((host) => !DEV_HOST_PATTERN.test(host))

manifest.host_permissions = stripDevHosts(manifest.host_permissions)
manifest.content_scripts = (manifest.content_scripts ?? []).map((script) => ({
  ...script,
  matches: stripDevHosts(script.matches),
}))

// A build that produced an extension matching nothing would install cleanly
// and silently do nothing at all, which is far worse than failing here.
if (manifest.host_permissions.length === 0) {
  throw new Error('every host was stripped as a development host — check manifest.json')
}
for (const script of manifest.content_scripts) {
  if (script.matches.length === 0) {
    throw new Error(`content script ${script.js?.join(', ')} would match nothing after stripping dev hosts`)
  }
}

// The store requires each of these, and finding out from a rejection notice
// two days later is a poor way to learn one is missing.
for (const field of ['name', 'version', 'description', 'icons']) {
  if (!manifest[field]) throw new Error(`manifest is missing ${field}, which the store requires`)
}
if (manifest.description.length > 132) {
  throw new Error(`description is ${manifest.description.length} characters; the store allows 132`)
}
for (const size of ['16', '48', '128']) {
  const icon = manifest.icons?.[size]
  if (!icon || !existsSync(join(SOURCE, icon))) {
    throw new Error(`icon ${size} is missing (${icon ?? 'not declared'})`)
  }
}

/**
 * What may go in the package, by extension.
 *
 * An allowlist rather than a list of things to skip, because the failure
 * modes are not symmetrical: a shipped file nobody meant to ship is public
 * forever the moment the listing goes live — anyone can unzip a published
 * extension — while a missing one fails loudly the first time it is loaded.
 * This caught a notes file that had already gone out once.
 */
const SHIPPABLE = new Set(['.js', '.html', '.css', '.json', '.png', '.svg', '.woff2'])

rmSync(OUT, { recursive: true, force: true })
mkdirSync(STAGE, { recursive: true })

const rejected = []
cpSync(SOURCE, STAGE, {
  recursive: true,
  filter: (path) => {
    if (statSync(path).isDirectory()) return true
    if (basename(path).startsWith('.')) return false
    if (SHIPPABLE.has(extname(path).toLowerCase())) return true
    rejected.push(relative(SOURCE, path))
    return false
  },
})

// Refused rather than silently dropped: a file sitting in extension/ that
// cannot ship is either something that belongs elsewhere in the repo, or
// something this list needs to learn about. Both want a human to look.
if (rejected.length > 0) {
  throw new Error(
    `these files are in extension/ but cannot ship: ${rejected.join(', ')}\n` +
      'Move them out of extension/, or add their type to SHIPPABLE if they belong in the package.',
  )
}
writeFileSync(join(STAGE, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

// Zipped from inside the staged folder: the store wants the manifest at the
// root of the archive, not one directory down.
const zipName = `scriber-extension-${manifest.version}.zip`
execFileSync('zip', ['-rq', join('..', zipName), '.'], { cwd: STAGE })

console.log(`built ${join(OUT, zipName)}`)
console.log(`  version         ${manifest.version}`)
console.log(`  hosts           ${manifest.host_permissions.join(', ')}`)
console.log(`  permissions     ${(manifest.permissions ?? []).join(', ')}`)
console.log('\nUpload that zip at https://chrome.google.com/webstore/devconsole')
console.log('Listing copy and permission justifications: docs/chrome-web-store.md')
