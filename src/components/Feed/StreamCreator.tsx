import { useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import { Check, X } from 'lucide-react'
import { $streams, $feedFilter, $activeDrain, $searchJump } from '@/stores/streams'
import { $identity } from '@/services/identity'
import { getDrainDb } from '@/services/db'
import { createStream, slugOfStream, STREAM_COLORS } from '@/services/streams'

// Inline "new stream" form, shared by the sidebar (row) and the phone chip
// bar (chip). Enter or ✓ creates and opens the stream; Esc or × cancels.
// Clicking away only closes it when nothing was typed, so a half-typed name
// is never created or lost by accident. Typing an existing stream's name
// offers to open that one instead of making a near-duplicate.
export function StreamCreator({ variant, onClose }: { variant: 'row' | 'chip'; onClose: () => void }) {
  const streams = useStore($streams)
  const drain = useStore($activeDrain)
  const identity = useStore($identity)
  const [name, setName] = useState('')
  const [colorIndex, setColorIndex] = useState(streams.length % STREAM_COLORS.length)
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const trimmed = name.trim()
  const existing = trimmed ? streams.find((s) => s.name.toLowerCase() === trimmed.toLowerCase()) : undefined
  const color = existing?.color ?? STREAM_COLORS[colorIndex]

  const open = (slug: string) => {
    $searchJump.set(null)
    $feedFilter.set({ ...$feedFilter.get(), streams: new Set([slug]) })
  }

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!trimmed || busy) return
    if (existing) {
      open(slugOfStream(existing))
      onClose()
      return
    }
    if (!drain || !identity) return
    setBusy(true)
    try {
      const stream = await createStream(getDrainDb(drain.dbName), trimmed, identity, color)
      open(slugOfStream(stream))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const chip = variant === 'chip'
  const iconBtn = `flex shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 ${
    chip ? 'size-7 rounded-full' : 'size-6'
  }`

  return (
    <div className={chip ? 'shrink-0' : 'mx-1'}>
      <form
        ref={formRef}
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        onBlur={(e) => {
          if (!trimmed && !formRef.current?.contains(e.relatedTarget as Node)) onClose()
        }}
        className={`flex items-center gap-1 border bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 ${
          chip ? 'h-8 w-56 rounded-full pr-0.5 pl-2' : 'rounded-md py-0.5 pr-0.5 pl-1.5'
        }`}
      >
        <button
          type="button"
          title={existing ? `#${existing.name} already exists` : 'Change colour'}
          aria-label="Change colour"
          disabled={!!existing}
          onClick={() => setColorIndex((i) => (i + 1) % STREAM_COLORS.length)}
          className="flex size-5 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="text-sm font-semibold leading-none" style={{ color }}>
            #
          </span>
        </button>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New stream"
          aria-label="Stream name"
          maxLength={60}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <button type="submit" disabled={!trimmed || busy} aria-label={existing ? `Open #${existing.name}` : 'Create stream'} title={existing ? `Open #${existing.name}` : 'Create (Enter)'} className={iconBtn}>
          <Check className="size-3.5" />
        </button>
        <button type="button" onClick={onClose} aria-label="Cancel" title="Cancel (Esc)" className={iconBtn}>
          <X className="size-3.5" />
        </button>
      </form>
      {existing && !chip && (
        <p className="px-2 pt-1 text-[11px] text-muted-foreground">
          Opens <span style={{ color: existing.color }}>#{existing.name}</span>
        </p>
      )}
    </div>
  )
}
