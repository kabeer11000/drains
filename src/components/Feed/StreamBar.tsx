import { useEffect, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import { Inbox, Plus } from 'lucide-react'
import { $streams, $streamLinks, $feedFilter, $activeDrain, $searchJump } from '@/stores/streams'
import { $identity } from '@/services/identity'
import { getDrainDb } from '@/services/db'
import { createStream, slugOfStream, STREAM_COLORS } from '@/services/streams'
import { UNSORTED, countByStream, selectStream } from './feedFilter'
import { goToAllEntries } from './utils'

function Chip({
  active,
  onClick,
  children,
  dataKey,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  dataKey: string
}) {
  return (
    <button
      type="button"
      data-chip={dataKey}
      data-active={active}
      onClick={onClick}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? 'border-foreground/20 bg-accent font-medium text-foreground'
          : 'border-border/60 bg-background/80 text-muted-foreground backdrop-blur-sm active:bg-accent/60'
      }`}
    >
      {children}
    </button>
  )
}

// Streams on phones and tablets, where the channel sidebar is hidden: one
// row of chips in the top overlay, under the menu/search/title pills and
// inside the top gradient (the feed's mobile top padding leaves room, so it
// never covers the composer). Slides away while scrolling down and comes
// back on any scroll up. Same behaviour as the sidebar — tap to switch, tap
// the open one (or All) to go back, "+" to create — minus multi-select.
const SHOW_NEAR_TOP = 80
const SCROLL_SLOP = 6
export function StreamBar() {
  const streams = useStore($streams)
  const links = useStore($streamLinks)
  const filter = useStore($feedFilter)
  const drain = useStore($activeDrain)
  const identity = useStore($identity)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const rowRef = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('[data-feed-scroller]')
    if (!scroller) return
    let last = scroller.scrollTop
    const onScroll = () => {
      const top = scroller.scrollTop
      if (top < SHOW_NEAR_TOP) setHidden(false)
      else if (top > last + SCROLL_SLOP) setHidden(true)
      else if (top < last - SCROLL_SLOP) setHidden(false)
      if (Math.abs(top - last) > SCROLL_SLOP) last = top
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  // Switching streams always brings the bar back into view.
  useEffect(() => setHidden(false), [filter.streams])

  // Keep the open stream's chip in view when it changes from elsewhere
  // (search, Alt shortcuts, "Go to stream").
  useEffect(() => {
    rowRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [filter.streams])

  const counts = countByStream(links, new Set(streams.map(slugOfStream)))

  const open = (slug: string) => {
    $searchJump.set(null)
    $feedFilter.set(selectStream($feedFilter.get(), slug, false))
  }

  const submit = async () => {
    const value = name.trim()
    setCreating(false)
    setName('')
    if (!value || !drain || !identity) return
    const color = STREAM_COLORS[streams.length % STREAM_COLORS.length]
    const stream = await createStream(getDrainDb(drain.dbName), value, identity, color)
    $feedFilter.set({ ...$feedFilter.get(), streams: new Set([slugOfStream(stream)]) })
  }

  return (
    <div
      className={`absolute inset-x-0 top-14 z-20 px-3 transition-[opacity,transform] duration-200 lg:hidden ${
        hidden && !creating ? 'pointer-events-none -translate-y-3 opacity-0' : 'translate-y-0 opacity-100'
      }`}
    >
      <div ref={rowRef} className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip dataKey="all" active={filter.streams.size === 0} onClick={goToAllEntries}>
          All
        </Chip>
        {streams.map((s) => {
          const slug = slugOfStream(s)
          const count = counts.get(slug)
          return (
            <Chip key={s._id} dataKey={slug} active={filter.streams.has(slug)} onClick={() => open(slug)}>
              <span className="font-semibold" style={{ color: s.color }}>
                #
              </span>
              <span className="max-w-40 truncate">{s.name}</span>
              {count ? <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span> : null}
            </Chip>
          )
        })}
        {streams.length > 0 && (
          <Chip dataKey="unsorted" active={filter.streams.has(UNSORTED)} onClick={() => open(UNSORTED)}>
            <Inbox className="size-3.5" />
            Unsorted
          </Chip>
        )}
        {creating ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') {
                setCreating(false)
                setName('')
              }
            }}
            placeholder="Stream name"
            className="h-8 w-36 shrink-0 rounded-full border border-input bg-transparent px-3 text-[13px] outline-none focus-visible:border-ring"
          />
        ) : (
          <button
            type="button"
            aria-label="New stream"
            onClick={() => setCreating(true)}
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground outline-none active:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
