// Server-only. COUCHDB_ADMIN_URL is NOT VITE_-prefixed, so Vite never inlines
// it into a client bundle — this module must only ever be imported from
// src/pages/api/** route files, never from client components.
//
// Credentials are pulled out of the URL and sent as an explicit Authorization
// header rather than left embedded in the URL passed to fetch() — native
// fetch (both browsers and Node's undici, which is what Vercel functions
// use) rejects URLs containing userinfo ("URL contains credentials").
import { ulid } from 'ulid'
import { idAfter } from '@/utils/ulidArithmetic'

const ADMIN_URL = import.meta.env.COUCHDB_ADMIN_URL as string | undefined

let cached: { origin: string; authHeader: string } | null = null

function admin() {
  if (cached) return cached
  if (!ADMIN_URL) throw new Error('COUCHDB_ADMIN_URL is not configured')
  const parsed = new URL(ADMIN_URL)
  const authHeader = 'Basic ' + Buffer.from(`${parsed.username}:${parsed.password}`).toString('base64')
  const origin = `${parsed.protocol}//${parsed.host}`
  cached = { origin, authHeader }
  return cached
}

async function adminFetch(path: string, init?: RequestInit) {
  const { origin, authHeader } = admin()
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
      ...(init?.headers || {}),
    },
  })
}

export async function couchUserExists(email: string) {
  const res = await adminFetch(`/_users/org.couchdb.user:${encodeURIComponent(email)}`)
  return res.status === 200
}

export async function createCouchUser(email: string, password: string) {
  const usersDb = await adminFetch(`/_users`, { method: 'PUT' })
  if (!usersDb.ok && usersDb.status !== 412) {
    throw new Error(`Failed to ensure _users database exists (${usersDb.status})`)
  }
  const res = await adminFetch(`/_users/org.couchdb.user:${encodeURIComponent(email)}`, {
    method: 'PUT',
    body: JSON.stringify({ name: email, password, roles: [], type: 'user' }),
  })
  if (!res.ok) throw new Error(`Failed to create CouchDB user (${res.status})`)
}

// Pure password check — CouchDB's /_session is used as the oracle, hit
// anonymously with no admin auth (we're checking THEIR password, not ours).
// We don't use the session cookie it returns: PouchDB syncs cross-origin
// (app on Vercel, CouchDB on Render), and a cookie set by our server's
// response can't be scoped to CouchDB's domain anyway (basic same-origin
// cookie rules, not a SameSite nuance) — the client instead re-authenticates
// its own PouchDB sync directly with the user's own credentials (sync.js).
export async function verifyCouchLogin(email: string, password: string): Promise<boolean> {
  const { origin } = admin()
  const res = await fetch(`${origin}/_session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: email, password }),
  })
  return res.ok
}

// Ensures the shared database exists. Note: an empty _security.members list
// does NOT restrict access to authenticated users — verified directly
// against this instance, an empty members list is wide open to anonymous
// requests too. The actual "must be logged in" enforcement is the
// server-wide chttpd/require_valid_user=true config (set once, out of band,
// with the user's explicit sign-off — it affects the whole CouchDB node,
// not just this database, so it's not something to toggle from app code).
// _security here is reserved for real per-drain member lists in a later
// phase, where a non-empty names list actually does restrict access.
export async function ensureMainDbOpenToAuthenticated() {
  const created = await adminFetch(`/main`, { method: 'PUT' })
  if (!created.ok && created.status !== 412) {
    throw new Error(`Failed to ensure main database exists (${created.status})`)
  }
  await adminFetch(`/main/_security`, {
    method: 'PUT',
    body: JSON.stringify({ admins: { names: [], roles: [] }, members: { names: [], roles: [] } }),
  })
}

export async function putAdminDoc(db: string, doc: Record<string, any>) {
  const res = await adminFetch(`/${db}/${encodeURIComponent(doc._id)}`, {
    method: 'PUT',
    body: JSON.stringify(doc),
  })
  if (!res.ok && res.status !== 409) throw new Error(`Failed to write ${doc._id} (${res.status})`)
  return res
}

export async function getAdminDoc(db: string, id: string) {
  const res = await adminFetch(`/${db}/${encodeURIComponent(id)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Failed to read ${id} (${res.status})`)
  return res.json()
}

// Get-mutate-put with a bounded retry on 409, same pattern as
// services/entries.ts's saveEntry — for docs multiple requests might touch
// concurrently (namely each user's own directory doc, which invites and
// their own signup could both touch around the same time).
export async function updateAdminDoc(
  db: string,
  id: string,
  mutate: (doc: any) => any,
  defaultDoc: () => any
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await getAdminDoc(db, id)
    const doc = mutate(existing ?? defaultDoc())
    const res = await adminFetch(`/${db}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(doc),
    })
    if (res.ok) return res.json()
    if (res.status !== 409) throw new Error(`Failed to update ${id} (${res.status})`)
  }
  throw new Error(`Failed to update ${id} after retries`)
}

