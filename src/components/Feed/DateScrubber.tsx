import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { decodeTime } from 'ulid'
import { ChevronsUpDown } from 'lucide-react'
import { $loadWholeDrain } from '@/stores/feed'
import { bubbleLabel, chooseGranularity, itemAt, thinTicks, tickLabel, unitKey, type Tick } from './scrubber'
import { onlyEntryTextChanged } from './docDiff'

const IDLE_MS = 1200
const MIN_THUMB = 32

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

interface Layout {
  contentH: number // scrollHeight
  viewH: number // clientHeight
  tops: number[] // content offset of each visible entry, in feed order
  times: number[] // that entry's timestamp
  ticks: Tick[] // first entry of each day/month/year
}

const EMPTY: Layout = { contentH: 0, viewH: 0, tops: [], times: [], ticks: [] }

// The feed's scrollbar, with dates (Google Photos / grok style). The thumb IS
// the scroll position — same maths as a native scrollbar — so it tracks
// scrolling exactly and dragging it scrolls 1:1. Dates come from the entries
// actually on the page: ticks sit where each day/month/year starts and the
// bubble names the entry under the pointer. The first time it's touched, the
// rest of the drain is paged in so the rail spans every entry.
export function DateScrubber({ editor }: { editor: Editor }) {
  const coarse = useMedia('(pointer: coarse)')
  const [layout, setLayout] = useState<Layout>(EMPTY)
  const [scrollTop, setScrollTop] = useState(0)
  const [railH, setRailH] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [hoverY, setHoverY] = useState<number | null>(null)
  const [recent, setRecent] = useState(false)
  const railRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const grab = useRef(0) // pointer offset inside the thumb while dragging
  const lastUnit = useRef('')

  const engage = useCallback(() => {
    if (!$loadWholeDrain.get()) $loadWholeDrain.set(true)
  }, [])

  // Measure entry positions. Runs on content changes and resizes, not on
  // scroll — scrolling only moves the thumb.
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('[data-feed-scroller]')
    scrollerRef.current = scroller
    if (!scroller) return
    let frame = 0
    const measure = () => {
      frame = 0
      const base = scroller.getBoundingClientRect().top - scroller.scrollTop
      const tops: number[] = []
      const times: number[] = []
      // Cards are nested inside Tiptap's node-view wrappers, so query for
      // them rather than walking the editor's direct children. Filtered-out
      // entries are display:none and have no offsetParent.
      for (const el of Array.from(editor.view.dom.querySelectorAll<HTMLElement>('p[data-entry-id]'))) {
        const id = el.dataset.entryId
        if (!id || el.offsetParent === null || el.dataset.composer !== undefined) continue
        const t = timeOf(id)
        if (!t) continue
        tops.push(el.getBoundingClientRect().top - base)
        times.push(t)
      }
      const g = chooseGranularity(times)
      const ticks: Tick[] = []
      let prev = times.length ? unitKey(times[0], g) : ''
      for (let i = 1; i < times.length; i++) {
        const key = unitKey(times[i], g)
        if (key !== prev) ticks.push({ y: tops[i], label: tickLabel(times[i], g) })
        prev = key
      }
      setLayout({ contentH: scroller.scrollHeight, viewH: scroller.clientHeight, tops, times, ticks })
      setScrollTop(scroller.scrollTop)
    }
    // Measuring reads every card's position (a layout read), so it never
    // runs inside a typing or scrolling frame: it waits for idle time.
    // Height changes (typing that wraps, filtering, pages loading) arrive
    // through the ResizeObserver; entries added/removed through 'update'.
    const idle = (cb: () => void) =>
      'requestIdleCallback' in window
        ? (window as any).requestIdleCallback(cb, { timeout: 300 })
        : (setTimeout(cb, 120) as unknown as number)
    const cancelIdle = (h: number) =>
      'cancelIdleCallback' in window ? (window as any).cancelIdleCallback(h) : clearTimeout(h)
    const schedule = () => {
      if (!frame) frame = idle(measure)
    }
    measure()
    const ro = new ResizeObserver(schedule)
    ro.observe(scroller)
    ro.observe(editor.view.dom)
    const onUpdate = ({ transaction }: { transaction: any }) => {
      if (!onlyEntryTextChanged(transaction.before, transaction.doc)) schedule()
    }
    editor.on('update', onUpdate)
    return () => {
      if (frame) cancelIdle(frame)
      ro.disconnect()
      editor.off('update', onUpdate)
    }
  }, [editor])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    let idle: ReturnType<typeof setTimeout> | undefined
    let frame = 0
    // Scroll events can fire several times per frame; render at most once.
    const onScroll = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          setScrollTop(scroller.scrollTop)
        })
      setRecent(true)
      clearTimeout(idle)
      idle = setTimeout(() => setRecent(false), IDLE_MS)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
      clearTimeout(idle)
    }
  }, [layout.contentH > 0])

  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setRailH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [coarse, layout.times.length > 1])

  const { contentH, viewH, tops, times } = layout
  const scrollable = contentH - viewH
  // Before the early return: hooks must run in the same order every render.
  const visibleTicks = useMemo(() => thinTicks(layout.ticks, contentH, railH), [layout.ticks, contentH, railH])

  // Nothing to scrub through.
  if (times.length < 2 || scrollable <= 4) return null

  // Native-scrollbar geometry.
  const thumbH = Math.max(MIN_THUMB, (viewH / contentH) * railH)
  const travel = Math.max(1, railH - thumbH)
  const thumbTop = (scrollTop / scrollable) * travel

  // Rail y (thumb top) <-> scrollTop, and the entry date at any rail y.
  const scrollFor = (thumbY: number) => (Math.min(travel, Math.max(0, thumbY)) / travel) * scrollable
  const dateAtRail = (y: number) => {
    // The entry at the top of the view if the thumb's top were at y.
    const i = itemAt(tops, scrollFor(y - thumbH / 2) + 4)
    return i >= 0 ? times[i] : times[0]
  }

  const railY = (clientY: number) => clientY - railRef.current!.getBoundingClientRect().top

  const scrubTo = (thumbY: number) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.scrollTop = scrollFor(thumbY)
    if (coarse) {
      const unit = unitKey(dateAtRail(thumbY + thumbH / 2), chooseGranularity(times))
      if (lastUnit.current && unit !== lastUnit.current) navigator.vibrate?.(4)
      lastUnit.current = unit
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    engage()
    e.currentTarget.setPointerCapture(e.pointerId)
    const y = railY(e.clientY)
    // Grabbing the thumb keeps its offset; clicking the track centres it there.
    grab.current = y >= thumbTop && y <= thumbTop + thumbH ? y - thumbTop : thumbH / 2
    setDragging(true)
    scrubTo(y - grab.current)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const y = railY(e.clientY)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubTo(y - grab.current)
    else if (!coarse) setHoverY(Math.min(railH, Math.max(0, y)))
  }
  const endDrag = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
    lastUnit.current = ''
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const page = viewH * 0.9
    const to =
      e.key === 'Home' ? 0
      : e.key === 'End' ? scrollable
      : e.key === 'PageDown' ? scroller.scrollTop + page
      : e.key === 'PageUp' ? scroller.scrollTop - page
      : e.key === 'ArrowDown' ? scroller.scrollTop + 80
      : e.key === 'ArrowUp' ? scroller.scrollTop - 80
      : null
    if (to === null) return
    e.preventDefault()
    engage()
    scroller.scrollTo({ top: to })
  }

  const awake = dragging || hoverY !== null || recent
  const showTicks = dragging || hoverY !== null
  // While dragging/scrolling the bubble rides the thumb; on hover it follows the pointer.
  const bubbleY = dragging || (recent && hoverY === null) ? thumbTop + thumbH / 2 : hoverY
  const bubbleTime = bubbleY === null ? null : dragging || hoverY === null ? (times[itemAt(tops, scrollTop + 4)] ?? times[0]) : dateAtRail(bubbleY)

  const ticks = (
    <div className={`pointer-events-none absolute inset-0 transition-opacity duration-150 ${showTicks ? 'opacity-100' : 'opacity-0'}`}>
      {visibleTicks.map((t) => (
        <div
          key={`${t.y}-${t.label}`}
          className="absolute right-0 flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap"
          style={{ top: (t.y / contentH) * railH }}
        >
          <span className="rounded bg-background/80 px-1 text-[10px] font-medium text-muted-foreground tabular-nums">{t.label}</span>
          <span className="mr-[9px] size-1 rounded-full bg-muted-foreground/70" />
        </div>
      ))}
    </div>
  )

  const bubble = bubbleY !== null && bubbleTime !== null && (
    <div
      className="pointer-events-none absolute right-9 z-10 -translate-y-1/2 rounded-full border bg-popover px-3 py-1 text-xs font-semibold whitespace-nowrap text-popover-foreground shadow-lg"
      style={{ top: Math.min(railH - 12, Math.max(12, bubbleY)) }}
    >
      {bubbleLabel(bubbleTime)}
    </div>
  )

  const slider = {
    role: 'scrollbar' as const,
    tabIndex: 0,
    'aria-label': 'Scroll by date',
    'aria-orientation': 'vertical' as const,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': Math.round((scrollTop / scrollable) * 100),
    'aria-valuetext': bubbleLabel(times[itemAt(tops, scrollTop + 4)] ?? times[0]),
    onKeyDown,
    onFocus: engage,
  }

  if (coarse) {
    // Touch: hidden until you scroll, then a handle riding the scroll position.
    return (
      <div ref={railRef} className="pointer-events-none absolute top-24 right-0 bottom-6 z-20 w-12 lg:top-16">
        {ticks}
        {dragging && bubble}
        <div
          {...slider}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={`absolute right-1 flex w-7 touch-none items-center justify-center rounded-full border bg-background/90 text-muted-foreground shadow-md backdrop-blur-sm transition-opacity duration-200 ${
            awake ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={{ top: thumbTop + thumbH / 2 - 18, height: 36 }}
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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={engage}
      onPointerLeave={() => setHoverY(null)}
      className="group/rail absolute top-24 right-0 bottom-4 z-20 w-8 touch-none outline-none select-none lg:top-16"
    >
      <div
        className={`absolute top-0 right-[13px] bottom-0 w-px bg-border transition-opacity duration-200 ${
          awake ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {ticks}
      <div
        className={`absolute right-[9px] w-[9px] rounded-full transition-[opacity,background-color,width,right] duration-150 group-hover/rail:right-[8px] group-hover/rail:w-[11px] group-focus-visible/rail:ring-2 group-focus-visible/rail:ring-ring ${
          dragging ? 'bg-foreground/80' : 'bg-muted-foreground/50 group-hover/rail:bg-muted-foreground/80'
        } ${awake ? 'opacity-100' : 'opacity-60'}`}
        style={{ top: thumbTop, height: thumbH }}
      />
      {(awake || dragging) && bubble}
    </div>
  )
}
