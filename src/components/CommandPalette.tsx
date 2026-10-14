import { useEffect, useMemo, useState } from 'react'
import { atom } from 'nanostores'
import { useStore } from '@nanostores/react'
import { Clock, CornerDownLeft, Filter, Globe, Hash, Layers, PenLine, Search, User, X } from 'lucide-react'
import { Command as CommandPrimitive } from 'cmdk'
import { $drains } from '@/helpers/drains'
import { getDrainDb } from '@/services/db'
import { stripHtml } from '@/utils/stripHtml'
import { $activeDrain, $feedFilter, $searchJump, $streams } from '@/stores/streams'
import { slugOfStream, buildStreamIndex } from '@/services/streams'
import { authorKeyOf, singleSelectedStream } from '@/components/Feed/feedFilter'
import { parseQuery, isEmptyQuery, matchesEntry, matchRanges, snippet, type SnippetPart } from '@/components/Feed/search'
import { entryDayTs, dayLabel, relativeTime } from '@/components/Feed/utils'
import { Command, CommandDialog, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'

// Shared so the app sidebar's search button can open it, not just the keys.
export const $commandPaletteOpen = atom(false)

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

// The open stream channel, if exactly one is selected — search starts
// inside it (a pre-filled `#slug`), and the trigger says so.
function useOpenStream() {
  const filter = useStore($feedFilter)
  const streams = useStore($streams)
  const slug = singleSelectedStream(filter)
  return slug ? streams.find((s) => slugOfStream(s) === slug) ?? null : null
}

// The visible way into search on a drain page, in the top bar. Its label
// says what a search will cover: the open stream or the open drain.
// Centered with a label on desktop; an icon beside the menu button below
// lg, where the centre would collide with the drain title.
export function SearchTrigger() {
  const drains = useStore($drains)
  const activeDrain = useStore($activeDrain)
  const stream = useOpenStream()
  const drainTitle = activeDrain ? drains.find((d: any) => d.dbName === activeDrain.dbName)?.title || 'this drain' : null
  // Home has its own full-size search field (HomeStart); the pill is only
  // for drain pages.
  if (!activeDrain) return null
  const label = stream ? `Search #${stream.name}` : `Search ${drainTitle}`

  return (
    <button
      type="button"
      title={`${label} (${isMac ? '⌘' : 'Ctrl+'}K)`}
      aria-label={label}
      onClick={() => $commandPaletteOpen.set(true)}
      className="absolute top-4 left-11 z-30 flex size-7 items-center justify-center gap-2 rounded-full border bg-background/80 text-xs text-muted-foreground shadow-sm backdrop-blur-sm outline-none transition-colors hover:bg-background hover:text-foreground lg:bg-muted lg:backdrop-blur-none lg:hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 lg:left-1/2 lg:h-8 lg:w-80 lg:-translate-x-1/2 lg:justify-start lg:px-3"
    >
      <Search className="size-3.5 shrink-0" />
      <span className="hidden min-w-0 flex-1 truncate text-left lg:inline">{label}</span>
      <kbd className="hidden shrink-0 rounded border border-border/60 px-1 font-sans text-[10px] lg:inline">
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </button>
  )
}

const SCOPED_LIMIT = 100
const PER_DRAIN_LIMIT = 5

const RECENT_KEY = 'sk_recent_searches'
const RECENT_MAX = 8

interface RecentSearch {
  query: string
  dbName: string | null
}

function loadRecent(): RecentSearch[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((r) => typeof r?.query === 'string') : []
  } catch {
    return []
  }
}

// Most recent first, de-duplicated per scope. Only searches that led
// somewhere (a picked result, "show all") are kept, not every keystroke.
function rememberSearch(query: string, dbName: string | null) {
  const q = query.trim()
  if (!q) return
  const rest = loadRecent().filter((r) => !(r.query === q && r.dbName === dbName))
  localStorage.setItem(RECENT_KEY, JSON.stringify([{ query: q, dbName }, ...rest].slice(0, RECENT_MAX)))
}

