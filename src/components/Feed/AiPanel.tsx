import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { ArrowUp, Check, Copy, CornerDownLeft, Loader2, Plus, RotateCcw, Sparkles, Square, X } from 'lucide-react'
import { useStore } from '@nanostores/react'
import { transformText } from '@/services/aiApi'
import { $streams, $activeDrain } from '@/stores/streams'
import { $identity } from '@/services/identity'
import { getDrainDb } from '@/services/db'
import { createStream, linkEntry, slugOfStream, STREAM_COLORS } from '@/services/streams'
import { getAiTarget, setAiTarget, type AiTargetState } from './AiTarget'

const QUICK: { label: string; instruction: string }[] = [
  { label: 'Fix grammar', instruction: 'Fix spelling and grammar. Change as little as possible.' },
  { label: 'Shorter', instruction: 'Make it shorter and tighter. Keep every fact.' },
  { label: 'Clearer', instruction: 'Rewrite it to be clearer and easier to scan.' },
  { label: 'Checklist', instruction: 'Turn it into a checklist: one "- " item per line.' },
  { label: 'Summarize', instruction: 'Summarize it in one or two sentences.' },
  { label: 'Sort into streams', instruction: 'File this entry into the streams it belongs to. Keep the text unchanged.' },
  { label: 'Continue', instruction: 'Continue writing from where it ends, in the same style. Return the original text followed by the continuation.' },
]

// Text of a range as the model should see it: hard breaks become newlines,
// mentions keep their @handle.
function textOf(editor: Editor, from: number, to: number) {
  return editor.state.doc.textBetween(from, to, '\n', (leaf) =>
    leaf.type.name === 'hardBreak' ? '\n' : leaf.attrs?.id ? `@${leaf.attrs.id}` : ''
  )
}

// Plain text -> inline nodes (text + hard breaks). Never parsed as HTML.
function toInline(text: string) {
  const nodes: any[] = []
  text.split('\n').forEach((line, i) => {
    if (i) nodes.push({ type: 'hardBreak' })
    if (line) nodes.push({ type: 'text', text: line })
  })
  return nodes
}

// The selection inside one entry, or else the entry the caret is in.
function captureTarget(editor: Editor): AiTargetState | null {
  const { from, to, empty, $from, $to } = editor.state.selection
  const entry = $from.node(1)
  if (!entry?.attrs?.entryId) return null
  if (!empty && $from.node(1) === $to.node(1)) return { entryId: entry.attrs.entryId, from, to, whole: false }
  if (!entry.textContent.trim()) return null
  const start = $from.before(1)
  return { entryId: entry.attrs.entryId, from: start + 1, to: start + entry.nodeSize - 1, whole: true }
}

function wholeRange(editor: Editor, entryId: string) {
  let range: { from: number; to: number } | null = null
  editor.state.doc.forEach((node, pos) => {
    if (!range && node.attrs.entryId === entryId) range = { from: pos + 1, to: pos + node.nodeSize - 1 }
  })
  return range as { from: number; to: number } | null
}

