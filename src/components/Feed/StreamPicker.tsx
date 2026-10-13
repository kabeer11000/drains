import { useState } from 'react'
import { useStore } from '@nanostores/react'
import { Check, Plus } from 'lucide-react'
import { $streams, $streamLinks, $activeDrain } from '@/stores/streams'
import { $identity } from '@/services/identity'
import { getDrainDb } from '@/services/db'
import { createStream, linkEntry, unlinkEntry, slugOfStream, STREAM_COLORS } from '@/services/streams'

// Checkbox list of a drain's streams for one entry, plus "Create". Works on
// anyone's entry: filing only writes a streamlink doc, never the entry.
export function StreamPicker({ entryId, autoFocus = true }: { entryId: string; autoFocus?: boolean }) {
  const streams = useStore($streams)
  const links = useStore($streamLinks).get(entryId) ?? new Set<string>()
  const drain = useStore($activeDrain)
  const identity = useStore($identity)
  const [query, setQuery] = useState('')

  if (!drain || !identity) return null
  const db = getDrainDb(drain.dbName)

  const q = query.trim().toLowerCase()
  const shown = streams.filter((s) => s.name.toLowerCase().includes(q))
  const canCreate = q.length > 0 && !streams.some((s) => s.name.toLowerCase() === q)

  const toggle = (slug: string) => {
    const op = links.has(slug) ? unlinkEntry(db, entryId, slug) : linkEntry(db, entryId, slug, identity)
    op.catch((err) => console.error('Failed to update stream', err))
  }

  const create = async () => {
    const color = STREAM_COLORS[streams.length % STREAM_COLORS.length]
    const stream = await createStream(db, query.trim(), identity, color)
    await linkEntry(db, entryId, slugOfStream(stream), identity)
    setQuery('')
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (shown.length === 1 && !canCreate) toggle(slugOfStream(shown[0]))
          else if (canCreate) create()
        }}
        placeholder="Find or create a stream"
        className="rounded-md border border-input bg-transparent px-2 py-1 text-xs outline-none focus-visible:border-ring"
      />
      <div className="flex max-h-56 flex-col overflow-y-auto">
        {shown.map((stream) => {
          const slug = slugOfStream(stream)
          const on = links.has(slug)
          return (
            <button
              key={stream._id}
              type="button"
              onClick={() => toggle(slug)}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent"
            >
              <span className="font-semibold" style={{ color: stream.color }}>
                #
              </span>
              <span className="min-w-0 flex-1 truncate">{stream.name}</span>
              {on && <Check className="size-3.5 text-foreground" />}
            </button>
          )
        })}
        {canCreate && (
          <button
            type="button"
            onClick={create}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent"
          >
            <Plus className="size-3.5" />
            Create "{query.trim()}"
          </button>
        )}
        {!shown.length && !canCreate && (
          <p className="px-2 py-1 text-xs text-muted-foreground">Type a name to create your first stream</p>
        )}
      </div>
    </div>
  )
}
