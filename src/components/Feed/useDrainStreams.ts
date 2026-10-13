import { useEffect } from 'react'
import { getDrainDb } from '@/services/db'
import { loadStreams, loadLinks, watchStreams, applyLinkChange } from '@/services/streams'
import { $streams, $streamLinks, $feedFilter } from '@/stores/streams'
import { EMPTY_FILTER, type FeedFilter } from './feedFilter'

// v2: channel selection replaced the old hiddenStreams/showUnfiled layers;
// a new key means stale v1 state is simply ignored, not misread.
const filterKey = (dbName: string) => `sk_filter2:${dbName}`

// Only the channel and author selection persist — search always starts
// empty, like a find bar.
function loadStoredFilter(dbName: string): FeedFilter {
  if (typeof localStorage === 'undefined') return EMPTY_FILTER
  try {
    const raw = localStorage.getItem(filterKey(dbName))
    if (!raw) return EMPTY_FILTER
    const parsed = JSON.parse(raw)
    return {
      ...EMPTY_FILTER,
      streams: new Set(Array.isArray(parsed.streams) ? parsed.streams : []),
      authors: new Set(Array.isArray(parsed.authors) ? parsed.authors : []),
    }
  } catch {
    return EMPTY_FILTER
  }
}

function saveFilter(dbName: string, f: FeedFilter) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(filterKey(dbName), JSON.stringify({ streams: [...f.streams], authors: [...f.authors] }))
}

// Loads a drain's streams + streamlinks into the shared stores and keeps
// them live via watchStreams, and restores/persists the filter's tick
// state per drain. Cancels its watch on unmount or when dbName changes —
// caller doesn't need to hold onto anything.
export function useDrainStreams(dbName: string) {
  useEffect(() => {
    const db = getDrainDb(dbName)
    let cancelled = false

    $feedFilter.set(loadStoredFilter(dbName))

    Promise.all([loadStreams(db), loadLinks(db)]).then(([streams, links]) => {
      if (cancelled) return
      $streams.set(streams)
      $streamLinks.set(links)
    })

    const changes = watchStreams(db, (change) => {
      if (change.kind === 'stream') {
        if (change.deleted) {
          $streams.set($streams.get().filter((s) => s._id !== change.id))
        } else if (change.doc) {
          const doc = change.doc as any
          const existing = $streams.get()
          const idx = existing.findIndex((s) => s._id === doc._id)
          if (idx === -1) $streams.set([...existing, doc])
          else $streams.set(existing.map((s, i) => (i === idx ? doc : s)))
        }
        return
      }

      // Copy-on-write: applyLinkChange mutates its Map/Sets in place (by
      // design — see streams.ts), so hand it a deep-enough clone (new Map,
      // new Set per entry) rather than the live one, then publish that
      // clone as the new reference. A shallow Map copy alone would still
      // share Set objects with whatever previously read $streamLinks.
      const next = new Map([...$streamLinks.get()].map(([id, set]) => [id, new Set(set)]))
      applyLinkChange(next, change as any)
      $streamLinks.set(next)
    })

    return () => {
      cancelled = true
      changes.cancel()
    }
  }, [dbName])

  useEffect(() => {
    const unsubscribe = $feedFilter.subscribe((f) => saveFilter(dbName, f))
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbName])
}