const VALIDATE_DOC_UPDATE = `function(newDoc, oldDoc, userCtx) {
  if (userCtx.roles.indexOf('_admin') !== -1) return;
  if (!oldDoc) return;
  if (oldDoc.type === 'entry' || oldDoc.type === 'comment') {
    var owner = oldDoc.createdByEmail || oldDoc.authorEmail;
    if (owner && owner !== userCtx.name) {
      throw({forbidden: 'Only the original author can edit or delete this.'});
    }
  }
}`

// Creates a drain's own database with real membership-based access control:
// only the listed emails can read or write it at all (CouchDB-enforced, not
// app-side hiding), and within it, only a doc's own author can edit/delete
// an existing entry/comment (validate_doc_update) — anyone a member can add.
export async function provisionDrainDatabase(dbName: string, ownerEmail: string) {
  const created = await adminFetch(`/${dbName}`, { method: 'PUT' })
  if (!created.ok && created.status !== 412) {
    throw new Error(`Failed to create drain database ${dbName} (${created.status})`)
  }
  await adminFetch(`/${dbName}/_security`, {
    method: 'PUT',
    body: JSON.stringify({
      admins: { names: [], roles: [] },
      members: { names: [ownerEmail], roles: [] },
    }),
  })
  await adminFetch(`/${dbName}/_design/access`, {
    method: 'PUT',
    body: JSON.stringify({ _id: '_design/access', validate_doc_update: VALIDATE_DOC_UPDATE }),
  })
}

export async function getDrainMembers(dbName: string): Promise<string[]> {
  const res = await adminFetch(`/${dbName}/_security`)
  if (!res.ok) throw new Error(`Failed to read security for ${dbName} (${res.status})`)
  const security = await res.json()
  return security?.members?.names ?? []
}

export async function addDrainMember(dbName: string, email: string) {
  const members = await getDrainMembers(dbName)
  if (members.includes(email)) return
  await adminFetch(`/${dbName}/_security`, {
    method: 'PUT',
    body: JSON.stringify({
      admins: { names: [], roles: [] },
      members: { names: [...members, email], roles: [] },
    }),
  })
}

export async function removeDrainMember(dbName: string, email: string) {
  const members = await getDrainMembers(dbName)
  await adminFetch(`/${dbName}/_security`, {
    method: 'PUT',
    body: JSON.stringify({
      admins: { names: [], roles: [] },
      members: { names: members.filter((m) => m !== email), roles: [] },
    }),
  })
}

