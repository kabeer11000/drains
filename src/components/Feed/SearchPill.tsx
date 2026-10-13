import { useEffect } from 'react'
import { useStore } from '@nanostores/react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { $searchJump } from '@/stores/streams'
import { $commandPaletteOpen } from '@/components/CommandPalette'

// What's left on screen after picking a search result: a small pill at the
// top of the feed to step through the other matches, reopen the search
// (click the query), or dismiss. Not an input — the search box itself
// only ever lives in the command palette.
export function SearchPill() {
  const jump = useStore($searchJump)

  useEffect(() => {
    if (!jump) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !$commandPaletteOpen.get()) $searchJump.set(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [jump])

  // A plain jump (e.g. "Recently edited") has no query to step through.
  if (!jump?.query) return null
  const total = jump.entryIds.length
  const step = (by: number) => $searchJump.set({ ...jump, index: (jump.index + by + total) % total })

  return (
    <div className="sticky top-3 z-30 flex h-0 justify-center">
      <div className="flex h-8 items-center gap-0.5 rounded-full border bg-popover/95 py-0.5 pr-1 pl-1 text-xs shadow-md backdrop-blur-md">
        <button
          type="button"
          onClick={() => $commandPaletteOpen.set(true)}
          title="Edit search"
          className="flex max-w-56 items-center gap-1.5 rounded-full px-2 py-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{jump.query}</span>
        </button>
        <span className="px-1 tabular-nums text-muted-foreground">
          {jump.index + 1} / {total}
        </span>
        <PillButton label="Previous match" onClick={() => step(-1)} disabled={total < 2}>
          <ChevronUp className="size-3.5" />
        </PillButton>
        <PillButton label="Next match" onClick={() => step(1)} disabled={total < 2}>
          <ChevronDown className="size-3.5" />
        </PillButton>
        <PillButton label="Clear search (Esc)" onClick={() => $searchJump.set(null)}>
          <X className="size-3.5" />
        </PillButton>
      </div>
    </div>
  )
}

function PillButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-full p-1 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}
