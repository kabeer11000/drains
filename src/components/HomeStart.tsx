import { useStore } from '@nanostores/react'
import { ChevronRight, Globe, Lock, Search, Sparkles } from 'lucide-react'
import { useWhatsNew } from '@/hooks/use-whats-new'
import { $drains } from '@/helpers/drains'
import { $identity } from '@/services/identity'
import { $commandPaletteOpen, isMac } from './CommandPalette'
import NewDrainDialog from './NewDrainDialog'

const SHOWN_DRAINS = 6

// Home (no drain open). Search is the centrepiece here — a full field, not
// the floating pill drain pages use — with the drains themselves as the
// other way in, so the page reads as a starting point rather than an
// empty state with a search box hovering over it.
export default function HomeStart() {
  const drains = useStore($drains)
  const identity = useStore($identity)
  const firstName = identity?.name?.split(/\s+/)[0]
  const whatsNew = useWhatsNew()

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-16">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="text-center">
          <h1 className="text-lg font-semibold tracking-tight">{firstName ? `Welcome back, ${firstName}` : 'Welcome back'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Open a drain, or search everything you've logged.</p>
        </div>

        <button
          type="button"
          onClick={() => $commandPaletteOpen.set(true)}
          className="flex h-11 w-full items-center gap-3 rounded-xl border bg-muted px-4 text-sm text-muted-foreground shadow-sm outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1 text-left">Search all drains…</span>
          <kbd className="rounded border border-border/60 px-1.5 font-sans text-[11px]">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        </button>

        {whatsNew.info && (
          <a
            href={whatsNew.info.url}
            onClick={whatsNew.markSeen}
            className="group flex items-start gap-3 rounded-xl border px-4 py-3 outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Sparkles className="mt-0.5 size-4 shrink-0 text-violet-500" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                What's new
                {whatsNew.unread && <span className="size-1.5 rounded-full bg-violet-500" />}
              </span>
              {whatsNew.info.snippet && (
                <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{whatsNew.info.snippet}</span>
              )}
            </span>
            <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          </a>
        )}

        {drains.length > 0 ? (
          <div>
            <p className="mb-1.5 px-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              Your drains
            </p>
            <div className="flex flex-col gap-px">
              {drains.slice(0, SHOWN_DRAINS).map((d: any) => (
                <a
                  key={d.dbName}
                  href={`/drains/${d.dbName}`}
                  className="group flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {d.visibility === 'shared' ? (
                    <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{d.title || 'Untitled'}</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </a>
              ))}
            </div>
            {drains.length > SHOWN_DRAINS && (
              <p className="mt-1.5 px-1 text-xs text-muted-foreground">
                {drains.length - SHOWN_DRAINS} more in the sidebar.
              </p>
            )}
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">No drains yet. Create one to start logging.</p>
        )}

        <div className="flex justify-center">
          <NewDrainDialog />
        </div>
      </div>
    </div>
  )
}