export async function deleteDrainDatabase(dbName: string) {
  const res = await adminFetch(`/${dbName}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(`Failed to delete ${dbName} (${res.status})`)
}

// Directory: one doc per email listing which drain databases they belong
// to. Admin-only database — the app never talks to it directly, only
// through the /api/drains* server routes, since "which drains can I see"
// is a cross-database question CouchDB can't answer for an unprivileged
// client. Keyed by email so an invite can be recorded before the invitee
// has even signed up yet — no separate "pending invite" concept needed.
const DIRECTORY_DB = 'directory'

export async function ensureDirectoryDbExists() {
  const res = await adminFetch(`/${DIRECTORY_DB}`, { method: 'PUT' })
  if (!res.ok && res.status !== 412) {
    throw new Error(`Failed to ensure directory database exists (${res.status})`)
  }
}

export interface DirectoryDrainEntry {
  dbName: string
  title: string
  description?: string
  tags?: string[]
  visibility: 'private' | 'shared'
  role: 'owner' | 'member'
  joinedAt: number
  // Set when the owner "deletes" the drain — the underlying CouchDB
  // database is left fully intact until purgeExpiredTrash actually
  // removes it, past TRASH_RETENTION_DAYS. Drains with this set are
  // filtered out of the normal list (GET /api/drains) and only surface in
  // the trashed view (?trashed=true) — see api/drains/index.ts.
  trashedAt?: number | null
  // Set when created via an API token (agent/MCP), not a real signed-in
  // browser session — cached here (not just on the notebook doc) so the
  // sidebar can show it with no extra fetch, same as title/tags.
  createdByTokenName?: string
}

export async function getDirectoryDrains(email: string): Promise<DirectoryDrainEntry[]> {
  const doc = await getAdminDoc(DIRECTORY_DB, `user:${email}`)
  return doc?.drains ?? []
}

export async function addDirectoryDrain(email: string, entry: DirectoryDrainEntry) {
  await ensureDirectoryDbExists()
  await updateAdminDoc(
    DIRECTORY_DB,
    `user:${email}`,
    (doc) => ({ ...doc, drains: [...(doc.drains ?? []), entry] }),
    () => ({ _id: `user:${email}`, type: 'directory', drains: [] })
  )
}

export async function removeDirectoryDrain(email: string, dbName: string) {
  await updateAdminDoc(
    DIRECTORY_DB,
    `user:${email}`,
    (doc) => ({ ...doc, drains: (doc.drains ?? []).filter((d: DirectoryDrainEntry) => d.dbName !== dbName) }),
    () => ({ _id: `user:${email}`, type: 'directory', drains: [] })
  )
}

// Account-level API tokens — for external agents/tools (MCP server), not
// tied to any one drain (unlike the public/ingestion tokens below, which
// are drain-scoped and don't identify a user). A token authenticates AS
// the account it belongs to, so `requireAuth` (lib/requireAuth.ts) can
// resolve one straight to an email, same as it already does for a Basic
// auth password check.
export interface ApiToken {
  token: string
  name: string
  createdAt: number
  lastUsedAt: number | null
}

export async function createApiToken(email: string, name: string): Promise<string> {
  const token = ulid()
  await ensureDirectoryDbExists()
  await updateAdminDoc(
    DIRECTORY_DB,
    `user:${email}`,
    (doc) => ({
      ...doc,
      apiTokens: [...(doc.apiTokens ?? []), { token, name, createdAt: Date.now(), lastUsedAt: null }],
    }),
    () => ({ _id: `user:${email}`, type: 'directory', drains: [], apiTokens: [] })
  )
  await putAdminDoc(DIRECTORY_DB, { _id: `apiToken:${token}`, email })
  return token
}

export async function listApiTokens(email: string): Promise<ApiToken[]> {
  const doc = await getAdminDoc(DIRECTORY_DB, `user:${email}`)
  return doc?.apiTokens ?? []
}

export async function revokeApiToken(email: string, token: string) {
  await updateAdminDoc(
    DIRECTORY_DB,
    `user:${email}`,
    (doc) => ({ ...doc, apiTokens: (doc.apiTokens ?? []).filter((t: ApiToken) => t.token !== token) }),
    () => ({ _id: `user:${email}`, type: 'directory', drains: [], apiTokens: [] })
  )
  const reverseDoc = await getAdminDoc(DIRECTORY_DB, `apiToken:${token}`)
  if (reverseDoc) {
    await adminFetch(`/${DIRECTORY_DB}/${encodeURIComponent(reverseDoc._id)}?rev=${reverseDoc._rev}`, {
      method: 'DELETE',
    }).catch(() => {})
  }
}

export async function getUserByApiToken(token: string): Promise<{ email: string; tokenName: string } | null> {
  const doc = await getAdminDoc(DIRECTORY_DB, `apiToken:${token}`)
  if (!doc) return null
  const userDoc = await getAdminDoc(DIRECTORY_DB, `user:${doc.email}`)
  const tokenName = (userDoc?.apiTokens ?? []).find((t: ApiToken) => t.token === token)?.name ?? 'API token'
  return { email: doc.email, tokenName }
}

export async function touchApiTokenLastUsed(email: string, token: string) {
  await updateAdminDoc(
    DIRECTORY_DB,
    `user:${email}`,
    (doc) => ({
      ...doc,
      apiTokens: (doc.apiTokens ?? []).map((t: ApiToken) =>
        t.token === token ? { ...t, lastUsedAt: Date.now() } : t
      ),
    }),
    () => ({ _id: `user:${email}`, type: 'directory', drains: [], apiTokens: [] })
  ).catch(() => {})
}

// Per-account daily cap on AI-calling endpoints (refine, summarize) — the
// single rate limiter every AI route shares, rather than each route
// tracking its own counter. Resets at UTC midnight; a stale count from a
// previous day is just overwritten on next use rather than requiring a
// separate cron/sweep.
const AI_DAILY_LIMIT = 20

export interface AiUsage {
  used: number
  limit: number
  resetsAt: number // ms epoch, start of next UTC day
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function nextUtcMidnight(): number {
  const d = new Date()
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

export async function getAiUsage(email: string): Promise<AiUsage> {
  const doc = await getAdminDoc(DIRECTORY_DB, `user:${email}`)
  const usage = doc?.aiUsage
  const used = usage?.date === todayUtc() ? usage.count : 0
  return { used, limit: AI_DAILY_LIMIT, resetsAt: nextUtcMidnight() }
}

// Get-check-increment with the same bounded 409-retry shape as
// updateAdminDoc, but needs its own loop rather than reusing that helper
// directly — updateAdminDoc's mutate callback has no way to signal "stop,
// don't write" once the limit is already reached. Returns null (no write
// performed) once the caller is at or over the daily limit.
export async function consumeAiUsage(email: string): Promise<AiUsage | null> {
  const today = todayUtc()
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await getAdminDoc(DIRECTORY_DB, `user:${email}`)
    const doc = existing ?? { _id: `user:${email}`, type: 'directory', drains: [] }
    const usage = doc.aiUsage?.date === today ? doc.aiUsage : { date: today, count: 0 }
    if (usage.count >= AI_DAILY_LIMIT) {
      return null
    }
    const nextUsage = { date: today, count: usage.count + 1 }
    const res = await adminFetch(`/${DIRECTORY_DB}/${encodeURIComponent(`user:${email}`)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...doc, aiUsage: nextUsage }),
    })
    if (res.ok) return { used: nextUsage.count, limit: AI_DAILY_LIMIT, resetsAt: nextUtcMidnight() }
    if (res.status !== 409) throw new Error(`Failed to update AI usage (${res.status})`)
  }
  throw new Error('Failed to update AI usage after retries')
}

