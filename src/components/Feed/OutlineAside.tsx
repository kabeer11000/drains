import { useEffect, useState, memo } from 'react'
import type { Editor } from '@tiptap/react'
import { useStore } from '@nanostores/react'
import { Sparkles, Loader2, Plus, MoreHorizontal, Pencil, Trash2, Inbox, Layers } from 'lucide-react'
import { getDrainDb } from '@/services/db'
import {
  renameStream,
  recolorStream,
  deleteStream,
  restoreStream,
  slugOfStream,
  STREAM_COLORS,
  type StreamDoc,
} from '@/services/streams'
import { $streams, $streamLinks, $feedFilter } from '@/stores/streams'
import { UNSORTED, countByStream, selectStream } from './feedFilter'
import { StreamCreator } from './StreamCreator'
import { collectDays, goToAllEntries, type DayGroup } from './utils'
import { onlyEntryTextChanged } from './docDiff'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function SectionLabel({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <div className="mt-2 flex h-6 items-center justify-between px-2">
      <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{children}</span>
      {action}
    </div>
  )
}

// One channel row: All entries, a stream, or Unsorted. Active rows get a
// filled background, like a selected channel in Slack/Linear.
function ChannelRow({
  active,
  icon,
  label,
  count,
  onClick,
  onDoubleClick,
  menu,
  hint,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  count?: number
  onClick: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
  menu?: React.ReactNode
  hint?: string
}) {
  return (
    <div className="group/row relative">
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        title={hint}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
          active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
        }`}
      >
        <span className="flex w-3.5 shrink-0 justify-center">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && count > 0 && (
          <span className={`text-[11px] tabular-nums text-muted-foreground ${menu ? 'group-hover/row:invisible' : ''}`}>
            {count}
          </span>
        )}
      </button>
      {menu && <div className="absolute inset-y-0 right-1 flex items-center">{menu}</div>}
    </div>
  )
}

// Left column: stream channels, then the day outline. (Search lives in the
// command palette — Ctrl/Cmd+K, '/', Ctrl/Cmd+F.)
// Channels replace the old show/hide layers: clicking a stream switches the
// feed to it (and new entries get filed there), Ctrl/Cmd-click combines.
// Memoized: Feed re-renders on every save (the Saving… pill); this column
// only needs to when its own props change.
export const OutlineAside = memo(function OutlineAside({
  editor,
  dbName,
  hiddenEntryIds,
  summarizingKey,
  onSummarize,
}: {
  editor: Editor
  dbName: string
  hiddenEntryIds: Set<string>
  summarizingKey: string | null
  onSummarize: (key: string, entryIds: string[]) => void
}) {
  const db = getDrainDb(dbName)
  const streams = useStore($streams)
  const streamLinks = useStore($streamLinks)
  const filter = useStore($feedFilter)

  const [days, setDays] = useState<DayGroup[]>([])
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleted, setDeleted] = useState<{ doc: Omit<StreamDoc, '_rev'>; timer: ReturnType<typeof setTimeout> } | null>(
    null
  )

  useEffect(() => {
    const recompute = () => setDays(collectDays(editor.state.doc, hiddenEntryIds))
    // Days only change when entries are added, removed or re-dated.
    const onUpdate = ({ transaction }: { transaction: any }) => {
      if (!onlyEntryTextChanged(transaction.before, transaction.doc)) recompute()
    }

    recompute()
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
    }
  }, [editor, hiddenEntryIds])

  // Counted from the drain-wide link index, not the loaded page, so a
  // stream's count is right before its older entries are scrolled in.
  const counts = countByStream(streamLinks, new Set(streams.map(slugOfStream)))
  const combineHint = `${isMac ? '⌘' : 'Ctrl'}-click to combine`

  const choose = (slug: string) => (e: React.MouseEvent) =>
    $feedFilter.set(selectStream($feedFilter.get(), slug, e.metaKey || e.ctrlKey))


  const submitRename = async (slug: string) => {
    const value = renameValue.trim()
    setRenaming(null)
    if (value) await renameStream(db, slug, value)
  }

  const handleDelete = async (stream: StreamDoc) => {
    const slug = slugOfStream(stream)
    const removed = await deleteStream(db, slug)
    const current = $feedFilter.get()
    if (current.streams.has(slug)) {
      const next = new Set(current.streams)
      next.delete(slug)
      $feedFilter.set({ ...current, streams: next })
    }
    if (deleted) clearTimeout(deleted.timer)
    setDeleted({ doc: removed, timer: setTimeout(() => setDeleted(null), 6000) })
  }

  const handleUndo = async () => {
    if (!deleted) return
    clearTimeout(deleted.timer)
    await restoreStream(db, deleted.doc)
    setDeleted(null)
  }

  const jumpTo = (entryId: string) => {
    editor.view.dom.querySelector(`p[data-entry-id="${entryId}"]`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }

  return (
    // A fixed column beside the feed's scroller (Feed/index.tsx), not inside
    // it: pt-16 lines it up with the composer, and nothing here depends on
    // how far the feed is scrolled. Only the Days list scrolls, with its
    // gutter reserved so the rows above never shift sideways.
    <div className="relative z-20 hidden h-full w-56 shrink-0 lg:block">
      <div className="flex h-full flex-col gap-3 pt-16">
        <div className="flex shrink-0 flex-col gap-px">
          <ChannelRow
            active={filter.streams.size === 0}
            icon={<Layers className="size-3.5" />}
            label="All entries"
            hint="Clear filters and search · again to jump to the top (Alt+0)"
            onClick={goToAllEntries}
          />

          <SectionLabel
            action={
              <button
                type="button"
                title="New stream"
                onClick={() => setCreating(true)}
                className="rounded-md p-0.5 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="size-3.5" />
              </button>
            }
          >
            Streams
          </SectionLabel>

          {streams.map((stream, index) => {
            const slug = slugOfStream(stream)
            if (renaming === slug) {
              return (
                <input
                  key={stream._id}
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => submitRename(slug)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRename(slug)
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  className="mx-1 rounded-md border border-input bg-transparent px-2 py-1 text-[13px] outline-none focus-visible:border-ring"
                />
              )
            }
            return (
              <ChannelRow
                key={stream._id}
                active={filter.streams.has(slug)}
                icon={
                  <span className="text-sm font-semibold leading-none" style={{ color: stream.color }}>
                    #
                  </span>
                }
                label={stream.name}
                hint={`${combineHint}${index < 9 ? ` · Alt+${index + 1}` : ''}`}
                count={counts.get(slug)}
                onClick={choose(slug)}
                onDoubleClick={() => {
                  setRenaming(slug)
                  setRenameValue(stream.name)
                }}
                menu={
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          aria-label={`${stream.name} options`}
                          className="rounded p-0.5 text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100 data-[popup-open]:opacity-100"
                        />
                      }
                    >
                      <MoreHorizontal className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-44">
                      <DropdownMenuItem
                        onClick={() => {
                          setRenaming(slug)
                          setRenameValue(stream.name)
                        }}
                      >
                        <Pencil className="size-3.5" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <div className="grid grid-cols-8 gap-1 p-1.5">
                        {STREAM_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            aria-label="Set color"
                            onClick={() => recolorStream(db, slug, color)}
                            className={`size-4 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              stream.color === color ? 'ring-2 ring-foreground/60 ring-offset-1 ring-offset-popover' : ''
                            }`}
                            style={{ background: color }}
                          />
                        ))}
                      </div>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => handleDelete(stream)}>
                        <Trash2 className="size-3.5" />
                        Delete stream
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            )
          })}

          {creating ? (
            <StreamCreator variant="row" onClose={() => setCreating(false)} />
          ) : (
            streams.length === 0 && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="rounded-md px-2 py-1 text-left text-xs leading-relaxed text-muted-foreground outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                Split this drain into topics. Create a stream, or type <span className="font-semibold">#</span> in
                an entry.
              </button>
            )
          )}

          {streams.length > 0 && (
            <ChannelRow
              active={filter.streams.has(UNSORTED)}
              icon={<Inbox className="size-3.5" />}
              label="Unsorted"
              hint={`Entries in no stream · ${combineHint}`}
              onClick={choose(UNSORTED)}
            />
          )}

          {deleted && (
            <div className="mt-1 flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
              <span className="truncate">Deleted #{deleted.doc.name}</span>
              <button type="button" onClick={handleUndo} className="font-medium underline outline-none hover:text-foreground">
                Undo
              </button>
            </div>
          )}
        </div>

        {days.length > 0 && (
          <div className="flex min-h-0 flex-col">
            <SectionLabel>Days</SectionLabel>
            <div className="feed-scroll flex min-h-0 flex-col gap-px overflow-y-auto pb-4 [scrollbar-gutter:stable]">
              {days.map((d) => (
                <div key={d.key} className="group/day flex items-center">
                  <button
                    type="button"
                    onClick={() => jumpTo(d.entryId)}
                    className="flex-1 rounded-md px-2 py-1 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {d.label}
                  </button>
                  <button
                    type="button"
                    title="Summarize this day"
                    onClick={() => onSummarize(d.key, d.entryIds)}
                    disabled={summarizingKey === d.key}
                    className="rounded-md p-1 text-violet-400 opacity-0 outline-none transition-all hover:bg-violet-100 hover:text-violet-600 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-violet-400 group-hover/day:opacity-100 disabled:opacity-100 dark:text-violet-300 dark:hover:bg-violet-500/20"
                  >
                    {summarizingKey === d.key ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
