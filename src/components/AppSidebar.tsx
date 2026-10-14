import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { Globe, Lock, MoreHorizontal, Pencil, Trash2, Link, Inbox, Download, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { RecentActivity } from './RecentActivity'
import { ApiTokensDialog } from './ApiTokensDialog'
import { TrashDialog } from './TrashDialog'
import { exportDrainMarkdown } from '@/utils/exportDrain'
import { $drains, populateDrains, deleteDrain } from '@/helpers/drains'
import { $identity, getStoredIdentityClient } from '@/services/identity'
import { getAuthCredential } from '@/services/authSession'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import NewDrainDialog from './NewDrainDialog'
import RenameDrainDialog from './RenameDrainDialog'
import { AvatarGroup } from './AvatarGroup'
import { listDrainMembers } from '@/services/drainsApi'
import UserMenu from './UserMenu'

const FOCUS_RING = 'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

// Below lg, the sidebar becomes a slide-over drawer toggled by PageShell's
// mobile menu button instead of always occupying 30% of a screen too
// narrow to spare that space — see PageShell.tsx.
export const $sidebarOpen = atom(false)

interface Drain {
  dbName: string
  title: string
  description?: string
  tags?: string[]
  visibility: 'shared' | 'private'
  role: 'owner' | 'member'
  createdByTokenName?: string
}

function DrainCard({
  drain,
  active,
  dimmed,
  onEdit,
  onDelete,
  onCopyLink,
}: {
  drain: Drain
  active: boolean
  dimmed: boolean
  onEdit: (dbName: string) => void
  onDelete: (dbName: string) => void
  onCopyLink: (dbName: string) => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const href = `/drains/${drain.dbName}`
  const [members, setMembers] = useState<string[]>([])

  useEffect(() => {
    if (drain.visibility !== 'shared') return
    listDrainMembers(drain.dbName)
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [drain.dbName, drain.visibility])

  return (
    <a
      href={href}
      onClick={() => $sidebarOpen.set(false)}
      onContextMenu={(e) => {
        e.preventDefault()
        triggerRef.current?.click()
      }}
      className={`group relative mb-2 flex flex-col gap-1 break-inside-avoid rounded-lg border p-3 transition-opacity transition-colors ${FOCUS_RING} ${
        active ? 'border-ring bg-secondary' : 'border-border hover:bg-secondary/70'
      } ${dimmed ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug">
          {drain.title || 'Untitled'}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {drain.visibility === 'shared' ? (
            <Globe className="size-3.5 text-muted-foreground" />
          ) : (
            <Lock className="size-3.5 text-muted-foreground" />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  ref={triggerRef}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  className={`rounded p-1 hover:bg-secondary ${FOCUS_RING}`}
                />
              }
            >
              <MoreHorizontal className="size-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => onEdit(drain.dbName)}>
                <Pencil className="size-3.5" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCopyLink(drain.dbName)}>
                <Link className="size-3.5" />
                Copy link
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportDrainMarkdown(drain.dbName, drain.title || 'Untitled')}>
                <Download className="size-3.5" />
                Export as Markdown
              </DropdownMenuItem>
              {drain.role === 'owner' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => onDelete(drain.dbName)}>
                    <Trash2 className="size-3.5" />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {drain.description && (
        <p className="line-clamp-2 text-[0.6875rem] text-muted-foreground leading-snug">
          {drain.description}
        </p>
      )}

      {drain.tags && drain.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {drain.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-block rounded-full bg-secondary px-1.5 py-0.5 text-[0.625rem] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
          {drain.tags.length > 3 && (
            <span className="text-[0.625rem] text-muted-foreground">+{drain.tags.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-end justify-between gap-1.5 pt-1">
        <span className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          {drain.visibility === 'shared' ? 'Shared' : 'Private'}
          {drain.createdByTokenName && (
            <span
              title={`Created by ${drain.createdByTokenName}`}
              className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-600 dark:bg-violet-500/20 dark:text-violet-300"
            >
              Agent-created
            </span>
          )}
        </span>
        {drain.visibility === 'shared' && <AvatarGroup emails={members} max={3} />}
      </div>
    </a>
  )
}

export default function AppSidebar() {
  const drains = useStore($drains)
  const sidebarOpen = useStore($sidebarOpen)
  const tagsScrollRef = useRef<HTMLDivElement>(null)
  const scrollTags = (dir: 1 | -1) => tagsScrollRef.current?.scrollBy({ left: dir * 120, behavior: 'smooth' })
  // View transitions remount this island on every navigation — if $drains
  // (a module-level nanostore) already has data from before, skip the
  // skeleton flash instead of forcing a loading state on every nav.
  const [loading, setLoading] = useState($drains.get().length === 0)
  const [editTarget, setEditTarget] = useState<{
    dbName: string
    title: string
    description?: string
    tags?: string[]
    visibility: 'shared' | 'private'
    isOwner: boolean
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ dbName: string; title: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [tokensOpen, setTokensOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set())

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const d of drains) for (const t of d.tags || []) set.add(t)
    return Array.from(set).sort()
  }, [drains])

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  useEffect(() => {
    const identity = getStoredIdentityClient()
    $identity.set(identity)

    // The sk_identity cookie (checked server-side to decide whether to
    // redirect to /login) and the localStorage credential the actual API
    // calls need (authSession.ts) share the same lifetime now, but a user
    // can still clear localStorage without clearing cookies (e.g. site data
    // settings, browser extensions). Without this check every authenticated
    // call below would just throw "Not signed in" with no recourse.
    if (identity && !getAuthCredential()) {
      document.cookie = 'sk_identity=; path=/; max-age=0'
      window.location.href = '/'
      return
    }

    populateDrains().finally(() => setLoading(false))
  }, [])

  const handleEdit = (dbName: string) => {
    const drain = $drains.get().find((d: any) => d.dbName === dbName)
    if (!drain) return
    setEditTarget({
      dbName,
      title: drain.title || '',
      description: drain.description,
      tags: drain.tags,
      visibility: drain.visibility,
      isOwner: drain.role === 'owner',
    })
  }

  const handleDeleteConfirmed = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await deleteDrain(deleteTarget.dbName)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleCopyLink = (dbName: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/drains/${dbName}`)
  }

  const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''

  return (
    <>
      {/* Below lg, the sidebar is a bottom-sheet drawer instead of a
          persistent 30%-width column — a fixed percentage would leave
          almost no room for the feed on a phone-width screen. */}
      {sidebarOpen && (
        <div
          data-backdrop
          className="fixed inset-0 z-50 bg-black/40 supports-backdrop-filter:backdrop-blur-xs lg:hidden"
          onClick={() => $sidebarOpen.set(false)}
        />
      )}
      <aside
        className={`fixed inset-x-2 bottom-2 z-50 flex h-[94%] max-h-[900px] flex-col rounded-2xl bg-background transition-transform duration-200 max-lg:will-change-transform lg:static lg:inset-auto lg:z-auto lg:h-full lg:max-h-none lg:w-[30%] lg:translate-y-0 lg:rounded-xl ${
          sidebarOpen ? 'translate-y-0' : 'translate-y-[calc(100%+1rem)]'
        }`}
      >
        <div className="flex shrink-0 justify-center pt-2 pb-1 lg:hidden">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>
        {/* Header */}
        <div className="relative flex h-14 shrink-0 items-center border-b px-4">
          <button
            type="button"
            title="Close menu"
            onClick={() => $sidebarOpen.set(false)}
            className={`mr-1 flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground lg:hidden ${FOCUS_RING}`}
          >
            <X className="size-4" />
          </button>
          <a
            href="/"
            className={`rounded-full border border-transparent px-3 py-1.5 font-mono text-sm font-medium transition-colors hover:border-border hover:bg-secondary ${FOCUS_RING}`}
          >
            drains.dev
          </a>
          <div className="ml-auto flex items-center gap-2">
            <UserMenu onOpenTokens={() => setTokensOpen(true)} onOpenTrash={() => setTrashOpen(true)} />
            <NewDrainDialog />
          </div>
        </div>

        <ApiTokensDialog open={tokensOpen} onOpenChange={setTokensOpen} />
        <TrashDialog open={trashOpen} onOpenChange={setTrashOpen} />

        <div className="feed-scroll flex flex-1 flex-col overflow-y-auto px-4 pb-4">
          {allTags.length > 0 && (
            <div className="sticky top-0 z-10 -mx-4 mb-3 flex h-8 shrink-0 items-center gap-1 bg-background px-2">
              <button
                type="button"
                title="Scroll tags left"
                onClick={() => scrollTags(-1)}
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground ${FOCUS_RING}`}
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <div
                ref={tagsScrollRef}
                className="flex flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem] transition-colors ${FOCUS_RING} ${
                      activeTags.has(tag)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:bg-secondary'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <button
                type="button"
                title="Scroll tags right"
                onClick={() => scrollTags(1)}
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground ${FOCUS_RING}`}
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          )}

          {loading ? (
            <div className="mt-4 columns-1 gap-2 sm:columns-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="mb-2 h-[86px] w-full break-inside-avoid rounded-lg" />
              ))}
            </div>
          ) : (
            <>
              <div className="mt-4 columns-1 gap-2 sm:columns-2">
                {drains.map((drain: any) => {
                  const href = `/drains/${drain.dbName}`
                  const dimmed = activeTags.size > 0 && !(drain.tags || []).some((t: string) => activeTags.has(t))
                  return (
                    <DrainCard
                      key={drain.dbName}
                      drain={drain}
                      active={currentPath === href}
                      dimmed={dimmed}
                      onEdit={handleEdit}
                      onDelete={(dbName) => setDeleteTarget({ dbName, title: drain.title || 'this drain' })}
                      onCopyLink={handleCopyLink}
                    />
                  )
                })}
              </div>
              {drains.length === 0 && (
                <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
                  <div className="flex size-10 items-center justify-center rounded-full bg-secondary">
                    <Inbox className="size-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium">No drains yet</p>
                  <p className="max-w-[180px] text-xs text-muted-foreground">
                    Create a drain to start logging your engineering work.
                  </p>
                  <div className="mt-2">
                    <NewDrainDialog />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <RecentActivity />

        {/* Animated dog sprite — bottom left, walk cycle in place. Sheet is
            an 11-row x 4-col grid of 128x128 frames (not a single vertical
            strip); row 0 is a clean 4-frame walk cycle. */}
        {/* <div
          className="hidden shrink-0 lg:block"
          style={{
            width: 96,
            height: 96,
            marginLeft: 8,
            marginBottom: 4,
            backgroundImage: 'url(/dog-sprite.png)',
            backgroundSize: '384px 1056px',
            backgroundRepeat: 'no-repeat',
            imageRendering: 'pixelated',
            animation: 'dogWalkFrames 0.8s steps(4) infinite',
          }}
        /> */}
      </aside>

      {/* Edit Dialog */}
      {editTarget && (
        <RenameDrainDialog
          drainId={editTarget.dbName}
          currentTitle={editTarget.title}
          currentDescription={editTarget.description}
          currentTags={editTarget.tags}
          visibility={editTarget.visibility}
          isOwner={editTarget.isOwner}
          open={true}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null)
          }}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              It'll move to Recently Deleted for 30 days — restorable any time before then, from the trash icon in
              the sidebar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleting} onClick={handleDeleteConfirmed}>
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