// The token being typed at the end of the query, if it's a #stream or
// @person prefix — drives the autocomplete group.
function trailingToken(query: string): { kind: '#' | '@'; partial: string } | null {
  const m = query.match(/(?:^|\s)([#@])([^\s#@]*)$/)
  return m ? { kind: m[1] as '#' | '@', partial: m[2].toLowerCase() } : null
}

interface StreamInfo {
  slug: string
  name: string
  color: string
}

interface IndexedEntry {
  entryId: string
  text: string
  createdAt: number
  updatedAt: number
  done: boolean
  streams: StreamInfo[]
  authorName: string
  authorKey: string
  source?: string | null
  viaToken?: string | null
}

interface DrainIndex {
  dbName: string
  title: string
  entries: IndexedEntry[]
  streams: StreamInfo[]
}

interface Hit {
  dbName: string
  drainTitle: string
  entry: IndexedEntry
  parts: SnippetPart[]
}

// Struck-through text is how people mark an entry done: done = there's
// text, and none of it sits outside an <s>.
function isDoneHtml(html: string) {
  const outside = html.replace(/<s>[\s\S]*?<\/s>/g, '')
  return !!stripHtml(html) && !stripHtml(outside)
}

// One read of a drain's local PouchDB: entries plus its streams and links,
// so #stream / @person / from: / is:done work in any drain, not only the
// one on screen. Local-first: only drains synced to this device are there.
async function indexDrain(dbName: string, title: string): Promise<DrainIndex> {
  const res = await getDrainDb(dbName)
    .allDocs({ include_docs: true })
    .catch(() => ({ rows: [] as any[] }))
  const docs = res.rows.map((r: any) => r.doc).filter(Boolean)
  const { streams, byEntry } = buildStreamIndex(docs)
  const entries: IndexedEntry[] = docs
    .filter((d: any) => d._id.startsWith('entry:') && d.content)
    .map((d: any) => {
      const entryId = d._id.slice('entry:'.length)
      return {
        entryId,
        text: stripHtml(d.content),
        createdAt: Number(d.createdAt),
        updatedAt: Number(d.updatedAt ?? d.createdAt),
        done: isDoneHtml(d.content),
        streams: byEntry.get(entryId) ?? [],
        authorName: d.createdByName ?? '',
        authorKey: authorKeyOf(d),
        source: d.source,
        viaToken: d.viaToken,
      }
    })
    .filter((e: IndexedEntry) => e.text)
    // Newest first, same order as the feed.
    .sort((a: IndexedEntry, b: IndexedEntry) => (a.entryId < b.entryId ? 1 : -1))
  return { dbName, title, entries, streams }
}

function Snippet({ parts }: { parts: SnippetPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-amber-300/40 px-px text-foreground dark:bg-amber-400/30">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  )
}

function Kbd({ children }: { children: string }) {
  return <code className="rounded bg-muted px-1 py-px font-mono text-[10px] text-foreground/80">{children}</code>
}

function StreamLabels({ streams }: { streams: StreamInfo[] }) {
  return (
    <>
      {streams.map((s) => (
        <span
          key={s.slug}
          className="mr-1.5 inline-flex rounded px-1 text-[11px] font-semibold"
          style={{ background: `color-mix(in srgb, ${s.color} 16%, transparent)`, color: s.color }}
        >
          {s.name}
        </span>
      ))}
    </>
  )
}

// The app's one search. Opened with Ctrl/Cmd+K anywhere, or '/' and
// Ctrl/Cmd+F on a drain page. On a drain page it starts scoped to that
// drain (Backspace on an empty box widens it to every drain); results
// show newest first with highlighted snippets. Picking a result in the
// current drain jumps to it in place and hands the rest to the feed's
// step-through pill; "Show all matches" turns the query into a feed filter.
export function CommandPalette() {
  const drains = useStore($drains)
  const open = useStore($commandPaletteOpen)
  const activeDrain = useStore($activeDrain)
  const [query, setQuery] = useState('')
  const [scoped, setScoped] = useState(true)
  const [indexes, setIndexes] = useState<DrainIndex[] | null>(null)
  const [recent, setRecent] = useState<RecentSearch[]>([])

  const currentDb = activeDrain?.dbName ?? null
  const scope = scoped && currentDb ? currentDb : null
  const currentTitle = drains.find((d: any) => d.dbName === currentDb)?.title || 'This drain'

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey
      const key = e.key.toLowerCase()
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      const onDrain = !!$activeDrain.get()
      if (mod && key === 'k') {
        e.preventDefault()
        $commandPaletteOpen.set(!$commandPaletteOpen.get())
      } else if (onDrain && ((mod && key === 'f') || (e.key === '/' && !mod && !typing))) {
        e.preventDefault()
        $commandPaletteOpen.set(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Each open starts scoped to the drain on screen. The query starts as
  // whatever you were last stepping through (to refine it), else the open
  // stream as `#slug ` so results begin inside it — one Backspace away
  // from the whole drain.
  const openStream = useOpenStream()
  useEffect(() => {
    if (!open) return
    setRecent(loadRecent())
    setScoped(true)
    setQuery($searchJump.get()?.query ?? (openStream ? `#${slugOfStream(openStream)} ` : ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Indexed once per open (and when widening scope), then filtered in
  // memory on every keystroke.
  useEffect(() => {
    if (!open) {
      setIndexes(null)
      return
    }
    let cancelled = false
    const known = scope ? drains.filter((d: any) => d.dbName === scope) : drains
    const targets = scope && !known.length ? [{ dbName: scope, title: currentTitle }] : known
    Promise.all(targets.map((d: any) => indexDrain(d.dbName, d.title || 'Untitled'))).then((all) => {
      if (!cancelled) setIndexes(all)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, drains])

  const parsed = useMemo(() => parseQuery(query), [query])
  const empty = isEmptyQuery(parsed)

  const hits = useMemo(() => {
    if (!indexes || empty) return [] as Hit[]
    const out: Hit[] = []
    for (const idx of indexes) {
      let n = 0
      for (const entry of idx.entries) {
        if (!scope && n >= PER_DRAIN_LIMIT) break
        const searchable = { ...entry, streams: entry.streams.flatMap((s) => [s.slug, s.name.toLowerCase()]) }
        if (!matchesEntry(searchable, parsed)) continue
        out.push({
          dbName: idx.dbName,
          drainTitle: idx.title,
          entry,
          parts: snippet(entry.text, matchRanges(entry.text, parsed.terms)),
        })
        n++
      }
    }
    return out
  }, [indexes, parsed, empty, scope])

  const drainMatches = useMemo(() => {
    if (scope) return []
    const q = query.trim().toLowerCase()
    return drains.filter((d: any) => !q || (d.title || '').toLowerCase().includes(q)).slice(0, q ? 8 : 6)
  }, [query, drains, scope])

  // Scoped results grouped by day; global results grouped by drain.
  const groups = useMemo(() => {
    const map = new Map<string, Hit[]>()
    for (const h of hits.slice(0, scope ? SCOPED_LIMIT : undefined)) {
      const key = scope ? dayLabel(entryDayTs(h.entry.entryId, h.entry.createdAt)) : h.drainTitle
      map.set(key, [...(map.get(key) ?? []), h])
    }
    return [...map]
  }, [hits, scope])

  const scopedIndex = scope && indexes?.[0] ? indexes[0] : null
  const scopedStreams = scopedIndex?.streams ?? []
  const recentHere = recent.filter((r) => (scope ? r.dbName === scope : true)).slice(0, 5)
  const recentlyEdited = useMemo(
    () => (scopedIndex ? [...scopedIndex.entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5) : []),
    [scopedIndex]
  )

  // Completions for a #stream / @person being typed at the end of the box.
  const token = trailingToken(query)
  const completions = useMemo((): { label: string; value: string; color?: string }[] => {
    if (!token || !indexes) return []
    if (token.kind === '#') {
      const seen = new Map<string, StreamInfo>()
      for (const idx of indexes) for (const st of idx.streams) seen.set(st.slug, st)
      return [...seen.values()]
        .filter((st) => st.slug.includes(token.partial) || st.name.toLowerCase().includes(token.partial))
        .slice(0, 6)
        .map((st) => ({ label: st.name, value: st.slug, color: st.color }))
    }
    const names = new Set<string>()
    for (const idx of indexes) for (const e of idx.entries) if (e.authorName) names.add(e.authorName)
    return [...names]
      .filter((n) => n.toLowerCase().includes(token.partial))
      .slice(0, 6)
      .map((n) => ({ label: n, value: n.split(/\s+/)[0].toLowerCase() }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token?.kind, token?.partial, indexes])

  const completeToken = (value: string) =>
    setQuery((q) => q.replace(/([#@])[^\s#@]*$/, (_m, sigil) => `${sigil}${value} `))

  const close = () => $commandPaletteOpen.set(false)

  const pick = (hit: Hit) => {
    rememberSearch(query, scope)
    close()
    if (hit.dbName === currentDb) {
      const sameDrain = hits.filter((h) => h.dbName === currentDb)
      $searchJump.set({
        query,
        entryIds: sameDrain.map((h) => h.entry.entryId),
        index: Math.max(0, sameDrain.indexOf(hit)),
      })
    } else {
      window.location.href = `/drains/${hit.dbName}#entry-${hit.entry.entryId}`
    }
  }

  const showAllInFeed = () => {
    rememberSearch(query, scope)
    close()
    $searchJump.set(null)
    $feedFilter.set({ ...$feedFilter.get(), query, onlyMatches: true })
  }

  // Jump to one entry with no query attached (recently edited).
  const openEntry = (entryId: string) => {
    close()
    $searchJump.set({ query: '', entryIds: [entryId], index: 0 })
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => $commandPaletteOpen.set(next)}
      title="Search"
      description="Search entries and drains"
      className="sm:max-w-2xl"
      mobileFullScreen
    >
      <Command shouldFilter={false} loop>
        <div className="flex items-center gap-2 border-b px-3">
          {scope && (
            <button
              type="button"
              onClick={() => setScoped(false)}
              title="Search all drains (Backspace)"
              className="flex max-w-[40%] shrink-0 items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-xs font-medium outline-none hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate">{currentTitle}</span>
              <X className="size-3 shrink-0 text-muted-foreground" />
            </button>
          )}
          <CommandPrimitive.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !query && scope) {
                e.preventDefault()
                setScoped(false)
              }
            }}
            placeholder={scope ? 'Search this drain…' : 'Search all drains…'}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {/* Phones get no Esc key and no backdrop to tap, so a real way out. */}
          <button
            type="button"
            onClick={close}
            className="shrink-0 rounded-md px-1.5 py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
          >
            Cancel
          </button>
          {!scope && currentDb && (
            <button
              type="button"
              onClick={() => setScoped(true)}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Only {currentTitle}
            </button>
          )}
        </div>

        <CommandList className="max-h-[28rem] max-sm:max-h-none max-sm:flex-1">
          {!empty && indexes && !completions.length && (
            <CommandEmpty className="py-0">
              <div className="flex flex-col items-center gap-1 px-4 pt-8 pb-3 text-center">
                <p className="text-sm text-foreground">Nothing matches “{query.trim()}”</p>
                <p className="text-xs text-muted-foreground">
                  {scope ? `Searched every entry in ${currentTitle}.` : 'Searched every drain on this device.'}
                </p>
              </div>
            </CommandEmpty>
          )}
          {!empty && scope && indexes && !hits.length && !completions.length && (
            <CommandGroup>
              <CommandItem value="search-everywhere" onSelect={() => setScoped(false)}>
                <Globe className="size-3.5 text-muted-foreground" />
                Search all drains for “{query.trim()}”
              </CommandItem>
            </CommandGroup>
          )}

          {completions.length > 0 && (
            <CommandGroup heading={token?.kind === '#' ? 'Streams' : 'People'}>
              {completions.map((c) => (
                <CommandItem key={c.value} value={`complete-${c.value}`} onSelect={() => completeToken(c.value)}>
                  {token?.kind === '#' ? (
                    <Hash className="size-3.5" style={{ color: c.color }} />
                  ) : (
                    <User className="size-3.5 text-muted-foreground" />
                  )}
                  {c.label}
                  <CornerDownLeft className="ml-auto size-3 text-muted-foreground" />
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {empty && recentHere.length > 0 && (
            <CommandGroup heading="Recent searches">
              {recentHere.map((r) => (
                <CommandItem
                  key={`${r.dbName}-${r.query}`}
                  value={`recent-${r.dbName}-${r.query}`}
                  onSelect={() => setQuery(`${r.query} `)}
                >
                  <Clock className="size-3.5 text-muted-foreground" />
                  <span className="truncate">{r.query}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {empty && recentlyEdited.length > 0 && (
            <CommandGroup heading="Recently edited">
              {recentlyEdited.map((e) => (
                <CommandItem key={e.entryId} value={`edited-${e.entryId}`} onSelect={() => openEntry(e.entryId)}>
                  <PenLine className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="line-clamp-1 min-w-0 flex-1 text-[13px]">
                    <StreamLabels streams={e.streams} />
                    <span className={e.done ? 'text-muted-foreground line-through' : ''}>{e.text}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(e.updatedAt)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {empty && scopedStreams.length > 0 && (
            <CommandGroup heading="Search in a stream">
              {scopedStreams.map((st) => (
                <CommandItem key={st.slug} value={`in-stream-${st.slug}`} onSelect={() => setQuery(`#${st.slug} `)}>
                  <Hash className="size-3.5" style={{ color: st.color }} />
                  {st.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {drainMatches.length > 0 && (
            <CommandGroup heading="Drains">
              {drainMatches.map((d: any) => (
                <CommandItem
                  key={d.dbName}
                  value={`drain-${d.dbName}`}
                  onSelect={() => {
                    close()
                    window.location.href = `/drains/${d.dbName}`
                  }}
                >
                  <Layers className="size-3.5 text-muted-foreground" />
                  {d.title || 'Untitled'}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {scope && hits.length > 1 && (
            <CommandGroup>
              <CommandItem value="show-all-in-feed" onSelect={showAllInFeed}>
                <Filter className="size-3.5 text-muted-foreground" />
                Show all {hits.length} matches in the feed
              </CommandItem>
            </CommandGroup>
          )}

          {groups.map(([heading, groupHits]) => (
            <CommandGroup key={heading} heading={heading}>
              {groupHits.map((h) => (
                <CommandItem
                  key={`${h.dbName}-${h.entry.entryId}`}
                  value={`${h.dbName}-${h.entry.entryId}`}
                  onSelect={() => pick(h)}
                  className="items-start"
                >
                  <span className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug">
                    <StreamLabels streams={h.entry.streams} />
                    <span className={h.entry.done ? 'text-muted-foreground line-through' : ''}>
                      <Snippet parts={h.parts} />
                    </span>
                  </span>
                  {!scope && (
                    <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
                      {dayLabel(entryDayTs(h.entry.entryId, h.entry.createdAt))}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}

          {scope && hits.length > SCOPED_LIMIT && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              {hits.length - SCOPED_LIMIT} older matches not listed. Use "Show all matches in the feed".
            </p>
          )}
        </CommandList>

        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground max-sm:hidden">
          {empty ? (
            <span className="truncate">
              Narrow with <Kbd>#stream</Kbd> <Kbd>@person</Kbd> <Kbd>from:github</Kbd> <Kbd>is:done</Kbd>{' '}
              <Kbd>"phrase"</Kbd>
            </span>
          ) : (
            <>
              <span>↵ open</span>
              <span>↑↓ move</span>
            </>
          )}
          <span className="ml-auto shrink-0">{scope && !query ? '⌫ all drains · ' : ''}Esc close</span>
        </div>
      </Command>
    </CommandDialog>
  )
}
