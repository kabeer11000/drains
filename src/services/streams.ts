import type { EntryIdentity } from './entries'

export interface StreamDoc {
  _id: string
  _rev?: string
  type: 'stream'
  name: string
  color: string
  createdByEmail: string
  createdAt: number
}

export interface StreamLinkDoc {
  _id: string
  _rev?: string
  type: 'streamlink'
  entryId: string
  streamId: string
  createdByEmail: string
  createdAt: number
}

const streamPrefix = 'stream:'
const linkPrefix = 'streamlink:'

// The slug is what everything else (streamlink docs, FeedFilter's
// streams) actually keys off of — this is the one place that turns a
// stream doc's _id back into it, so callers never re-derive it by hand.
export function slugOfStream(doc: { _id: string }): string {
  return doc._id.slice(streamPrefix.length)
}

// Fixed palette rather than a color picker: 8 is enough to tell streams
// apart at a glance, and light-dark() (same trick as MentionExtension's
// colorsForEmail) keeps each one readable without a separate dark theme
// palette to maintain.
export const STREAM_COLORS = [
  'light-dark(hsl(0, 65%, 45%), hsl(0, 70%, 70%))',
  'light-dark(hsl(30, 70%, 40%), hsl(30, 75%, 65%))',
  'light-dark(hsl(50, 75%, 38%), hsl(50, 80%, 62%))',
  'light-dark(hsl(140, 45%, 35%), hsl(140, 50%, 62%))',
  'light-dark(hsl(180, 50%, 32%), hsl(180, 55%, 60%))',
  'light-dark(hsl(210, 60%, 45%), hsl(210, 65%, 70%))',
  'light-dark(hsl(265, 50%, 50%), hsl(265, 60%, 75%))',
  'light-dark(hsl(320, 55%, 45%), hsl(320, 60%, 72%))',
]

// Doc-id-safe slug: lowercase, collapse anything that isn't a letter or
// digit into a single '-', trim the edges. Unicode letters (e.g. "café")
// are kept as-is via \p{L}/\p{N} rather than stripped to ASCII, so names in
// other scripts still produce a readable id instead of falling through to
// the 'stream' fallback.
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'stream'
}

export async function loadStreams(db: PouchDB.Database): Promise<StreamDoc[]> {
  const res = await db.allDocs({
    startkey: streamPrefix,
    endkey: streamPrefix + '￿',
    include_docs: true,
  })
  return res.rows.map((r: any) => r.doc)
}

export async function loadLinks(db: PouchDB.Database): Promise<Map<string, Set<string>>> {
  const res = await db.allDocs({
    startkey: linkPrefix,
    endkey: linkPrefix + '￿',
    include_docs: true,
  })
  const map = new Map<string, Set<string>>()
  for (const row of res.rows) {
    const doc = row.doc as any as StreamLinkDoc
    // Read entryId/streamId from the doc body, never by splitting _id —
    // entry ids may contain ':' or other unusual characters themselves.
    const set = map.get(doc.entryId) ?? new Set<string>()
    set.add(doc.streamId)
    map.set(doc.entryId, set)
  }
  return map
}

const MAX_SAVE_ATTEMPTS = 3

// Two members creating "HCI" offline should converge on one stream, but a
// renamed stream must not be silently overwritten. So: same slug + same
// name (case-insensitive) -> that's the same stream, return it. Same slug
// + different name -> the slug is taken by something else, try the next
// numbered suffix.
export async function createStream(
  db: PouchDB.Database,
  name: string,
  identity: EntryIdentity,
  color?: string
): Promise<StreamDoc> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Stream name cannot be empty')
  const baseSlug = slugify(trimmed)
  const chosenColor = color ?? STREAM_COLORS[0]

  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt++) {
    let slug = baseSlug
    for (let suffix = 2; ; suffix++) {
      const id = `${streamPrefix}${slug}`
      let existing: StreamDoc | null = null
      try {
        existing = await db.get(id)
      } catch (err: any) {
        // 404 covers both "never existed" and "deleted" (a tombstone) —
        // both are free to reuse: put without _rev overwrites the tombstone.
        if (err?.status !== 404) throw err
      }

      if (!existing) {
        const doc: StreamDoc = {
          _id: id,
          type: 'stream',
          name: trimmed,
          color: chosenColor,
          createdByEmail: identity.email,
          createdAt: Date.now(),
        }
        try {
          await db.put(doc)
          return doc
        } catch (err: any) {
          if (err?.status === 409) break // someone beat us to this id; retry outer loop
          throw err
        }
      }

      if (existing.name.toLowerCase() === trimmed.toLowerCase()) return existing

      slug = `${baseSlug}-${suffix}`
    }
  }
  throw new Error('Failed to create stream after retries')
}

async function getMutatePut(
  db: PouchDB.Database,
  slug: string,
  mutate: (doc: StreamDoc) => void
): Promise<StreamDoc> {
  const id = `${streamPrefix}${slug}`
  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt++) {
    const doc: StreamDoc = await db.get(id)
    mutate(doc)
    try {
      await db.put(doc)
      return doc
    } catch (err: any) {
      if (err?.status !== 409 || attempt === MAX_SAVE_ATTEMPTS - 1) throw err
    }
  }
  throw new Error(`Failed to update ${id} after retries`)
}

