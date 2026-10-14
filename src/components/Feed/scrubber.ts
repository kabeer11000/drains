// Pure helpers for the date scrubber (DateScrubber.tsx): label granularity,
// date labels, tick thinning and offset lookups. The scrubber itself maps
// straight onto scroll position like a native scrollbar.

export type Granularity = 'day' | 'month' | 'year'

const DAY = 86_400_000

// Tick labels at the coarsest unit that still splits the drain usefully.
export function chooseGranularity(times: number[]): Granularity {
  if (times.length < 2) return 'day'
  const span = times[0] - times[times.length - 1]
  if (span < 60 * DAY) return 'day'
  if (span < 2 * 365 * DAY) return 'month'
  return 'year'
}

export function unitKey(ts: number, g: Granularity): string {
  const d = new Date(ts)
  if (g === 'year') return String(d.getFullYear())
  if (g === 'month') return `${d.getFullYear()}-${d.getMonth()}`
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function tickLabel(ts: number, g: Granularity): string {
  const d = new Date(ts)
  if (g === 'year') return String(d.getFullYear())
  const thisYear = d.getFullYear() === new Date().getFullYear()
  if (g === 'month') return d.toLocaleDateString(undefined, { month: 'short', year: thisYear ? undefined : 'numeric' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// The bubble while hovering/dragging is always a precise day.
export function bubbleLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const today = new Date(now)
  const yesterday = new Date(now - DAY)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

export interface Tick {
  // Offset from the top of the scrollable content, in px.
  y: number
  label: string
}

// Keep ticks at least `minGapPx` apart on a rail `railPx` tall that maps the
// whole `contentPx` height. Earlier (newer) ticks win a collision.
export function thinTicks(ticks: Tick[], contentPx: number, railPx: number, minGapPx = 22): Tick[] {
  if (contentPx <= 0 || railPx <= 0) return []
  const out: Tick[] = []
  let last = -Infinity
  for (const t of ticks) {
    const px = (t.y / contentPx) * railPx
    if (px - last < minGapPx || railPx - px < minGapPx / 2 || px < minGapPx / 2) continue
    out.push(t)
    last = px
  }
  return out
}

// Index of the last item whose top is at or above `y` (items sorted by top).
export function itemAt(tops: number[], y: number): number {
  let lo = 0
  let hi = tops.length - 1
  let found = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (tops[mid] <= y) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return tops.length ? found : -1
}
