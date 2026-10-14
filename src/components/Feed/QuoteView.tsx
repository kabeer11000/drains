import { useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { CornerUpLeft, X } from 'lucide-react'
import { resolveQuote, watchQuote, type QuotedEntry } from '@/services/quotes'
import { $activeDrain } from '@/stores/streams'
import { $jumpTo } from '@/stores/feed'
import { stripHtml } from '@/utils/stripHtml'
import { relativeTime, safeColor, safeName } from './utils'

// Card for a quoted entry. Resolves the source only once the card is near
// the viewport (a long feed can hold many quotes), shows the stored excerpt
// until then, and follows live edits to the source via watchQuote.
export function QuoteView({ node, selected, deleteNode, editor }: NodeViewProps) {
  const { dbName, entryIdRef, excerpt } = node.attrs as { dbName: string; entryIdRef: string; excerpt: string }
  const ref = useRef<HTMLSpanElement>(null)
  const [near, setNear] = useState(false)
  const [entry, setEntry] = useState<QuotedEntry | null | undefined>(undefined)

  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  useEffect(() => {
    if (!near || !dbName || !entryIdRef) return
    let alive = true
    resolveQuote(dbName, entryIdRef).then((e) => alive && setEntry(e))
    const stop = watchQuote(dbName, entryIdRef, (e) => alive && setEntry(e))
    return () => {
      alive = false
      stop()
    }
  }, [near, dbName, entryIdRef])

  const jump = () => {
    if ($activeDrain.get()?.dbName === dbName) $jumpTo.set({ entryId: entryIdRef, block: 'center' })
    else window.location.href = `/drains/${dbName}#entry-${entryIdRef}`
  }

  const deleted = entry === null
  const text = entry ? stripHtml(entry.content) : excerpt

  return (
    <NodeViewWrapper
      as="span"
      ref={ref}
      contentEditable={false}
      className={`group/quote relative my-1.5 block cursor-pointer rounded-lg border-l-[3px] bg-muted/40 py-2 pr-8 pl-3 text-left ${
        selected ? 'ring-2 ring-ring' : ''
      }`}
      style={{ borderLeftColor: entry ? safeColor(entry.createdByColor) : 'var(--border)' }}
      onClick={jump}
      title="Go to the quoted entry"
    >
      <span className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <CornerUpLeft className="size-3 shrink-0" />
        {entry ? (
          <>
            <span className="font-medium text-foreground/80">{safeName(entry.createdByName)}</span>
            <span>· {relativeTime(entry.createdAt)}</span>
          </>
        ) : deleted ? (
          <span>The quoted entry was deleted</span>
        ) : (
          <span>Quote</span>
        )}
      </span>
      <span className={`line-clamp-3 block text-sm ${deleted ? 'text-muted-foreground line-through' : ''}`}>{text}</span>
      {editor.isEditable && (
        <button
          type="button"
          aria-label="Remove quote"
          onClick={(e) => {
            e.stopPropagation()
            deleteNode()
          }}
          className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-opacity group-hover/quote:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:opacity-70"
        >
          <X className="size-3.5" />
        </button>
      )}
    </NodeViewWrapper>
  )
}
