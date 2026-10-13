import { useStore } from '@nanostores/react'
import { AlertTriangle, X } from 'lucide-react'
import { $sync, patchSyncState } from '@/stores/sync'

// Shown above the composer whenever writing here won't reach the server —
// the corner pill alone was too easy to miss, and an entry that silently
// never syncs is the worst failure this app can have.
export function SyncBanner({ dbName }: { dbName: string }) {
  const state = useStore($sync)[dbName]
  if (!state) return null

  let title: string | null = null
  let body: string | null = null
  if (state.status === 'error' && state.problem === 'no-access') {
    title = "This drain isn't syncing"
    body =
      "The server refused it: you aren't a member, or the drain doesn't exist. Anything you write here stays on this device only."
  } else if (state.status === 'error') {
    title = 'Sync is failing'
    body = "Your changes are saved on this device, but they aren't reaching the server yet. Sync keeps retrying."
  }

  const rejected = state.rejected > 0

  if (!title && !rejected) return null

  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {title && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
          <div>
            <p className="font-medium text-red-600 dark:text-red-400">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
          </div>
        </div>
      )}
      {rejected && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-amber-700 dark:text-amber-300">
              {state.rejected} {state.rejected === 1 ? "change wasn't" : "changes weren't"} saved to the server
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The server rejected {state.rejected === 1 ? 'it' : 'them'}
              {state.lastRejectReason ? ` (${state.lastRejectReason})` : ''}. You can only edit or delete entries you
              wrote; other changes still sync normally.
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => patchSyncState(dbName, { rejected: 0, lastRejectReason: undefined })}
            className="rounded-md p-0.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
