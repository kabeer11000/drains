// Pure filter engine for the feed (stream channels, people, search). No
// React, no Tiptap, no PouchDB — this file only combines already-loaded
// data so it can be unit tested without a DOM or a database.

// Pseudo-stream for entries filed nowhere. '~' can never come out of
// slugify() (it only emits letters, digits and '-'), so it can't collide
// with a real stream's slug.
export const UNSORTED = '~unsorted'

export interface FeedFilter {
  // Channel selection: empty = "All entries". Otherwise an entry shows if
  // it's in any selected stream (or has none and UNSORTED is selected).
  streams: Set<string>
  authors: Set<string>
  // Search narrows the feed only when the user asks for it ("Only
  // matches"); by default it highlights and lists results instead.
  query: string
  onlyMatches: boolean
}

export const EMPTY_FILTER: FeedFilter = {
  streams: new Set(),
  authors: new Set(),
  query: '',
  onlyMatches: false,
}

export function isFilterActive(f: FeedFilter): boolean {
  return f.streams.size > 0 || f.authors.size > 0 || (f.onlyMatches && f.query.trim().length > 0)
}

// Plain click switches to a channel (clicking the active one goes back to
// All); Ctrl/Cmd-click adds or removes it from a multi-selection.
export function selectStream(f: FeedFilter, slug: string, additive: boolean): FeedFilter {
  const streams = new Set(f.streams)
  if (additive) {
    if (streams.has(slug)) streams.delete(slug)
    else streams.add(slug)
  } else if (streams.size === 1 && streams.has(slug)) {
    streams.clear()
  } else {
    streams.clear()
    streams.add(slug)
  }
  return { ...f, streams }
}

// The one real stream new entries should be filed into: exactly one
// channel selected and it isn't Unsorted. Anything else is ambiguous.
export function singleSelectedStream(f: FeedFilter): string | null {
  if (f.streams.size !== 1) return null
  const [slug] = f.streams
  return slug === UNSORTED ? null : slug
}

// Non-human writers (the GitHub webhook, the AI day-summary, an API
// token) are authors, not streams: they didn't opt an entry into a
// category, they just wrote it, same as a person would.
export function authorKeyOf(attrs: {
  source?: string | null
  viaToken?: string | null
  createdByEmail?: string | null
  createdByName?: string | null
}): string {
  if (attrs.source) return `source:${attrs.source}`
  if (attrs.viaToken) return `token:${attrs.viaToken}`
  if (attrs.createdByEmail) return attrs.createdByEmail.toLowerCase()
  return `name:${attrs.createdByName ?? ''}`
}

export function describeAuthorKey(key: string): string {
  if (key === 'source:github') return 'GitHub'
  if (key === 'source:ai-summary') return 'AI Summary'
  if (key.startsWith('source:')) return key.slice('source:'.length)
  if (key.startsWith('token:')) return key.slice('token:'.length)
  if (key.startsWith('name:')) return key.slice('name:'.length)
  return key // bare (lowercased) email
}

// Links to deleted streams don't count — an entry whose only streams were
// deleted falls back to Unsorted rather than vanishing.
export function liveLinksOf(links: Set<string> | undefined, liveStreams: Set<string>): string[] {
  return links ? [...links].filter((slug) => liveStreams.has(slug)) : []
}

// Entries per live stream, from the drain-wide link index — so a stream's
// count is right before its older entries are scrolled in.
export function countByStream(links: Map<string, Set<string>>, liveStreams: Set<string>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const set of links.values()) {
    for (const slug of liveLinksOf(set, liveStreams)) counts.set(slug, (counts.get(slug) ?? 0) + 1)
  }
  return counts
}

// Nothing narrows the feed and no search is being stepped through.
export function isPristine(f: FeedFilter, searching: boolean): boolean {
  return !searching && f.streams.size === 0 && f.authors.size === 0 && !(f.onlyMatches && f.query.trim())
}

export function isEntryVisible(
  entry: { authorKey: string; pinned?: boolean; matches?: boolean },
  links: Set<string> | undefined,
  liveStreams: Set<string>,
  f: FeedFilter
): boolean {
  if (entry.pinned) return true

  if (f.streams.size > 0) {
    const effective = liveLinksOf(links, liveStreams)
    const inStream = effective.length === 0 ? f.streams.has(UNSORTED) : effective.some((s) => f.streams.has(s))
    if (!inStream) return false
  }

  if (f.authors.size > 0 && !f.authors.has(entry.authorKey)) return false

  if (f.onlyMatches && f.query.trim() && entry.matches === false) return false

  return true
}
