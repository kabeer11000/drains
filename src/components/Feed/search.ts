// Pure search engine for the find bar. Parses the query once, then matches
// already-loaded entries and computes highlight ranges — no DOM, no editor.
//
// Syntax (same tokens as the editor where they overlap):
//   words            every word must appear (AND), case-insensitive
//   "exact phrase"   quoted text matches as one term
//   #hci             entry is in a stream whose name/slug contains "hci"
//   @kabeer          author name or email contains "kabeer"
//   from:github      from:ai (AI summaries), from:agent (any API token),
//                    or from:<token name>
//   is:done/is:open  struck-through entries count as done

export interface ParsedQuery {
  terms: string[]
  streams: string[]
  authors: string[]
  from: string[]
  done: boolean | null
}

export function parseQuery(raw: string): ParsedQuery {
  const parsed: ParsedQuery = { terms: [], streams: [], authors: [], from: [], done: null }
  const tokens = raw.match(/"[^"]*"?|\S+/g) ?? []
  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (lower.startsWith('"')) {
      const phrase = lower.replace(/^"|"$/g, '').trim()
      if (phrase) parsed.terms.push(phrase)
    } else if (lower.length > 1 && lower.startsWith('#')) {
      parsed.streams.push(lower.slice(1))
    } else if (lower.length > 1 && lower.startsWith('@')) {
      parsed.authors.push(lower.slice(1))
    } else if (lower.startsWith('from:') && lower.length > 5) {
      parsed.from.push(lower.slice(5))
    } else if (lower === 'is:done') {
      parsed.done = true
    } else if (lower === 'is:open') {
      parsed.done = false
    } else {
      parsed.terms.push(lower)
    }
  }
  return parsed
}

export function isEmptyQuery(q: ParsedQuery): boolean {
  return !q.terms.length && !q.streams.length && !q.authors.length && !q.from.length && q.done === null
}

export interface SearchableEntry {
  text: string
  // Lowercased slugs AND display names of the entry's live streams.
  streams: string[]
  authorName: string
  authorKey: string
  source?: string | null
  viaToken?: string | null
  done: boolean
}

function fromMatches(entry: SearchableEntry, from: string): boolean {
  if (from === 'github') return entry.source === 'github'
  if (from === 'ai') return entry.source === 'ai-summary'
  if (from === 'agent' || from === 'bot') return !!entry.viaToken
  return (
    (entry.source ?? '').toLowerCase().includes(from) || (entry.viaToken ?? '').toLowerCase().includes(from)
  )
}

export function matchesEntry(entry: SearchableEntry, q: ParsedQuery): boolean {
  const text = entry.text.toLowerCase()
  if (!q.terms.every((t) => text.includes(t))) return false
  if (!q.streams.every((s) => entry.streams.some((name) => name.includes(s)))) return false
  const author = `${entry.authorName} ${entry.authorKey}`.toLowerCase()
  if (!q.authors.every((a) => author.includes(a))) return false
  if (!q.from.every((f) => fromMatches(entry, f))) return false
  if (q.done !== null && entry.done !== q.done) return false
  return true
}

export interface Range {
  from: number
  to: number
}

// Every occurrence of every term in `text`, sorted and merged so
// overlapping terms ("left", "left recursion") highlight as one span.
export function matchRanges(text: string, terms: string[]): Range[] {
  const lower = text.toLowerCase()
  const ranges: Range[] = []
  for (const term of terms) {
    if (!term) continue
    let at = lower.indexOf(term)
    while (at !== -1) {
      ranges.push({ from: at, to: at + term.length })
      at = lower.indexOf(term, at + term.length)
    }
  }
  ranges.sort((a, b) => a.from - b.from)
  const merged: Range[] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to)
    else merged.push({ ...r })
  }
  return merged
}

export interface SnippetPart {
  text: string
  hit: boolean
}

// A window of `text` around the first hit, split into plain/highlighted
// parts for the results list. Without hits it's just the start of the text.
export function snippet(text: string, ranges: Range[], radius = 60): SnippetPart[] {
  const first = ranges[0]
  const start = first ? Math.max(0, first.from - radius) : 0
  const end = Math.min(text.length, (first ? first.to : 0) + radius * 2)
  const parts: SnippetPart[] = []
  if (start > 0) parts.push({ text: '…', hit: false })
  let at = start
  for (const r of ranges) {
    if (r.to <= start || r.from >= end) continue
    const from = Math.max(r.from, start)
    const to = Math.min(r.to, end)
    if (from > at) parts.push({ text: text.slice(at, from), hit: false })
    parts.push({ text: text.slice(from, to), hit: true })
    at = to
  }
  if (at < end) parts.push({ text: text.slice(at, end), hit: false })
  if (end < text.length) parts.push({ text: '…', hit: false })
  return parts
}
