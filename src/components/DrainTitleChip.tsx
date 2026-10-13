import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { Pencil } from 'lucide-react'
import { $drains } from '@/helpers/drains'
import { listDrainMembers } from '@/services/drainsApi'
import { AvatarGroup } from './AvatarGroup'
import RenameDrainDialog from './RenameDrainDialog'

const FOCUS_RING = 'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

// Mirrors SyncIndicator's pill, opposite corner — the current drain's title,
// double as a button into the same edit dialog the sidebar's "..." menu uses.
export default function DrainTitleChip({ dbName }: { dbName: string }) {
  const drains = useStore($drains)
  const drain = drains.find((d: any) => d.dbName === dbName)
  const [members, setMembers] = useState<string[]>([])
  const [editOpen, setEditOpen] = useState(false)

  useEffect(() => {
    if (drain?.visibility !== 'shared') return
    listDrainMembers(dbName)
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [dbName, drain?.visibility])

  useEffect(() => {
    document.title = drain?.title ? `${drain.title} — Drains` : 'Drains'
    return () => {
      document.title = 'Drains'
    }
  }, [drain?.title])

  if (!drain) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setEditOpen(true)}
        className={`absolute top-4 left-20 z-50 flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground lg:left-6 ${FOCUS_RING}`}
      >
        {drain.visibility === 'shared' && <AvatarGroup emails={members} />}
        <span className="max-w-[110px] truncate font-medium sm:max-w-[160px] text-foreground">{drain.title || 'Untitled'}</span>
        <Pencil className="size-3 shrink-0" />
      </button>

      <RenameDrainDialog
        drainId={dbName}
        currentTitle={drain.title || ''}
        currentDescription={drain.description}
        currentTags={drain.tags}
        visibility={drain.visibility}
        isOwner={drain.role === 'owner'}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  )
}
