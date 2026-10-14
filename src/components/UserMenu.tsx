import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { $identity, updateDisplayName } from '@/services/identity'
import { logout } from '@/services/authSession'
import { getStoredTheme, setTheme, watchSystemTheme, type Theme } from '@/services/theme'
import { $aiUsage, fetchAiUsage } from '@/services/aiApi'
import { History, KeyRound, LogOut, Pencil, Sparkles } from 'lucide-react'
import { useWhatsNew } from '@/hooks/use-whats-new'

function ChangeNameDialog({
  open,
  onOpenChange,
  currentName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentName: string
}) {
  const [name, setName] = useState(currentName)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(currentName)
      setError('')
    }
  }, [open, currentName])

  const save = async () => {
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      setError('Name must be at least 2 characters')
      return
    }
    setSaving(true)
    setError('')
    try {
      await updateDisplayName(trimmed)
      onOpenChange(false)
    } catch (err: any) {
      setError(err?.message || 'Failed to update name')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change your name</DialogTitle>
          <DialogDescription>This is how you'll appear to others across shared drains.</DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="Ada Lovelace"
          autoFocus
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function UserMenu({
  onOpenTokens,
  onOpenTrash,
}: {
  onOpenTokens: () => void
  onOpenTrash: () => void
}) {
  const identity = useStore($identity)
  const whatsNew = useWhatsNew()
  const aiUsage = useStore($aiUsage)
  const [theme, setThemeState] = useState<Theme>('system')
  const [changeNameOpen, setChangeNameOpen] = useState(false)

  useEffect(() => {
    setThemeState(getStoredTheme())
    return watchSystemTheme()
  }, [])

  useEffect(() => {
    fetchAiUsage().catch(() => {})
  }, [])

  if (!identity) return null

  const handleThemeChange = (value: string) => {
    const next = value as Theme
    setThemeState(next)
    setTheme(next)
  }

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            title={identity.name || identity.email}
            style={{ background: identity.color }}
            className="relative m-0 flex size-8 shrink-0 items-center justify-center rounded-full p-0 text-xs font-medium text-white outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        }
      >
        {identity.name?.[0]?.toUpperCase() || identity.email[0]?.toUpperCase()}
        {whatsNew.unread && (
          <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-violet-500" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col items-start gap-0.5 py-1.5">
            <span className="truncate text-sm font-medium text-foreground">{identity.name || identity.email}</span>
            <span className="truncate text-xs text-muted-foreground">{identity.email}</span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">{identity.publicUserId}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {aiUsage && (
          <>
            <div className="px-1.5 py-1.5">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">AI requests today</span>
                <span className="font-medium">
                  {aiUsage.used} / {aiUsage.limit}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full rounded-full transition-all ${
                    aiUsage.used >= aiUsage.limit ? 'bg-destructive' : 'bg-violet-400'
                  }`}
                  style={{ width: `${Math.min(100, (aiUsage.used / aiUsage.limit) * 100)}%` }}
                />
              </div>
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuRadioGroup value={theme} onValueChange={handleThemeChange}>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setChangeNameOpen(true)}>
          <Pencil className="size-3.5" />
          Change name
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenTokens}>
          <KeyRound className="size-3.5" />
          API tokens
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenTrash}>
          <History className="size-3.5" />
          Recently deleted
        </DropdownMenuItem>
        {whatsNew.info && (
          <DropdownMenuItem
            onClick={() => {
              whatsNew.markSeen()
              window.location.href = whatsNew.info!.url
            }}
          >
            <Sparkles className="size-3.5" />
            What's new
            {whatsNew.unread && <span className="ml-auto size-1.5 rounded-full bg-violet-500" />}
          </DropdownMenuItem>
        )}
        {/* temp: Feedback menu item hidden — Sleekplan's widget provides its
            own trigger UI now; restore this (and a Sleekplan open call) if
            a menu entry point is wanted later.
        <DropdownMenuItem onClick={openFeedbackWidget}>
          <MessageSquarePlus className="size-3.5" />
          Feedback
        </DropdownMenuItem>
        */}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={logout}>
          <LogOut className="size-3.5" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <ChangeNameDialog open={changeNameOpen} onOpenChange={setChangeNameOpen} currentName={identity.name} />
    </>
  )
}
