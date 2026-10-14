import { useEffect, useState, type RefObject } from 'react'
import type { Editor } from '@tiptap/react'
import { Bold, Italic, Underline, Strikethrough, Code, Eraser, Sparkles } from 'lucide-react'
import { AiPanel } from './AiPanel'

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

  // Ask AI panel (AiPanel.tsx). Ctrl/Cmd+J toggles it from anywhere in
  // the editor.
  const [aiOpen, setAiOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setAiOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (center === null) return null

  return (
    <div
      className="fixed bottom-8 z-40 flex items-center gap-1 rounded-full border bg-background/95 px-2 py-1.5 shadow-md backdrop-blur-sm"
      style={{ left: center, transform: 'translateX(-50%)' }}
    >
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
        title="Ask AI (Ctrl/⌘ J)"
        aria-pressed={aiOpen}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setAiOpen((open) => !open)}
        className={`flex size-7 items-center justify-center rounded-full text-violet-500 outline-none transition-colors hover:bg-violet-100 hover:text-violet-600 focus-visible:ring-2 focus-visible:ring-violet-400 dark:text-violet-400 dark:hover:bg-violet-500/20 dark:hover:text-violet-300 ${
          aiOpen ? 'bg-violet-100 dark:bg-violet-500/20' : ''
        }`}
      >
        <Sparkles className="size-3.5" />
      </button>
      {aiOpen && <AiPanel editor={editor} center={center} onClose={() => setAiOpen(false)} />}
    </div>
  )
}