// Both public share links (`/p/:token`) and GitHub ingestion URLs
// (`/api/ingest/:token`) need to resolve a bare token back to a dbName
// without knowing it in advance — no per-drain database can answer "which
// token points at me" for a request that doesn't know which database to ask
// yet, so the reverse mapping lives as its own doc in the directory
// database, the one admin-only db already used for this kind of
// cross-database lookup. `kind` namespaces the two token spaces (a
// `public:<token>` doc can't collide with an `ingest:<token>` doc even if
// the token strings ever matched). The token is also cached on the drain's
// own notebook doc under `${kind}Token`, purely so the owner's edit dialog
// can show current status without a second lookup.
async function setDrainToken(dbName: string, kind: 'public' | 'ingest', token: string | null) {
  const field = `${kind}Token`
  const notebook = await getAdminDoc(dbName, 'notebook')
  const oldToken = notebook?.[field] as string | undefined
  if (oldToken && oldToken !== token) {
    const oldDoc = await getAdminDoc(DIRECTORY_DB, `${kind}:${oldToken}`)
    if (oldDoc) {
      await adminFetch(`/${DIRECTORY_DB}/${encodeURIComponent(oldDoc._id)}?rev=${oldDoc._rev}`, { method: 'DELETE' }).catch(() => {})
    }
  }
  await putAdminDoc(dbName, { ...notebook, [field]: token ?? undefined })
  if (token) {
    await ensureDirectoryDbExists()
    await putAdminDoc(DIRECTORY_DB, { _id: `${kind}:${token}`, dbName })
  }
}

async function getDrainByToken(kind: 'public' | 'ingest', token: string): Promise<{ dbName: string } | null> {
  const doc = await getAdminDoc(DIRECTORY_DB, `${kind}:${token}`)
  return doc ? { dbName: doc.dbName } : null
}

export const setDrainPublicToken = (dbName: string, token: string | null) => setDrainToken(dbName, 'public', token)
export const getDrainByPublicToken = (token: string) => getDrainByToken('public', token)

export const setDrainIngestionToken = (dbName: string, token: string | null) => setDrainToken(dbName, 'ingest', token)
export const getDrainByIngestionToken = (token: string) => getDrainByToken('ingest', token)

