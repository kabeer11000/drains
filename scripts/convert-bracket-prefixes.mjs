// One-time migration: turns "[Stream Name] text" prefixes in a drain's
// entries into real streams, files each entry into its stream, and strips
// the prefix from the entry text. Not an app feature — run once by hand.
//
//   node scripts/convert-bracket-prefixes.mjs                         list drains
//   node scripts/convert-bracket-prefixes.mjs <dbName> <email>        dry run
//   node scripts/convert-bracket-prefixes.mjs <dbName> <email> --apply
//
// Only entries created by <email> are touched. Uses COUCHDB_ADMIN_URL from
// .env. Safe to re-run: existing streams/links are reused, and entries
// whose prefix is already gone are skipped.
import 'dotenv/config'

const ADMIN_URL = process.env.COUCHDB_ADMIN_URL
if (!ADMIN_URL) throw new Error('COUCHDB_ADMIN_URL is not set')

const [dbName, email, flag] = process.argv.slice(2)
const apply = flag === '--apply'

// Must match services/streams.ts so slugs line up with app-created streams.
const STREAM_COLORS = [
  'light-dark(hsl(0, 65%, 45%), hsl(0, 70%, 70%))',
  'light-dark(hsl(30, 70%, 40%), hsl(30, 75%, 65%))',
  'light-dark(hsl(50, 75%, 38%), hsl(50, 80%, 62%))',
  'light-dark(hsl(140, 45%, 35%), hsl(140, 50%, 62%))',
  'light-dark(hsl(180, 50%, 32%), hsl(180, 55%, 60%))',
  'light-dark(hsl(210, 60%, 45%), hsl(210, 65%, 70%))',
  'light-dark(hsl(265, 50%, 50%), hsl(265, 60%, 75%))',
  'light-dark(hsl(320, 55%, 45%), hsl(320, 60%, 72%))',
]
function slugify(name) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'stream'
}

// Credentials can't ride in a fetch URL, so split them into a header.
const base = new URL(ADMIN_URL)
const auth = 'Basic ' + Buffer.from(`${decodeURIComponent(base.username)}:${decodeURIComponent(base.password)}`).toString('base64')
base.username = ''
base.password = ''
async function couch(path, init = {}) {
  const res = await fetch(new URL(path, base), {
    ...init,
    headers: { Authorization: auth, 'Content-Type': 'application/json', ...init.headers },
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${JSON.stringify(body)}`)
  return body
}

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

// Leading "[Name]" plus following spaces, read from the entry's visible text.
const PREFIX = /^\s*\[([^\][\n]{1,60})\]\s*/

// Removes the first `count` visible characters of the HTML (text only, tags
// untouched), then drops tags left empty by it (e.g. <strong></strong>).
function stripLeadingText(html, count) {
  const parts = html.split(/(<[^>]+>)/)
  let left = count
  for (let i = 0; i < parts.length && left > 0; i++) {
    if (parts[i].startsWith('<')) continue
    // Walk entity-aware so "&amp;" counts as one visible character.
    const units = parts[i].match(/&[a-z0-9#]+;|[\s\S]/gi) ?? []
    const take = Math.min(left, units.length)
    parts[i] = units.slice(take).join('')
    left -= take
  }
  let out = parts.join('')
  let prev
  do {
    prev = out
    out = out.replace(/<(strong|em|s|code|mark|span)(\s[^>]*)?>\s*<\/\1>/g, '')
  } while (out !== prev)
  // A stray space or line break now sitting right after the opening tags.
  return out.replace(/^((?:<(?!br)[^>]+>)*)(?:\s|<br\s*\/?>)+/, '$1')
}

function visibleText(html) {
  return decode(html.replace(/<[^>]+>/g, ''))
}

async function main() {
  if (!dbName) {
    const dbs = await couch('/_all_dbs')
    console.log('Drains (pass one as the first argument):')
    for (const db of dbs.filter((d) => !d.startsWith('_') && d !== 'main' && d !== 'directory')) console.log('  ' + db)
    return 0
  }
  if (!email) throw new Error('Usage: convert-bracket-prefixes.mjs <dbName> <email> [--apply]')

  const db = `/${encodeURIComponent(dbName)}`
  const all = await couch(`${db}/_all_docs?include_docs=true`)
  const docs = all.rows.map((r) => r.doc)
  const entries = docs.filter((d) => d.type === 'entry' && d.createdByEmail?.toLowerCase() === email.toLowerCase())
  const streams = new Map(docs.filter((d) => d.type === 'stream').map((d) => [d._id.slice('stream:'.length), d]))
  const links = new Set(docs.filter((d) => d.type === 'streamlink').map((d) => d._id))

  const writes = []
  const now = Date.now()
  let colorIndex = streams.size
  const plan = []

  for (const entry of entries) {
    const text = visibleText(entry.content ?? '')
    const match = text.match(PREFIX)
    if (!match) continue
    const name = match[1].trim()
    const slug = slugify(name)

    if (!streams.has(slug)) {
      const doc = {
        _id: `stream:${slug}`,
        type: 'stream',
        name,
        color: STREAM_COLORS[colorIndex++ % STREAM_COLORS.length],
        createdByEmail: email.toLowerCase(),
        createdAt: now,
      }
      streams.set(slug, doc)
      writes.push(doc)
    }

    const entryId = entry._id.slice('entry:'.length)
    const linkId = `streamlink:${entryId}:${slug}`
    if (!links.has(linkId)) {
      links.add(linkId)
      writes.push({ _id: linkId, type: 'streamlink', entryId, streamId: slug, createdByEmail: email.toLowerCase(), createdAt: now })
    }

    const content = stripLeadingText(entry.content, match[0].length)
    writes.push({ ...entry, content })
    plan.push({ stream: streams.get(slug).name, before: text.slice(0, 70), after: visibleText(content).slice(0, 70) })
  }

  const newStreams = writes.filter((w) => w.type === 'stream')
  console.log(`${entries.length} entries by ${email} in ${dbName}; ${plan.length} have a [prefix].`)
  console.log(`New streams: ${newStreams.map((s) => s.name).join(', ') || 'none'}`)
  for (const p of plan) console.log(`\n  #${p.stream}\n    before: ${p.before}\n    after:  ${p.after}`)

  if (!apply) {
    console.log(`\nDry run. Re-run with --apply to write ${writes.length} docs.`)
    return 0
  }

  const result = await couch(`${db}/_bulk_docs`, { method: 'POST', body: JSON.stringify({ docs: writes }) })
  const failed = result.filter((r) => r.error)
  console.log(`\nWrote ${result.length - failed.length}/${result.length} docs.`)
  for (const f of failed) console.log(`  FAILED ${f.id}: ${f.error} ${f.reason}`)
  return failed.length ? 1 : 0
}

process.exitCode = await main()
