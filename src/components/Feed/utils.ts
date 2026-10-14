import { decodeTime } from 'ulid'
import { $feedFilter, $searchJump, $streams, showAllEntries } from '@/stores/streams'
import { isPristine, selectStream } from './feedFilter'
import { slugOfStream } from '@/services/streams'
export function relativeTime(ts: number) {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(ts).toLocaleDateString()
}

// Safe extraction of author name
export function safeName(val: any): string {
  if (typeof val === 'string') return val
  if (typeof val === 'number') return String(val)
  if (val && typeof val === 'object' && typeof val.name === 'string') return val.name
  return 'Anonymous'
}

// Safe extraction of author color. Identity colors are CSS hsl() strings
// (see deriveIdentity in services/identity.ts), not hex.
export function safeColor(val: any): string {
  if (typeof val === 'string' && val.trim()) return val
  if (val && typeof val === 'object' && typeof val.color === 'string') return val.color
  return '#999'
}

// Day an entry belongs to, read from the time encoded in its id rather than
// createdAt — the feed is ordered by id, and the two disagree for split
// entries: the split-off half keeps an id derived from its neighbour
// (AssignBlockId/idBetween, so the same time prefix) but gets a fresh
// createdAt. Grouping by createdAt dropped those entries out of the day
// they visibly sit in, leaving gaps in that day's summary.
export function entryDayTs(entryId: string, createdAt: unknown) {
  try {
    return decodeTime(entryId.slice(0, 26))
  } catch {
    return Number(createdAt)
  }
}

export function dayLabel(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  })
}

export function scrollFeedToTop() {
  document.querySelector('[data-feed-scroller]')?.scrollTo({ top: 0, behavior: 'smooth' })
}

// The "All entries" control (sidebar row, mobile bar, Alt+0): clears every
// filter and search; pressed again on an unfiltered feed, back to the top.
export function goToAllEntries() {
  if (isPristine($feedFilter.get(), !!$searchJump.get()?.query)) scrollFeedToTop()
  else showAllEntries()
}

// Alt+1..9 opens the Nth stream (sidebar order), Alt+0 is All entries.
// Alt rather than Ctrl/Cmd: those digits switch browser tabs.
export function handleChannelShortcut(e: KeyboardEvent): boolean {
  if (!e.altKey || e.ctrlKey || e.metaKey || !/^Digit[0-9]$/.test(e.code)) return false
  const n = Number(e.code.slice(5))
  if (n === 0) {
    goToAllEntries()
    return true
  }
  const stream = $streams.get()[n - 1]
  if (!stream) return false
  $searchJump.set(null)
  $feedFilter.set(selectStream({ ...$feedFilter.get(), streams: new Set() }, slugOfStream(stream), false))
  return true
}

export interface DayGroup {
  key: string
  label: string
  entryId: string // the day's first (newest) entry, to jump to
  entryIds: string[] // what "Summarize this day" sends
}

// Entries grouped by day, in feed order. AI summaries are skipped so a day
// is never re-summarized from its own summary; hidden (filtered-out)
// entries are skipped so days and summaries follow the open stream.
export function collectDays(doc: { forEach: (fn: (node: any) => void) => void }, hidden: Set<string>): DayGroup[] {
  const byDay = new Map<string, DayGroup>()
  doc.forEach((node: any) => {
    const { entryId, createdAt, source } = node.attrs ?? {}
    if (node.type.name !== 'paragraph' || !entryId || !createdAt || source === 'ai-summary' || hidden.has(entryId)) return
    const ts = entryDayTs(entryId, createdAt)
    const key = new Date(ts).toDateString()
    const day = byDay.get(key)
    if (day) day.entryIds.push(entryId)
    else byDay.set(key, { key, label: dayLabel(ts), entryId, entryIds: [entryId] })
  })
  return [...byDay.values()]
}

// Days from entry ids alone (newest first). ULIDs carry their creation
// time, so the whole drain's day outline needs no entry content — the
// editor only holds a window of entries.
export function daysFromIds(ids: string[]): DayGroup[] {
  const days: DayGroup[] = []
  let current = null as DayGroup | null
  for (const id of ids) {
    let ts: number
    try {
      ts = decodeTime(id.slice(0, 26))
    } catch {
      continue
    }
    const key = new Date(ts).toDateString()
    if (current?.key !== key) {
      current = { key, label: dayLabel(ts), entryId: id, entryIds: [] }
      days.push(current)
    }
    current.entryIds.push(id)
  }
  return days
}
