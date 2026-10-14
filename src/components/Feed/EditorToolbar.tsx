import { useEffect, useState, type RefObject } from 'react'
import type { Editor } from '@tiptap/react'
import { Bold, Italic, Underline, Strikethrough, Code, Eraser, Wand2, Loader2 } from 'lucide-react'
import { cleanupText } from '@/services/aiApi'

// Finds the top-level paragraph node the cursor is currently inside — every
// top-level node in this doc is a block/entry (see BlockParagraph.ts), so
// there's always exactly one match.
function currentBlock(editor: Editor): { pos: number; node: any } | null {
  const { from } = editor.state.selection
  let found: { pos: number; node: any } | null = null
  editor.state.doc.forEach((node, pos) => {
    if (from >= pos && from <= pos + node.nodeSize) found = { pos, node }
  })
  return found
}

// Re-locates a block by entryId rather than trusting a position captured
// before the AI round-trip — other edits (this user's or a synced remote
// change) could easily shift positions during that gap.
function findBlockByEntryId(editor: Editor, entryId: string): { pos: number; node: any } | null {
  let found: { pos: number; node: any } | null = null
  editor.state.doc.forEach((node, pos) => {
    if (node.attrs.entryId === entryId) found = { pos, node }
  })
  return found
}

function setCleaningFlag(editor: Editor, pos: number, value: boolean) {
  editor.commands.command(({ tr }: any) => {
    tr.setNodeAttribute(pos, 'cleaning', value)
    tr.setMeta('addToHistory', false)
    return true
  })
}

const BUTTONS: { mark: string; icon: typeof Bold; label: string; run: (editor: Editor) => void }[] = [
  { mark: 'bold', icon: Bold, label: 'Bold', run: (e) => e.chain().focus().toggleBold().run() },
  { mark: 'italic', icon: Italic, label: 'Italic', run: (e) => e.chain().focus().toggleItalic().run() },
  { mark: 'underline', icon: Underline, label: 'Underline', run: (e) => e.chain().focus().toggleUnderline().run() },
  { mark: 'strike', icon: Strikethrough, label: 'Strikethrough', run: (e) => e.chain().focus().toggleStrike().run() },
  { mark: 'code', icon: Code, label: 'Code', run: (e) => e.chain().focus().toggleCode().run() },
]

export function EditorToolbar({
  editor,
  anchorRef,
}: {
  editor: Editor
  anchorRef: RefObject<HTMLElement | null>
}) {
  // editor.isActive() doesn't trigger React renders on its own. Re-render
  // only when the set of active marks changes, not on every keystroke.
  const [, setActiveKey] = useState('')
  useEffect(() => {
    const onTransaction = () => setActiveKey(BUTTONS.map((b) => (editor.isActive(b.mark) ? '1' : '0')).join(''))
    editor.on('transaction', onTransaction)
    return () => {
      editor.off('transaction', onTransaction)
    }
  }, [editor])

  // The outline/comments columns aren't equal widths, so the entry column
  // isn't centered within the row — measure its actual rect instead of
  // centering on the whole row (which centered on outline+editor+comments).
  const [center, setCenter] = useState<number | null>(null)
  useEffect(() => {
    const recompute = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (rect) setCenter(rect.left + rect.width / 2)
    }
    recompute()
    window.addEventListener('resize', recompute)
    const ro = new ResizeObserver(recompute)
    if (anchorRef.current) ro.observe(anchorRef.current)
    return () => {
      window.removeEventListener('resize', recompute)
      ro.disconnect()
    }
  }, [anchorRef])

  const [cleaning, setCleaning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCleanup = async () => {
    const found = currentBlock(editor)
    if (!found) return
    const { node } = found
    const entryId = node.attrs.entryId
    const text = node.textContent.trim()
    if (!text || !entryId) return

    setCleaning(true)
    setCleaningFlag(editor, found.pos, true)
    try {
      const { text: cleaned } = await cleanupText(text)
      const target = findBlockByEntryId(editor, entryId)
      if (target) {
        const from = target.pos + 1
        const to = target.pos + target.node.nodeSize - 1
        editor.chain().focus().insertContentAt({ from, to }, cleaned).run()
      }
    } catch (err: any) {
      // Leave the original text untouched on failure, but surface why —
      // silently eating a "daily limit reached" error left users with no
      // idea the button had stopped working for the rest of the day.
      setError(err?.message || 'Failed to refine')
      setTimeout(() => setError(null), 4000)
    } finally {
      const target = findBlockByEntryId(editor, entryId)
      if (target) setCleaningFlag(editor, target.pos, false)
      setCleaning(false)
    }
  }

  if (center === null) return null

  return (
    <div
      className="fixed bottom-8 z-40 flex items-center gap-1 rounded-full border bg-background/95 px-2 py-1.5 shadow-md backdrop-blur-sm"
      style={{ left: center, transform: 'translateX(-50%)' }}
    >
      {error && (
        <div className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border bg-background px-2.5 py-1 text-xs text-destructive shadow-sm">
          {error}
        </div>
      )}
      {BUTTONS.map(({ mark, icon: Icon, label, run }) => (
        <button
          key={mark}
          type="button"
          title={label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run(editor)}
          className={`flex size-7 items-center justify-center rounded-full outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${
            editor.isActive(mark) ? 'bg-accent text-foreground' : 'text-muted-foreground'
          }`}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
      <div className="mx-1 h-4 w-px bg-border" />
      <button
        type="button"
        title="Clear formatting"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().unsetAllMarks().run()}
        className="flex size-7 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Eraser className="size-3.5" />
      </button>
      <div className="mx-1 h-4 w-px bg-border" />
      <button
        type="button"
        title="Refine with AI"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleCleanup}
        disabled={cleaning}
        className={`flex size-7 items-center justify-center rounded-full text-violet-500 outline-none transition-all hover:scale-110 hover:bg-violet-100 hover:text-violet-600 focus-visible:ring-2 focus-visible:ring-violet-400 dark:text-violet-400 dark:hover:bg-violet-500/20 dark:hover:text-violet-300 ${
          cleaning ? 'bg-violet-100 dark:bg-violet-500/20' : ''
        }`}
      >
        {cleaning ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
      </button>
    </div>
  )
}
