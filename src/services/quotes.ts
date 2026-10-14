import { getDrainDb } from './db'
import { authHeader } from './apiAuth'

// Resolves the entries that quotes point at, independent of which entries
// the feed happens to have loaded (a quote can point anywhere in a drain, or
// at another drain). Lookups: memory, then the drain's local PouchDB (works
// offline), then the API for drains not synced to this device. One request
// per entry, shared by every quote of it; the feed's live-changes handler
// pushes updates so quotes stay current.

export interface QuotedEntry {
  content: string
  createdAt: number
  createdByName?: string
  createdByColor?: string
}

const MAX_CACHED = 500
const cache = new Map<string, Promise<QuotedEntry | null>>()
const listeners = new Map<string, Set<(entry: QuotedEntry | null) => void>>()

const keyOf = (dbName: string, entryId: string) => `${dbName}#${entryId}`

function pick(doc: any): QuotedEntry | null {
  if (!doc || doc._deleted) return null
  return {
    content: doc.content ?? '',
    createdAt: Number(doc.createdAt) || 0,
    createdByName: doc.createdByName,
    createdByColor: doc.createdByColor,
  }
}

async function load(dbName: string, entryId: string): Promise<QuotedEntry | null> {
  const local = await getDrainDb(dbName)
    .get(`entry:${entryId}`)
    .then(pick)
    .catch(() => undefined)
  if (local !== undefined) return local
  try {
    const res = await fetch(`/api/drains/${dbName}/entries/${encodeURIComponent(entryId)}`, {
      headers: { Authorization: authHeader() },
    })
    if (!res.ok) return null
    return pick((await res.json()).entry)
  } catch {
    return null
  }
}

export function resolveQuote(dbName: string, entryId: string): Promise<QuotedEntry | null> {
  const key = keyOf(dbName, entryId)
  let hit = cache.get(key)
  if (!hit) {
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!)
    hit = load(dbName, entryId)
    cache.set(key, hit)
  }
  return hit
}

export function watchQuote(dbName: string, entryId: string, onChange: (entry: QuotedEntry | null) => void) {
  const key = keyOf(dbName, entryId)
  const set = listeners.get(key) ?? new Set()
  set.add(onChange)
  listeners.set(key, set)
  return () => {
    set.delete(onChange)
    if (!set.size) listeners.delete(key)
  }
}

// Called by the feed for every entry change it sees. Cheap when nothing
// quotes that entry: one Map lookup.
export function notifyEntryChanged(dbName: string, entryId: string, doc: any) {
  const key = keyOf(dbName, entryId)
  if (!listeners.has(key) && !cache.has(key)) return
  const entry = pick(doc)
  cache.set(key, Promise.resolve(entry))
  listeners.get(key)?.forEach((fn) => fn(entry))
}
