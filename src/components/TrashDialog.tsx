import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { DirectoryDrainEntry } from '@/lib/couchdb-admin'
import { fetchTrashedDrains, restoreDrainApi, purgeDrainApi } from '@/services/drainsApi'
import { populateDrains } from '@/helpers/drains'

const RETENTION_DAYS = 30

function daysLeft(trashedAt: number) {
  const elapsed = (Date.now() - trashedAt) / (24 * 60 * 60 * 1000)
  return Math.max(0, Math.ceil(RETENTION_DAYS - elapsed))
}

// Owner-only view of this account's own trashed drains — deleting a drain
// (AppSidebar.tsx) soft-deletes it (couchdb-admin.ts's trashDrain), leaving
// the underlying data completely untouched for RETENTION_DAYS. Restore
// brings it back exactly as it was; "Delete forever" is the one genuinely
// irreversible action here, deliberately a second, less-discoverable step
// instead of the default single click a normal delete used to be.
export function TrashDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [drains, setDrains] = useState<DirectoryDrainEntry[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    fetchTrashedDrains().then(setDrains).catch(() => setDrains([]))
  }, [open])

  const handleRestore = async (dbName: string) => {
    setBusy(dbName)
    try {
      await restoreDrainApi(dbName)
      setDrains((prev) => prev.filter((d) => d.dbName !== dbName))
      await populateDrains()
    } finally {
      setBusy(null)
    }
  }

  const handlePurge = async (dbName: string) => {
    setBusy(dbName)
    try {
      await purgeDrainApi(dbName)
      setDrains((prev) => prev.filter((d) => d.dbName !== dbName))
      setConfirmPurge(null)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileFullScreen className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Recently deleted</DialogTitle>
          <DialogDescription>
            Deleted drains stay here for {RETENTION_DAYS} days before being permanently removed — restore any time
            before then.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          {drains.map((d) => (
            <div key={d.dbName} className="rounded-md bg-muted/50 px-2.5 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{d.title || 'Untitled'}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.trashedAt ? `${daysLeft(d.trashedAt)} days left` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleRestore(d.dbName)}
                    disabled={busy === d.dbName}
                  >
                    Restore
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => setConfirmPurge(d.dbName)}
                    disabled={busy === d.dbName}
                  >
                    Delete forever
                  </Button>
                </div>
              </div>
              {confirmPurge === d.dbName && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                  <span>This can't be undone.</span>
                  <div className="flex gap-1.5">
                    <Button type="button" variant="outline" size="sm" onClick={() => setConfirmPurge(null)}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => handlePurge(d.dbName)}
                      disabled={busy === d.dbName}
                    >
                      {busy === d.dbName ? 'Deleting…' : 'Confirm'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {drains.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">Nothing in trash.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
