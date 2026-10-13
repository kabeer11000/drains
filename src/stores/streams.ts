import { atom } from 'nanostores'
import type { StreamDoc } from '@/services/streams'
import { EMPTY_FILTER, type FeedFilter } from '@/components/Feed/feedFilter'

export const $streams = atom<StreamDoc[]>([])

// Map<entryId, Set<slug>> — entryIds here are RAW ids (node.attrs.entryId,
// no 'entry:' prefix), matching what the editor and feedFilter both use.
// Always replaced with a new Map instance on change (never mutated in
// place) so nanostores' reference-based change detection fires.
export const $streamLinks = atom<Map<string, Set<string>>>(new Map())

export const $feedFilter = atom<FeedFilter>(EMPTY_FILTER)

// Set when a search result in the current drain is picked (CommandPalette):
// the feed scrolls to entryIds[index], highlights the query's words, and
// shows a small "3 / 5" pill to step through the rest.
export interface SearchJump {
  query: string
  entryIds: string[]
  index: number
}
export const $searchJump = atom<SearchJump | null>(null)

// Which drain's editor is currently on screen — set once by Feed/index.tsx.
// Exists only so node views (EntryBlockView's chips/+# popover) can reach
// getDrainDb(dbName) without it being threaded through as a Tiptap NodeView
// prop (Tiptap doesn't pass arbitrary custom props into node views; the
// alternatives were extension storage, which node views also can't read
// directly without going through the editor instance anyway, or a context
// provider wrapping EditorContent, which is more machinery for the same
// one string). Identity itself doesn't need a duplicate store — node views
// already read the existing $identity directly.
export const $activeDrain = atom<{ dbName: string } | null>(null)

// "All entries": drop every way the feed is narrowed — channel, people,
// only-matches search — and the search being stepped through.
export function showAllEntries() {
  $feedFilter.set(EMPTY_FILTER)
  $searchJump.set(null)
}