// Ingestion tokens always exist once first requested (unlike publish, which
// is an explicit opt-in) — the URL itself only becomes live once the owner
// actually adds it as a GitHub webhook, so there's no "leak" from having one
// ready before that.
export async function getOrCreateIngestionToken(dbName: string): Promise<string> {
  const notebook = await getAdminDoc(dbName, 'notebook')
  if (notebook?.ingestToken) return notebook.ingestToken
  const token = ulid()
  await setDrainIngestionToken(dbName, token)
  return token
}

export async function recordIngestionEvent(dbName: string) {
  const notebook = await getAdminDoc(dbName, 'notebook')
  await putAdminDoc(dbName, { ...notebook, lastIngestedAt: Date.now() })
}

// Shape shared by every non-human-authored entry (GitHub ingestion, AI
// summaries) — a fixed identity instead of a real user's, so EntryBlockView
// can render a distinct badge via the `source` field (see BlockParagraph.ts).
interface BotAuthor {
  createdBy: string
  createdByName: string
  createdByColor: string
  createdByEmail: string
  source: string
}

async function putBotEntry(
  dbName: string,
  content: string,
  author: BotAuthor,
  createdAt: number,
  id?: string,
  extra?: Record<string, unknown>
) {
  const doc = {
    _id: `entry:${id ?? ulid()}`,
    type: 'entry',
    content,
    ...author,
    updatedBy: author.createdBy,
    updatedByName: author.createdByName,
    updatedByColor: author.createdByColor,
    updatedByEmail: author.createdByEmail,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  }
  // Not putAdminDoc — this always creates a brand-new doc, never updates an
  // existing one, so a 409 here means the chosen _id genuinely collided with
  // something else (a real problem worth surfacing), unlike putAdminDoc's
  // other callers where 409-as-idempotent-success is the intended behavior.
  const res = await adminFetch(`/${dbName}/${encodeURIComponent(doc._id)}`, {
    method: 'PUT',
    body: JSON.stringify(doc),
  })
  if (!res.ok) throw new Error(`Failed to write ${doc._id} (${res.status})`)
}

const GITHUB_AUTHOR: BotAuthor = {
  createdBy: 'github-ingestion',
  createdByName: 'GitHub',
  createdByColor: '#6e5494',
  createdByEmail: 'github-ingestion@drains.dev',
  source: 'github',
}

export async function createIngestedEntry(dbName: string, content: string, createdAt: number) {
  await putBotEntry(dbName, content, GITHUB_AUTHOR, createdAt)
}

const AI_SUMMARY_AUTHOR: BotAuthor = {
  createdBy: 'ai-summary',
  createdByName: 'AI Summary',
  createdByColor: '#7c3aed',
  createdByEmail: 'ai-summary@drains.dev',
  source: 'ai-summary',
}

// Sorts directly above (a slightly larger id than) the newest entry it
// summarizes — under newest-first/descending order that puts the summary
// right at the top of the section it recaps, instead of "now" (which would
// fly it above entries from more recent days it has nothing to do with).
// createdAt still reflects when it was actually generated, so "created 2m
// ago" in its popover stays truthful even though _id sorts it elsewhere.
export async function createSummaryEntry(
  dbName: string,
  content: string,
  newestSummarizedId: string,
  summarizedEntryIds: string[]
) {
  // This app's ulid generator (monotonicFactory, see AssignBlockId.ts) hands
  // out ids incrementing by exactly 1 for anything minted in the same
  // millisecond — if the day's newest entry was part of a fast burst, +1
  // can land exactly on an id that already belongs to something else.
  // Retry with a random gap on collision instead of failing outright — a
  // FIXED gap sequence (originally 16/256/4096) runs out for real:
  // re-summarizing the same day more than 3 times without deleting the
  // older summaries first permanently claims each of those exact
  // deterministic slots, so the 4th attempt collides on all of them and
  // throws (confirmed directly, not theoretical — this is what happened).
  // Random gaps don't repeat the same collision across separate calls.
  const MAX_ATTEMPTS = 8
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const gap = 16 + Math.floor(Math.random() * 1_000_000)
    try {
      await putBotEntry(dbName, content, AI_SUMMARY_AUTHOR, Date.now(), idAfter(newestSummarizedId, gap), {
        summarizedEntryIds,
      })
      return
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) throw err
    }
  }
}