// "Ask AI": works on the selection (or the whole entry), keeps it
// highlighted, and shows the result with Replace / Add as new entry / Try
// again / Copy, plus a follow-up box to keep refining the result.
export function AiPanel({ editor, center, onClose }: { editor: Editor; center: number; onClose: () => void }) {
  const [target] = useState(() => captureTarget(editor))
  const [source] = useState(() => (target ? textOf(editor, target.from, target.to) : ''))
  const [prompt, setPrompt] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [fileInto, setFileInto] = useState<string[]>([])
  const streams = useStore($streams)
  const [last, setLast] = useState<{ base: string; instruction: string; label: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (target) setAiTarget(editor, target)
    return () => {
      abort.current?.abort()
      setAiTarget(editor, null)
    }
  }, [editor, target])

  const run = async (base: string, instruction: string, label = instruction) => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setLast({ base, instruction, label })
    setLoading(true)
    setError(null)
    setCopied(false)
    try {
      const answer = await transformText(base, instruction, streams.map((s) => s.name), controller.signal)
      setResult(answer.text)
      setFileInto(answer.streams)
      setFollowUp('')
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError(err?.message || 'AI request failed')
    } finally {
      if (abort.current === controller) setLoading(false)
    }
  }

  // File an entry into the streams the AI picked: existing ones by name,
  // new ones created (createStream reuses a stream with the same slug).
  const fileEntry = async (entryId: string | undefined) => {
    const drain = $activeDrain.get()
    const identity = $identity.get()
    if (!entryId || !drain || !identity || !fileInto.length) return
    const db = getDrainDb(drain.dbName)
    for (const name of fileInto) {
      const known = $streams.get().find((s) => s.name.toLowerCase() === name.toLowerCase())
      const stream =
        known ?? (await createStream(db, name, identity, STREAM_COLORS[$streams.get().length % STREAM_COLORS.length]))
      await linkEntry(db, entryId, slugOfStream(stream), identity)
    }
  }

  const replace = () => {
    const t = getAiTarget(editor)
    if (!t || result === null) return
    const range = t.whole ? wholeRange(editor, t.entryId) : { from: t.from, to: t.to }
    if (!range) return
    // "Sort into streams" returns the text unchanged; don't rewrite it then.
    if (result !== source) editor.chain().focus().insertContentAt(range, toInline(result)).run()
    fileEntry(t.entryId).catch((err) => console.error('Failed to file entry', err))
    onClose()
  }

  const addAsEntry = () => {
    if (result === null) return
    // Right under the composer: a new entry is the newest one. AssignBlockId
    // gives it an id in the same update, so it can be filed right away.
    const at = editor.state.doc.firstChild?.nodeSize ?? 0
    editor.chain().insertContentAt(at, { type: 'paragraph', content: toInline(result) }).run()
    const created = editor.state.doc.nodeAt(at)
    fileEntry(created?.attrs.entryId).catch((err) => console.error('Failed to file entry', err))
    onClose()
  }

  const copy = async () => {
    if (result === null) return
    await navigator.clipboard?.writeText(result).catch(() => {})
    setCopied(true)
  }

  const submitPrompt = () => {
    const p = prompt.trim()
    if (p) run(source, p)
  }

  const onKeys = (submit: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="fixed bottom-20 z-40 flex w-[min(36rem,calc(100vw-1rem))] -translate-x-1/2 flex-col gap-2.5 rounded-2xl border bg-popover p-3 text-popover-foreground shadow-xl"
      style={{ left: center }}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="size-3.5 text-violet-500" />
        <span className="min-w-0 flex-1 truncate">
          {!target
            ? 'Click into an entry, or select some text, first.'
            : last
              ? last.label
              : target.whole
                ? 'Ask AI about this entry'
                : 'Ask AI about the selected text'}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close (Esc)"
          className="rounded-md p-1 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {target && result === null && !loading && (
        <>
          <div className="flex items-end gap-2 rounded-xl border bg-background px-3 py-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
            <textarea
              ref={inputRef}
              autoFocus
              rows={1}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onKeys(submitPrompt)}
              placeholder="Tell AI what to do…  e.g. turn into a todo list"
              className="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-sm outline-none [field-sizing:content] placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={submitPrompt}
              disabled={!prompt.trim()}
              aria-label="Run"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background outline-none transition-opacity disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => run(source, q.instruction, q.label)}
                className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {q.label}
              </button>
            ))}
          </div>
        </>
      )}

      {loading && (
        <div className="flex items-center gap-3 rounded-xl border bg-background px-3 py-3">
          <Loader2 className="size-4 shrink-0 animate-spin text-violet-500" />
          <div className="flex-1 space-y-1.5">
            <div className="ai-shimmer h-2.5 w-4/5 rounded-full" />
            <div className="ai-shimmer h-2.5 w-1/2 rounded-full" />
          </div>
          <button
            type="button"
            onClick={() => {
              abort.current?.abort()
              setLoading(false)
            }}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Square className="size-3" />
            Stop
          </button>
        </div>
      )}

      {error && !loading && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      {result !== null && !loading && (
        <>
          <div className="max-h-64 overflow-y-auto rounded-xl border bg-background px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
            {result || <span className="text-muted-foreground">(empty)</span>}
          </div>
          {fileInto.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Files into
              {fileInto.map((name) => {
                const known = streams.find((s) => s.name.toLowerCase() === name.toLowerCase())
                return (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-px font-semibold"
                    style={
                      known
                        ? { background: `color-mix(in srgb, ${known.color} 16%, transparent)`, color: known.color }
                        : undefined
                    }
                  >
                    #{known?.name ?? name}
                    {!known && <span className="font-normal opacity-70">(new)</span>}
                  </span>
                )
              })}
              <button
                type="button"
                onClick={() => setFileInto([])}
                className="rounded px-1 underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                Don&apos;t file
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={replace}
              className="flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Check className="size-3.5" />
              Replace
            </button>
            <ActionButton icon={Plus} label="Add as new entry" onClick={addAsEntry} />
            <ActionButton icon={RotateCcw} label="Try again" onClick={() => last && run(last.base, last.instruction, last.label)} />
            <ActionButton icon={copied ? Check : Copy} label={copied ? 'Copied' : 'Copy'} onClick={copy} />
            <button
              type="button"
              onClick={() => {
                setResult(null)
                setLast(null)
                requestAnimationFrame(() => inputRef.current?.focus())
              }}
              className="ml-auto rounded-full px-2.5 py-1.5 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Discard
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-xl border bg-background px-3 py-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
            <input
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              onKeyDown={onKeys(() => followUp.trim() && run(result, followUp.trim()))}
              placeholder="Ask for changes…  e.g. even shorter"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
          </div>
        </>
      )}
    </div>
  )
}

function ActionButton({ icon: Icon, label, onClick }: { icon: typeof Plus; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
}