// Id never changes on rename — only the '#hci' slug is stable across edits;
// the display name can drift freely.
export function renameStream(db: PouchDB.Database, slug: string, newName: string) {
  return getMutatePut(db, slug, (doc) => {
    doc.name = newName.trim()
  })
}

export function recolorStream(db: PouchDB.Database, slug: string, color: string) {
  return getMutatePut(db, slug, (doc) => {
    doc.color = color
  })
}

// Removes only the stream doc; streamlink docs are left in place on
// purpose (see restoreStream) so an "Undo" toast can bring the stream and
// its whole membership back with one put.
export async function deleteStream(db: PouchDB.Database, slug: string): Promise<Omit<StreamDoc, '_rev'>> {
  const id = `${streamPrefix}${slug}`
  const doc: any = await db.get(id)
  await db.remove(doc)
  const { _rev, ...rest } = doc as StreamDoc
  return rest
}

export async function restoreStream(db: PouchDB.Database, doc: Omit<StreamDoc, '_rev'>): Promise<StreamDoc> {
  const { _rev, ...rest } = doc as StreamDoc
  await db.put(rest)
  return rest
}

export async function linkEntry(
  db: PouchDB.Database,
  entryId: string,
  slug: string,
  identity: EntryIdentity
): Promise<void> {
  const doc: StreamLinkDoc = {
    _id: `${linkPrefix}${entryId}:${slug}`,
    type: 'streamlink',
    entryId,
    streamId: slug,
    createdByEmail: identity.email,
    createdAt: Date.now(),
  }
  try {
    await db.put(doc)
  } catch (err: any) {
    if (err?.status !== 409) throw err // already linked, idempotent no-op
  }
}

export async function unlinkEntry(db: PouchDB.Database, entryId: string, slug: string): Promise<void> {
  try {
    const doc = await db.get(`${linkPrefix}${entryId}:${slug}`)
    await db.remove(doc)
  } catch (err: any) {
    if (err?.status !== 404) throw err
  }
}

export interface StreamChange {
  kind: 'stream' | 'link'
  id: string
  deleted: boolean
  doc?: StreamDoc | StreamLinkDoc
}

// Caller owns the returned handle and must .cancel() it on unmount, same
// contract as comments.ts's watchComments.
export function watchStreams(db: PouchDB.Database, onChange: (change: StreamChange) => void) {
  return db
    .changes({ since: 'now', live: true, include_docs: true })
    .on('change', (change: any) => {
      if (change.id.startsWith(linkPrefix)) {
        onChange({ kind: 'link', id: change.id, deleted: !!change.deleted, doc: change.doc })
      } else if (change.id.startsWith(streamPrefix)) {
        onChange({ kind: 'stream', id: change.id, deleted: !!change.deleted, doc: change.doc })
      }
    })
}

// Pure helper so the feed's in-memory Map<entryId, Set<slug>> can be kept
// in sync from watchStreams without re-reading the whole prefix on every
// change. A deleted link's doc body is gone from the change event, so as a
// fallback we parse entryId/slug out of the id — using the LAST ':' as the
// separator, since slugs come from slugify() and can never contain ':',
// so whatever an entry id contains, the final segment is always the slug.
export function applyLinkChange(
  map: Map<string, Set<string>>,
  change: { id: string; deleted: boolean; doc?: StreamLinkDoc }
): void {
  let entryId: string
  let streamId: string
  if (change.doc && !change.deleted) {
    entryId = change.doc.entryId
    streamId = change.doc.streamId
  } else {
    const rest = change.id.slice(linkPrefix.length)
    const sep = rest.lastIndexOf(':')
    if (sep === -1) return
    entryId = rest.slice(0, sep)
    streamId = rest.slice(sep + 1)
  }

  if (change.deleted) {
    const set = map.get(entryId)
    if (!set) return
    set.delete(streamId)
    if (set.size === 0) map.delete(entryId)
  } else {
    const set = map.get(entryId) ?? new Set<string>()
    set.add(streamId)
    map.set(entryId, set)
  }
}

export interface StreamLabel {
  slug: string
  name: string
  color: string
}

// entryId (raw, no 'entry:' prefix) -> the live streams it's filed in, built
// from a drain's raw docs. Pure, so the server (public page), the export
// and the search index share it. Links to deleted streams are dropped.
export function buildStreamIndex(docs: any[]): { streams: StreamLabel[]; byEntry: Map<string, StreamLabel[]> } {
  const streams: StreamLabel[] = docs
    .filter((d) => d?.type === 'stream' && typeof d._id === 'string')
    .map((d) => ({ slug: d._id.slice(streamPrefix.length), name: d.name, color: d.color }))
  const bySlug = new Map(streams.map((s) => [s.slug, s]))
  const byEntry = new Map<string, StreamLabel[]>()
  for (const d of docs) {
    if (d?.type !== 'streamlink') continue
    const stream = bySlug.get(d.streamId)
    if (!stream) continue
    const list = byEntry.get(d.entryId) ?? []
    if (!list.some((s) => s.slug === stream.slug)) list.push(stream)
    byEntry.set(d.entryId, list)
  }
  return { streams, byEntry }
}
