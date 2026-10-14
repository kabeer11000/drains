import { atom } from 'nanostores'
import type { CommentDoc } from '@/services/comments'

// The open drain's comments, published by Feed so an entry's own menu can
// list them — the comments column is desktop-only.
export const $comments = atom<CommentDoc[]>([])

// Set by an entry's menu ("Summarize this day"); Feed works out which day
// that entry belongs to and runs the same summarize as the sidebar.
export const $summarizeDayOf = atom<string | null>(null)

// Every entry id in the open drain, newest first (raw ULIDs, which also
// encode each entry's time). Ids only, cheap even at 100k entries; the feed
// keeps it current. The scrubber, day outline and filters work from this,
// since the editor only ever holds a window of entries.
export const $entryIndex = atom<string[]>([])

// The ids the feed is currently paging through when a stream or "only
// matches" filter is active (newest first); null means every entry.
export const $sourceIds = atom<string[] | null>(null)

// Scroll the feed to an entry, loading a window around it if it isn't in the
// editor (scrubber, day outline, quotes). 'start' puts it under the header.
export const $jumpTo = atom<{ entryId: string; block: 'start' | 'center' } | null>(null)
