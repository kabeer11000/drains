// Where the feed's entries come from, newest first: every entry in the
// drain (range scans on the drain's own index), or a fixed list of ids (a
// stream filter or "only matches" search). The feed only ever holds a
// window of this sequence; these functions fetch the pages around it.
//
// Ids are raw ULIDs (no 'entry:' prefix). ULIDs sort by time, so "newer"
// means a larger id.

export type EntrySource = { kind: 'all' } | { kind: 'ids'; ids: string[] } // ids: newest first

const PREFIX = 'entry:'
const END = PREFIX + '￿'

type Db = Pick<PouchDB.Database, 'allDocs'>

const docsOf = (res: any) =>
  res.rows.map((r: any) => r.doc).filter((d: any) => d && !d._deleted && typeof d._id === 'string')

async function byIds(db: Db, ids: string[]) {
  if (!ids.length) return []
  return docsOf(await db.allDocs({ keys: ids.map((id) => PREFIX + id), include_docs: true }))
}

// Index of `rid` in a newest-first id list, or where it would go.
export function positionOf(ids: string[], rid: string): number {
  let lo = 0
  let hi = ids.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ids[mid] > rid) lo = mid + 1
    else hi = mid
  }
  return lo
}

export async function fetchLatest(db: Db, source: EntrySource, limit: number) {
  if (source.kind === 'ids') return byIds(db, source.ids.slice(0, limit))
  return docsOf(await db.allDocs({ startkey: END, endkey: PREFIX, descending: true, include_docs: true, limit }))
}

// Entries older than `rid`, newest first.
export async function fetchOlder(db: Db, source: EntrySource, rid: string, limit: number) {
  if (source.kind === 'ids') {
    const at = positionOf(source.ids, rid)
    const start = source.ids[at] === rid ? at + 1 : at
    return byIds(db, source.ids.slice(start, start + limit))
  }
  return docsOf(
    await db.allDocs({ startkey: PREFIX + rid, endkey: PREFIX, descending: true, skip: 1, include_docs: true, limit })
  )
}

// Entries newer than `rid`, newest first (the closest `limit` of them).
export async function fetchNewer(db: Db, source: EntrySource, rid: string, limit: number) {
  if (source.kind === 'ids') {
    const at = positionOf(source.ids, rid)
    return byIds(db, source.ids.slice(Math.max(0, at - limit), at))
  }
  const asc = docsOf(await db.allDocs({ startkey: PREFIX + rid, endkey: END, skip: 1, include_docs: true, limit }))
  return asc.reverse()
}

// A window around `rid`: up to `newer` entries above it, it, and `older`
// below. Flags say whether more exist beyond each end.
export async function fetchAround(db: Db, source: EntrySource, rid: string, newer: number, older: number) {
  if (source.kind === 'ids') {
    const at = positionOf(source.ids, rid)
    // rid itself counts only if it's in the list.
    const take = source.ids[at] === rid ? older + 1 : older
    const [above, below] = await Promise.all([
      fetchNewer(db, source, rid, newer),
      byIds(db, source.ids.slice(at, at + take)),
    ])
    return { docs: [...above, ...below], hasNewer: at > newer, hasOlder: at + take < source.ids.length }
  }
  const [above, below] = await Promise.all([
    fetchNewer(db, source, rid, newer),
    // Includes rid (no skip), plus `older` below it.
    db
      .allDocs({ startkey: PREFIX + rid, endkey: PREFIX, descending: true, include_docs: true, limit: older + 1 })
      .then(docsOf),
  ])
  return { docs: [...above, ...below], hasNewer: above.length === newer, hasOlder: below.length === older + 1 }
}

// Keep a newest-first id list current as entries come and go.
export function withId(ids: string[], rid: string): string[] {
  const at = positionOf(ids, rid)
  if (ids[at] === rid) return ids
  return [...ids.slice(0, at), rid, ...ids.slice(at)]
}

export function withoutId(ids: string[], rid: string): string[] {
  const at = positionOf(ids, rid)
  return ids[at] === rid ? [...ids.slice(0, at), ...ids.slice(at + 1)] : ids
}