export async function getEntriesByIds(dbName: string, ids: string[]) {
  const res = await adminFetch(`/${dbName}/_all_docs?include_docs=true`, {
    method: 'POST',
    body: JSON.stringify({ keys: ids }),
  })
  if (!res.ok) throw new Error(`Failed to read entries for ${dbName} (${res.status})`)
  const data = await res.json()
  return data.rows.map((r: any) => r.doc).filter(Boolean)
}

// Most recently modified entries first. The changes feed lists each doc once,
// at its latest revision, so this is "last touched" order — unlike _all_docs,
// which is creation (_id) order. Deleted entries drop out on their own: their
// tombstones carry no `type` field for the selector to match.
export async function getRecentEntryChanges(dbName: string, limit: number) {
  const res = await adminFetch(`/${dbName}/_changes?filter=_selector&descending=true&include_docs=true&limit=${limit}`, {
    method: 'POST',
    body: JSON.stringify({ selector: { type: 'entry' } }),
  })
  if (!res.ok) throw new Error(`Failed to read changes for ${dbName} (${res.status})`)
  const data = await res.json()
  return data.results.map((r: any) => r.doc).filter(Boolean)
}

export async function getPublicEntries(dbName: string) {
  const qs = new URLSearchParams({
    startkey: JSON.stringify('entry:'),
    endkey: JSON.stringify('entry:￿'),
    include_docs: 'true',
  })
  const res = await adminFetch(`/${dbName}/_all_docs?${qs}`)
  if (!res.ok) throw new Error(`Failed to read entries for ${dbName} (${res.status})`)
  const data = await res.json()
  return data.rows
    .map((r: any) => r.doc)
    .filter(Boolean)
    .sort((a: any, b: any) => b.createdAt - a.createdAt)
}

// The stored doc's real _id is "entry:<ulid>", but every other id this app
// hands a client (node attrs, search results, summarize/edit/delete params)
// is the bare ulid — an agent naturally passing back what the list/create
// routes returned broke against summarize_day until this was caught in
// real use (it double-prefixed to "entry:entry:<ulid>" and 404'd). Every
// agent-facing entry route uses this before responding, so the whole
// surface uses one consistent id shape.
export function stripEntryPrefix(doc: any) {
  return { ...doc, _id: doc._id.startsWith('entry:') ? doc._id.slice('entry:'.length) : doc._id }
}

// Entry CRUD for the agent API (src/pages/api/drains/[dbName]/entries*) —
// entries otherwise only ever go through direct PouchDB<->CouchDB sync
// using the browser's own login, never through this app's own API at all.
// Writes go through the admin credential, which bypasses validate_doc_update
// entirely (it explicitly exempts _admin), so the author-only edit/delete
// rule it enforces for real users has to be re-implemented here at the app
// level — otherwise an API token would end up MORE powerful than a signed-in
// user, not at parity with one.
export async function getEntriesPage(dbName: string, limit: number, before?: string) {
  const qs = new URLSearchParams({
    startkey: JSON.stringify(before ? `entry:${before}` : 'entry:￿'),
    endkey: JSON.stringify('entry:'),
    descending: 'true',
    include_docs: 'true',
    limit: String(limit),
    ...(before ? { skip: '1' } : {}),
  })
  const res = await adminFetch(`/${dbName}/_all_docs?${qs}`)
  if (!res.ok) throw new Error(`Failed to read entries for ${dbName} (${res.status})`)
  const data = await res.json()
  return data.rows.map((r: any) => r.doc).filter(Boolean)
}

// createdBy/updatedBy use publicUserId (a hash), matching exactly what the
// normal browser save path (services/entries.ts) stamps them with — not
// email. Mismatching this was a real bug: an entry created via the agent
// API and then also touched once through the actual web UI ended up with
// two differently-shaped identifiers for the same person on the same doc
// (email-shaped from the agent, hash-shaped from the browser), which reads
// like two different accounts touched it. createdByEmail/updatedByEmail
// stay the real email either way — that's what author-only edit/delete
// checks compare, so access control itself was never affected by this.
interface UserIdentity {
  email: string
  name: string
  color: string
  publicUserId: string
}

export async function createUserEntry(dbName: string, content: string, identity: UserIdentity, viaToken: string) {
  const now = Date.now()
  const doc = {
    _id: `entry:${ulid()}`,
    type: 'entry',
    content,
    createdBy: identity.publicUserId,
    createdByName: identity.name,
    createdByColor: identity.color,
    createdByEmail: identity.email,
    createdAt: now,
    updatedBy: identity.publicUserId,
    updatedByName: identity.name,
    updatedByColor: identity.color,
    updatedByEmail: identity.email,
    updatedAt: now,
    viaToken,
  }
  await putAdminDoc(dbName, doc)
  return doc
}

