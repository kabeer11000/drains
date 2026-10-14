import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useStore } from '@nanostores/react'
import { decodeTime } from 'ulid'
import { ChevronsUpDown } from 'lucide-react'
import { $entryIndex, $sourceIds, $jumpTo } from '@/stores/feed'
import { positionOf } from './entrySource'
import { bubbleLabel, chooseGranularity, thinTicks, tickLabel, unitKey, type Tick } from './scrubber'

const IDLE_MS = 1200
const THUMB_PX = 36
// Where an entry counts as "current": just under the floating header.
const HEADER_PX = { mobile: 104, desktop: 80 }

function timeOf(entryId: string) {
  try {
    return decodeTime(entryId.slice(0, 26))
  } catch {
    return 0
  }
}

function useMedia(query: string) {
  const [match, setMatch] = useState(false)
  useEffect(() => {
    const mql = matchMedia(query)
    const on = () => setMatch(mql.matches)
    on()
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [query])
  return match
}

// Date scrubber for the whole drain (or the open stream / search), not just
// the entries loaded in the editor — the feed only ever holds a window of
// them. Like Google Docs' scrollbar, it works from the model: the drain's id
// index (ids are ULIDs, so each carries its date). The thumb sits at the
// entry under the header, so it follows scrolling entry by entry; dragging
// shows the date under the pointer and scrolls live through loaded entries,
// and releasing jumps anywhere (the feed swaps in a window around it).
export function DateScrubber({ editor }: { editor: Editor }) {
  const coarse = useMedia('(pointer: coarse)')
  const desktop = useMedia('(min-width: 1024px)')
  const allIds = useStore($entryIndex)
  const sourceIds = useStore($sourceIds)
  const ids = sourceIds ?? allIds
  const times = useMemo(() => ids.map(timeOf), [ids])
  const granularity = useMemo(() => chooseGranularity(times), [times])

  const [activeIndex, setActiveIndex] = useState(0)
  const [dragFrac, setDragFrac] = useState<number | null>(null)
  const [hoverFrac, setHoverFrac] = useState<number | null>(null)
  const [recent, setRecent] = useState(false)
  const [railH, setRailH] = useState(0)
  const railRef = useRef<HTMLDivElement>(null)
  const lastUnit = useRef('')

  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setRailH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [coarse, ids.length > 1])

  // Which entry sits under the header, as an index into `ids`.
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('[data-feed-scroller]')
    if (!scroller) return
    let frame = 0
    let idle: ReturnType<typeof setTimeout> | undefined
    const measure = () => {
      frame = 0
      const line = scroller.getBoundingClientRect().top + (desktop ? HEADER_PX.desktop : HEADER_PX.mobile)
      const cards = Array.from(editor.view.dom.querySelectorAll<HTMLElement>('p[data-entry-id]')).filter(
        (el) => el.offsetParent !== null && el.dataset.composer === undefined
      )
      // Binary search: first card whose bottom is below the line.
      let lo = 0
      let hi = cards.length - 1
      let found = cards.length ? cards.length - 1 : -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (cards[mid].getBoundingClientRect().bottom > line) {
          found = mid
          hi = mid - 1
        } else lo = mid + 1
      }
      if (found >= 0) setActiveIndex(Math.min(positionOf(ids, cards[found].dataset.entryId!), Math.max(0, ids.length - 1)))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure)
      setRecent(true)
      clearTimeout(idle)
      idle = setTimeout(() => setRecent(false), IDLE_MS)
    }
    measure()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
      clearTimeout(idle)
    }
  }, [editor, ids, desktop])

  const n = ids.length
  const travel = Math.max(1, railH - THUMB_PX)
  const fracOf = (i: number) => (n <= 1 ? 0 : i / (n - 1))
  const indexAt = (frac: number) => Math.round(Math.min(1, Math.max(0, frac)) * (n - 1))

  const ticks = useMemo(() => {
    const out: Tick[] = []
    let prev = times.length ? unitKey(times[0], granularity) : ''
    for (let i = 1; i < times.length; i++) {
      const key = unitKey(times[i], granularity)
      if (key !== prev) out.push({ y: i, label: tickLabel(times[i], granularity) })
      prev = key
    }
    return thinTicks(out, Math.max(1, n - 1), railH)
  }, [times, granularity, n, railH])

  if (n < 2) return null

  const fracFromEvent = (clientY: number) => {
    const rect = railRef.current!.getBoundingClientRect()
    return (clientY - rect.top - THUMB_PX / 2) / Math.max(1, rect.height - THUMB_PX)
  }

  const scrub = (frac: number) => {
    const f = Math.min(1, Math.max(0, frac))
    setDragFrac(f)
    const i = indexAt(f)
    const unit = unitKey(times[i], granularity)
    if (coarse && lastUnit.current && unit !== lastUnit.current) navigator.vibrate?.(4)
    lastUnit.current = unit
    // Live scroll when the target is already in the editor.
    editor.view.dom.querySelector(`p[data-entry-id="${ids[i]}"]`)?.scrollIntoView({ block: 'start' })
  }
  const commit = (frac: number) => {
    const i = indexAt(frac)
    lastUnit.current = ''
    setDragFrac(null)
    setActiveIndex(i)
    $jumpTo.set({ entryId: ids[i], block: 'start' })
  }
  const step = (to: number) => {
    const i = Math.min(n - 1, Math.max(0, to))
    setActiveIndex(i)
    $jumpTo.set({ entryId: ids[i], block: 'start' })
  }
  // First entry of the next/previous day/month/year.
  const unitStep = (dir: 1 | -1) => {
    const here = unitKey(times[activeIndex], granularity)
    let i = activeIndex
    while (i + dir >= 0 && i + dir < n && unitKey(times[i + dir], granularity) === here) i += dir
    i += dir
    if (dir === -1 && i >= 0) {
      const key = unitKey(times[i], granularity)
      while (i - 1 >= 0 && unitKey(times[i - 1], granularity) === key) i--
    }
    step(i)
  }

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      scrub(fracFromEvent(e.clientY))
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(fracFromEvent(e.clientY))
      else if (!coarse) setHoverFrac(Math.min(1, Math.max(0, fracFromEvent(e.clientY))))
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) commit(fracFromEvent(e.clientY))
    },
    onPointerCancel: () => setDragFrac(null),
    onPointerLeave: () => setHoverFrac(null),
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const actions: Record<string, () => void> = {
      Home: () => step(0),
      End: () => step(n - 1),
      PageDown: () => unitStep(1),
      ArrowDown: () => unitStep(1),
      PageUp: () => unitStep(-1),
      ArrowUp: () => unitStep(-1),
    }
    if (!actions[e.key]) return
    e.preventDefault()
    actions[e.key]()
  }

  const dragging = dragFrac !== null
  const thumbFrac = dragging ? dragFrac : fracOf(activeIndex)
  const thumbTop = thumbFrac * travel
  const bubbleFrac = dragging ? dragFrac : (hoverFrac ?? (recent ? thumbFrac : null))
  const bubbleIndex = bubbleFrac === null ? -1 : indexAt(bubbleFrac)
  const awake = dragging || hoverFrac !== null || recent
  const showTicks = dragging || hoverFrac !== null

  const bubble = bubbleIndex >= 0 && (
    <div
      className="pointer-events-none absolute right-9 z-10 -translate-y-1/2 rounded-full border bg-popover px-3 py-1 text-xs font-semibold whitespace-nowrap text-popover-foreground shadow-lg"
      style={{ top: bubbleFrac! * travel + THUMB_PX / 2 }}
    >
      {bubbleLabel(times[bubbleIndex])}
    </div>
  )

  const tickMarks = (
    <div className={`pointer-events-none absolute inset-0 transition-opacity duration-150 ${showTicks ? 'opacity-100' : 'opacity-0'}`}>
      {ticks.map((t) => (
        <div
          key={`${t.y}-${t.label}`}
          className="absolute right-0 flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap"
          style={{ top: fracOf(t.y) * travel + THUMB_PX / 2 }}
        >
          <span className="rounded bg-background/80 px-1 text-[10px] font-medium text-muted-foreground tabular-nums">{t.label}</span>
          <span className="mr-[9px] size-1 rounded-full bg-muted-foreground/70" />
        </div>
      ))}
    </div>
  )

  const slider = {
    role: 'slider' as const,
    tabIndex: 0,
    'aria-label': 'Jump to date',
    'aria-orientation': 'vertical' as const,
    'aria-valuemin': 0,
    'aria-valuemax': n - 1,
    'aria-valuenow': activeIndex,
    'aria-valuetext': bubbleLabel(times[activeIndex] ?? times[0]),
    onKeyDown,
  }

  if (coarse) {
    return (
      <div ref={railRef} className="pointer-events-none absolute top-24 right-0 bottom-6 z-20 w-12 lg:top-16">
        {tickMarks}
        {dragging && bubble}
        <div
          {...slider}
          {...handlers}
          className={`absolute right-1 flex w-7 touch-none items-center justify-center rounded-full border bg-background/90 text-muted-foreground shadow-md backdrop-blur-sm transition-opacity duration-200 ${
            awake ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={{ top: thumbTop, height: THUMB_PX }}
        >
          <ChevronsUpDown className="size-3.5" />
        </div>
      </div>
    )
  }

  return (
    <div
      ref={railRef}
      {...slider}
      {...handlers}
      className="group/rail absolute top-24 right-0 bottom-4 z-20 w-8 touch-none outline-none select-none lg:top-16"
    >
      <div
        className={`absolute top-0 right-[13px] bottom-0 w-px bg-border transition-opacity duration-200 ${awake ? 'opacity-100' : 'opacity-0'}`}
      />
      {tickMarks}
      <div
        className={`absolute right-[9px] w-[9px] rounded-full transition-[background-color,width,right] duration-150 group-hover/rail:right-[8px] group-hover/rail:w-[11px] group-focus-visible/rail:ring-2 group-focus-visible/rail:ring-ring ${
          dragging ? 'bg-foreground/80' : 'bg-muted-foreground/50 group-hover/rail:bg-muted-foreground/80'
        } ${awake ? 'opacity-100' : 'opacity-60'}`}
        style={{ top: thumbTop, height: THUMB_PX }}
      />
      {(awake || dragging) && bubble}
    </div>
  )
}
