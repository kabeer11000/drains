import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getDrainDb } from '@/services/db'
import { startDrainSync } from '@/services/sync'
import { createDrain } from '@/services/drainsApi'
import { populateDrains } from '@/helpers/drains'

export default function NewDrainDialog() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const reset = () => {
    setTitle('')
    setDescription('')
    setTagInput('')
    setTags([])
    setError('')
  }

  const addTag = (raw: string) => {
    const t = raw.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t])
    setTagInput('')
  }

  const removeTag = (t: string) => setTags((prev) => prev.filter((x) => x !== t))

  const create = async () => {
    setIsLoading(true)
    setError('')
    try {
      const finalTitle = title.trim() || 'Untitled'
      const { dbName } = await createDrain(finalTitle, 'private', description.trim() || undefined, tags)

      // Warm the local PouchDB for this drain and start syncing it right
      // away so it's ready the instant the user navigates into it.
      getDrainDb(dbName)
      startDrainSync(dbName)
      await populateDrains()

      setOpen(false)
      reset()
    } catch (err: any) {
      setError(err?.message || 'Failed to create drain')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger render={<Button size="sm" className="rounded-full" />}>New drain</DialogTrigger>
      <DialogContent mobileFullScreen>
        <DialogHeader>
          <DialogTitle>New drain</DialogTitle>
          <DialogDescription>Create a new drain for your changelog entries.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="drain-title">Title</Label>
          <Input
            id="drain-title"
            placeholder="Release notes"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="drain-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input
            id="drain-desc"
            placeholder="What's this drain for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="drain-tags">Tags <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <div className="flex flex-wrap gap-1.5 rounded-md border border-input p-2 min-h-[42px]">
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
              id="drain-tags"
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
        <p className="text-xs text-muted-foreground">
          Only you can see a new drain. Invite people, or publish a read-only link, any time from its settings.
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={isLoading}>
            {isLoading ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
