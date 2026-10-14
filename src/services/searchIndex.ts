import { getDrainDb } from './db'
import { stripHtml } from '@/utils/stripHtml'
import { authorKeyOf } from '@/components/Feed/feedFilter'
import { buildStreamIndex } from './streams'
import { matchesEntry, type ParsedQuery } from '@/components/Feed/search'

// Per-drain text index for search: every entry's plain text, author, streams
// and done state, newest first. Shared by the search dialog and the feed's
// "only matches" filter (which needs matching ids across the whole drain,
// not just the entries loaded into the editor). Cached per drain until the
// local DB's update_seq changes.

export interface StreamInfo {
  slug: string
  name: string
  color: string
}

export interface IndexedEntry {
  entryId: string
  text: string
  createdAt: number
  updatedAt: number
  done: boolean
  streams: StreamInfo[]
  authorName: string
  authorKey: string
  source?: string | null
  viaToken?: string | null
}

export interface DrainIndex {
  dbName: string
  title: string
  entries: IndexedEntry[]
  streams: StreamInfo[]
}

// Struck-through text is how people mark an entry done: done = there's
// text, and none of it sits outside an <s>.
function isDoneHtml(html: string) {
  const outside = html.replace(/<s>[\s\S]*?<\/s>/g, '')
  return !!stripHtml(html) && !stripHtml(outside)
}

// One read of a drain's local PouchDB: entries plus its streams and links,
// so #stream / @person / from: / is:done work in any drain, not only the
// one on screen. Local-first: only drains synced to this device are there.
// Reused across opens until the drain's local DB changes (update_seq): every
// open used to re-read and DOM-parse every entry of every drain.
const indexCache = new Map<string, { seq: string | number; index: DrainIndex }>()

export async function getDrainIndex(dbName: string, title: string): Promise<DrainIndex> {
  const db = getDrainDb(dbName)
  const seq = await db
    .info()
    .then((i) => i.update_seq)
    .catch(() => null)
  const cached = indexCache.get(dbName)
  if (seq !== null && cached && cached.seq === seq) return { ...cached.index, title }
  const index = await buildIndex(db, dbName, title)
  if (seq !== null) indexCache.set(dbName, { seq, index })
  return index
}

async function buildIndex(db: PouchDB.Database, dbName: string, title: string): Promise<DrainIndex> {
  const res = await db
    .allDocs({ include_docs: true })
    .catch(() => ({ rows: [] as any[] }))
  const docs = res.rows.map((r: any) => r.doc).filter(Boolean)
  const { streams, byEntry } = buildStreamIndex(docs)
  const entries: IndexedEntry[] = docs
    .filter((d: any) => d._id.startsWith('entry:') && d.content)
    .map((d: any) => {
      const entryId = d._id.slice('entry:'.length)
      return {
        entryId,
        text: stripHtml(d.content),
        createdAt: Number(d.createdAt),
        updatedAt: Number(d.updatedAt ?? d.createdAt),
        done: isDoneHtml(d.content),
        streams: byEntry.get(entryId) ?? [],
        authorName: d.createdByName ?? '',
        authorKey: authorKeyOf(d),
        source: d.source,
        viaToken: d.viaToken,
      }
    })
    .filter((e: IndexedEntry) => e.text)
    // Newest first, same order as the feed.
    .sort((a: IndexedEntry, b: IndexedEntry) => (a.entryId < b.entryId ? 1 : -1))
  return { dbName, title, entries, streams }
}

// Ids (newest first) of the drain's entries matching a parsed query.
export async function matchingIds(dbName: string, query: ParsedQuery): Promise<string[]> {
  const index = await getDrainIndex(dbName, '')
  return index.entries
    .filter((e) => matchesEntry({ ...e, streams: e.streams.flatMap((st) => [st.slug, st.name.toLowerCase()]) }, query))
    .map((e) => e.entryId)
}
