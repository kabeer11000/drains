import { useEffect, useRef, useState } from 'react'
import { isConstrained } from '@/services/perf'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ExternalLink, X } from 'lucide-react'
import { authHeader } from '@/services/apiAuth'
import type { LinkPreview } from '@/lib/unfurl'
import { parseEmbed } from './embeds'

// One request per URL per page load, shared by every card showing it.
const previews = new Map<string, Promise<LinkPreview | null>>()
function loadPreview(url: string) {
  let p = previews.get(url)
  if (!p) {
    // .then() first so a signed-out authHeader() throw lands in .catch.
    p = Promise.resolve()
      .then(() => fetch(`/api/unfurl?url=${encodeURIComponent(url)}`, { headers: { Authorization: authHeader() } }))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.preview ?? null)
      .catch(() => null)
    previews.set(url, p)
  }
  return p
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function EmbedView({ node, selected, deleteNode, editor }: NodeViewProps) {
  const embed = parseEmbed(String(node.attrs.url ?? ''))
  const [preview, setPreview] = useState<LinkPreview | null | undefined>(undefined)
  const cardRef = useRef<HTMLAnchorElement>(null)
  const [nearView, setNearView] = useState(false)

  // Fetch the preview only once the card is about to scroll into view, and
  // not at all on constrained devices/connections (the plain link remains).
  useEffect(() => {
    const el = cardRef.current
    if (!el || nearView || isConstrained()) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNearView(true)
      },
      { rootMargin: '300px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [nearView])

  useEffect(() => {
    if (!embed || embed.src || !nearView) return
    let alive = true
    loadPreview(embed.url).then((p) => alive && setPreview(p))
    return () => {
      alive = false
    }
  }, [embed?.url, embed?.src, nearView])

  if (!embed) return <NodeViewWrapper as="span" />

  const frame = `group/embed relative my-1.5 block overflow-hidden rounded-lg border bg-background ${
    selected ? 'ring-2 ring-ring' : ''
  }`
  const remove = editor.isEditable && (
    <button
      type="button"
      aria-label="Remove embed"
      onClick={() => deleteNode()}
      className="absolute top-1.5 right-1.5 z-10 flex size-6 items-center justify-center rounded-md bg-background/90 text-muted-foreground opacity-0 shadow-sm outline-none transition-opacity group-hover/embed:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:opacity-80"
    >
      <X className="size-3.5" />
    </button>
  )

  if (embed.src) {
    return (
      <NodeViewWrapper as="span" className={frame} contentEditable={false} data-drag-handle>
        {remove}
        <span className="block aspect-video w-full">
          <iframe
            src={embed.src}
            title={`${embed.kind} embed`}
            loading="lazy"
            className="size-full"
            // Players need scripts and their own origin; nothing else.
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
          />
        </span>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper as="span" className={frame} contentEditable={false}>
      {remove}
      <a
        ref={cardRef}
        href={embed.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="flex items-stretch gap-3 p-3 text-left no-underline outline-none hover:bg-accent/40"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ExternalLink className="size-3 shrink-0" />
            <span className="truncate">{preview?.siteName ?? hostOf(embed.url)}</span>
          </span>
          <span className="line-clamp-2 text-sm font-medium text-foreground">
            {preview?.title ?? embed.url}
          </span>
          {preview?.description && (
            <span className="line-clamp-2 text-xs text-muted-foreground">{preview.description}</span>
          )}
        </span>
        {preview?.image && (
          <img
            src={preview.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-20 w-28 shrink-0 rounded-md object-cover max-sm:h-16 max-sm:w-20"
          />
        )}
      </a>
    </NodeViewWrapper>
  )
}
