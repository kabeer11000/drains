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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateDrainMeta } from '@/helpers/drains'
import { populateDrains } from '@/helpers/drains'
import {
  listDrainMembers,
  inviteToDrain,
  removeDrainMemberApi,
  getPublishStatus,
  publishDrain,
  unpublishDrain,
  getIngestionStatus,
  regenerateIngestionToken,
} from '@/services/drainsApi'
import { $identity } from '@/services/identity'
import { X } from 'lucide-react'

interface EditDrainDialogProps {
  drainId: string
  currentTitle: string
  currentDescription?: string
  currentTags?: string[]
  visibility: 'private' | 'shared'
  isOwner: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function RenameDrainDialog({
  drainId,
  currentTitle,
  currentDescription = '',
  currentTags = [],
  visibility,
  isOwner,
  open,
  onOpenChange,
}: EditDrainDialogProps) {
  const [title, setTitle] = useState(currentTitle)
  const [description, setDescription] = useState(currentDescription)
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>(currentTags)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [members, setMembers] = useState<string[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [inviting, setInviting] = useState(false)
  const [confirmPrivate, setConfirmPrivate] = useState(false)
  const [makingPrivate, setMakingPrivate] = useState(false)

  const [publicToken, setPublicToken] = useState<string | null>(null)
  const [publishBusy, setPublishBusy] = useState(false)
  const [publishError, setPublishError] = useState('')

  useEffect(() => {
    if (!open) return
    listDrainMembers(drainId).then(setMembers).catch(() => setMembers([]))
  }, [open, drainId])

  useEffect(() => {
    if (!open || !isOwner) return
    getPublishStatus(drainId).then((s) => setPublicToken(s.token)).catch(() => {})
  }, [open, drainId, isOwner])

  const handleTogglePublish = async () => {
    setPublishBusy(true)
    setPublishError('')
    try {
      if (publicToken) {
        await unpublishDrain(drainId)
        setPublicToken(null)
      } else {
        const { token } = await publishDrain(drainId)
        setPublicToken(token)
      }
    } catch (err: any) {
      setPublishError(err?.message ?? 'Failed to update publish status')
    } finally {
      setPublishBusy(false)
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const publicUrl = publicToken ? `${origin}/p/${publicToken}` : ''

  const [ingestionToken, setIngestionToken] = useState<string | null>(null)
  const [lastIngestedAt, setLastIngestedAt] = useState<number | null>(null)
  const [ingestionBusy, setIngestionBusy] = useState(false)

  useEffect(() => {
    if (!open || !isOwner) return
    getIngestionStatus(drainId)
      .then((s) => {
        setIngestionToken(s.token)
        setLastIngestedAt(s.lastIngestedAt)
      })
      .catch(() => {})
  }, [open, drainId, isOwner])

  const ingestionUrl = ingestionToken ? `${origin}/api/ingest/${ingestionToken}` : ''

  const handleRegenerateIngestion = async () => {
    setIngestionBusy(true)
    try {
      const { token } = await regenerateIngestionToken(drainId)
      setIngestionToken(token)
      setLastIngestedAt(null)
    } finally {
      setIngestionBusy(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setTitle(currentTitle)
      setDescription(currentDescription)
      setTags(currentTags)
      setTagInput('')
      setError('')
      setInviteEmail('')
      setInviteError('')
    }
    onOpenChange(next)
  }

  const addTag = (raw: string) => {
    const t = raw.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t])
    setTagInput('')
  }

  const removeTag = (t: string) => setTags((prev) => prev.filter((x) => x !== t))

  const handleSave = async () => {
    const trimmed = title.trim()
    if (!trimmed) {
      setError('Title cannot be empty')
      return
    }
    setLoading(true)
    setError('')
    try {
      await updateDrainMeta(
        drainId,
        trimmed,
        description.trim() || undefined,
        tags.length ? tags : undefined,
      )
      await populateDrains()
      onOpenChange(false)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  const handleInvite = async () => {
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return
    setInviting(true)
    setInviteError('')
    try {
      await inviteToDrain(drainId, email)
      setMembers((prev) => [...prev, email])
      setInviteEmail('')
      // The drain may have just gone from private to shared — refresh the
      // sidebar's lock/globe icons.
      populateDrains()
    } catch (err: any) {
      setInviteError(err?.message ?? 'Failed to invite')
    } finally {
      setInviting(false)
    }
  }

  // Removes everyone but the owner in one go; the server flips the drain
  // back to private when the last of them is gone (syncDrainVisibility).
  const handleMakePrivate = async () => {
    const me = $identity.get()?.email
    const others = members.filter((m) => m !== me)
    setMakingPrivate(true)
    try {
      for (const email of others) await removeDrainMemberApi(drainId, email)
      setMembers((prev) => prev.filter((m) => m === me))
      populateDrains()
    } catch (err: any) {
      setInviteError(err?.message ?? 'Failed to remove everyone')
      listDrainMembers(drainId).then(setMembers).catch(() => {})
    } finally {
      setMakingPrivate(false)
      setConfirmPrivate(false)
    }
  }

  const handleRemove = async (email: string) => {
    setMembers((prev) => prev.filter((m) => m !== email))
    try {
      await removeDrainMemberApi(drainId, email)
      populateDrains()
    } catch {
      // Refresh from server if the optimistic removal turned out to be wrong
      listDrainMembers(drainId).then(setMembers).catch(() => {})
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent mobileFullScreen className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit drain</DialogTitle>
          <DialogDescription>Update the details for this drain.</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[65vh] gap-6 overflow-y-auto pr-1 max-sm:max-h-none max-sm:overflow-visible max-sm:pr-0 sm:grid-cols-2">
          {/* Left column: core details */}
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  if (error) setError('')
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="edit-desc"
                placeholder="What's this drain for?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-tags">Tags <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <div className="flex flex-wrap items-start content-start gap-1.5 rounded-md border border-input p-2 min-h-[42px]">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => removeTag(t)}
                      className="hover:text-destructive"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  id="edit-tags"
                  className="flex-1 min-w-[80px] bg-transparent outline-none text-sm"
                  placeholder={tags.length ? '' : ' Add a tag, press Enter'}
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault()
                      addTag(tagInput)
                    } else if (e.key === 'Backspace' && !tagInput && tags.length) {
                      removeTag(tags[tags.length - 1])
                    }
                  }}
                  onBlur={() => tagInput && addTag(tagInput)}
                />
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}

            {(isOwner || members.length > 1) && (
              <div className="grid gap-2 border-t pt-3">
                <Label>Sharing</Label>
                <p className="text-xs text-muted-foreground">
                  {members.length > 1
                    ? 'Everyone here can read and write this drain.'
                    : 'Only you can see this drain. Invite someone to make it shared.'}
                </p>
                <div className="flex flex-col gap-1.5">
                  {members.map((email) => (
                    <div key={email} className="flex items-center justify-between rounded-md bg-muted/50 px-2.5 py-1.5 text-sm">
                      <span>{email}</span>
                      {isOwner && email !== $identity.get()?.email && (
                        <button
                          type="button"
                          onClick={() => handleRemove(email)}
                          className="text-muted-foreground hover:text-destructive"
                          title="Remove"
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {isOwner && (
                  <div className="flex gap-1.5">
                    <Input
                      placeholder="Invite by email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleInvite())}
                    />
                    <Button type="button" variant="outline" onClick={handleInvite} disabled={inviting}>
                      {inviting ? 'Inviting…' : 'Invite'}
                    </Button>
                  </div>
                )}
                {inviteError && <p className="text-xs text-destructive">{inviteError}</p>}
                {isOwner && members.length > 1 && (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-dashed px-2.5 py-2 text-xs">
                    <span className="text-muted-foreground">
                      {confirmPrivate
                        ? `Remove ${members.length - 1} ${members.length === 2 ? 'person' : 'people'}? They lose access right away.`
                        : 'Make this drain just yours again.'}
                    </span>
                    <div className="flex shrink-0 gap-1.5">
                      {confirmPrivate && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmPrivate(false)}>
                          Cancel
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant={confirmPrivate ? 'destructive' : 'outline'}
                        disabled={makingPrivate}
                        onClick={() => (confirmPrivate ? handleMakePrivate() : setConfirmPrivate(true))}
                      >
                        {makingPrivate ? 'Removing…' : confirmPrivate ? 'Remove everyone' : 'Make private'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right column: sharing & integrations */}
          {isOwner && (
            <div className="grid gap-6 sm:border-l sm:pl-6">
              <div className="grid gap-2">
                <Label>Public link</Label>
                <p className="text-xs text-muted-foreground">
                  Anyone with the link can view this drain read-only — no sign-in required.
                </p>
                {publicToken && (
                  <div className="flex gap-1.5">
                    <Input readOnly value={publicUrl} onFocus={(e) => e.target.select()} />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => navigator.clipboard.writeText(publicUrl)}
                    >
                      Copy
                    </Button>
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTogglePublish}
                  disabled={publishBusy}
                >
                  {publishBusy ? 'Working…' : publicToken ? 'Unpublish' : 'Publish'}
                </Button>
                {publishError && <p className="text-xs text-destructive">{publishError}</p>}
              </div>

              <div className="grid gap-2 border-t pt-4">
                <Label>GitHub integration</Label>
                <p className="text-xs text-muted-foreground">
                  Add this as a webhook in your repo's{' '}
                  <span className="font-medium">Settings → Webhooks → Add webhook</span>. Set{' '}
                  <span className="font-medium">Payload URL</span> to the link below, Content type to{' '}
                  <span className="font-medium">application/json</span>, and select the{' '}
                  <span className="font-medium">push</span>,{' '}
                  <span className="font-medium">pull requests</span>, and{' '}
                  <span className="font-medium">issues</span> events.
                </p>
                <div className="flex gap-1.5">
                  <Input readOnly value={ingestionUrl} onFocus={(e) => e.target.select()} />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigator.clipboard.writeText(ingestionUrl)}
                  >
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {lastIngestedAt
                    ? `Last event received ${new Date(lastIngestedAt).toLocaleString()}`
                    : 'Waiting for the first webhook event…'}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRegenerateIngestion}
                  disabled={ingestionBusy}
                >
                  {ingestionBusy ? 'Working…' : 'Regenerate link'}
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