// Both throw a recognizable error the API route maps to 403 when the
// caller isn't the entry's own author — same restriction
// validate_doc_update enforces for a real signed-in user's own sync.
export async function updateUserEntryAsAuthor(
  dbName: string,
  entryId: string,
  content: string,
  identity: UserIdentity
) {
  const doc = await getAdminDoc(dbName, `entry:${entryId}`)
  if (!doc) throw new Error('NOT_FOUND')
  if (doc.createdByEmail !== identity.email) throw new Error('FORBIDDEN')
  const updated = {
    ...doc,
    content,
    updatedBy: identity.publicUserId,
    updatedByName: identity.name,
    updatedByColor: identity.color,
    updatedByEmail: identity.email,
    updatedAt: Date.now(),
  }
  await putAdminDoc(dbName, updated)
  return updated
}

export async function deleteUserEntryAsAuthor(dbName: string, entryId: string, email: string) {
  const doc = await getAdminDoc(dbName, `entry:${entryId}`)
  if (!doc) throw new Error('NOT_FOUND')
  if (doc.createdByEmail !== email) throw new Error('FORBIDDEN')
  await adminFetch(`/${dbName}/${encodeURIComponent(doc._id)}?rev=${doc._rev}`, { method: 'DELETE' })
}

// The directory caches each drain's title/description/tags so the sidebar
// can list drains without opening every member's database — update every
// current member's cached copy when a drain's metadata changes.
export async function updateDirectoryMetaForAllMembers(
  dbName: string,
  meta: { title?: string; description?: string; tags?: string[]; trashedAt?: number | null }
) {
  const members = await getDrainMembers(dbName)
  for (const email of members) {
    await updateAdminDoc(
      DIRECTORY_DB,
      `user:${email}`,
      (doc) => ({
        ...doc,
        drains: (doc.drains ?? []).map((d: DirectoryDrainEntry) => (d.dbName === dbName ? { ...d, ...meta } : d)),
      }),
      () => ({ _id: `user:${email}`, type: 'directory', drains: [] })
    )
  }
}

// Soft-delete: "deleting" a drain marks it trashed instead of destroying
// anything. The underlying CouchDB database, its _security, and every
// entry/comment in it are left completely untouched — only the cached
// directory listing (what the sidebar's normal drain list reads) changes,
// so it just disappears from view. Restorable any time before
// purgeExpiredTrash actually removes it.
export async function trashDrain(dbName: string) {
  const notebook = await getAdminDoc(dbName, 'notebook')
  await putAdminDoc(dbName, { ...notebook, trashedAt: Date.now() })
  await updateDirectoryMetaForAllMembers(dbName, { trashedAt: Date.now() })
}

export async function restoreDrain(dbName: string) {
  const notebook = await getAdminDoc(dbName, 'notebook')
  await putAdminDoc(dbName, { ...notebook, trashedAt: null })
  await updateDirectoryMetaForAllMembers(dbName, { trashedAt: null })
}

const TRASH_RETENTION_DAYS = 30

// Permanently deletes a drain right now, bypassing the trash window
// entirely — the explicit "delete forever" action, not the default one.
// Directory entries are removed BEFORE the actual database destruction
// (reversed from this route's original order): if the directory cleanup
// partially fails, the real data is still sitting there intact and safe
// to retry, rather than orphaning stale directory pointers at a database
// that no longer exists.
export async function purgeDrainNow(dbName: string) {
  const members = await getDrainMembers(dbName)
  await Promise.all(members.map((email) => removeDirectoryDrain(email, dbName)))
  await deleteDrainDatabase(dbName)
}

// Called opportunistically from GET /api/drains (piggybacking on a request
// that's already happening) rather than a dedicated background job — this
// app has no persistent worker/cron infra, and a lazy per-owner sweep on
// their own next visit is a reasonable tradeoff over adding one just for
// this. Only ever looks at drains this specific caller owns.
export async function purgeExpiredTrash(email: string) {
  const drains = await getDirectoryDrains(email)
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
  const expired = drains.filter((d) => d.role === 'owner' && d.trashedAt && d.trashedAt < cutoff)
  for (const d of expired) {
    await purgeDrainNow(d.dbName).catch(() => {})
  }
}
