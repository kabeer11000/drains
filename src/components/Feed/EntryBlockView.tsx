import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import { useStore } from '@nanostores/react'
import { GitCommit, Sparkles, Bot, Trash2, MoreHorizontal } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { $streams, $streamLinks, $feedFilter } from '@/stores/streams'
import { relativeTime, safeName, safeColor } from './utils'
import { slugOfStream } from '@/services/streams'
import { singleSelectedStream } from './feedFilter'
import { StreamPicker } from './StreamPicker'
import { $comments, $summarizeDayOf } from '@/stores/feed'

export function EntryBlockView({ node, deleteNode }: NodeViewProps) {
  const { entryId, authorColor, authorName, updatedAt, createdAt, createdByName, source, viaToken } = node.attrs
  const streams = useStore($streams)
  const streamLinks = useStore($streamLinks)
  const feedFilter = useStore($feedFilter)
  const comments = useStore($comments)
  const entryComments = entryId ? comments.filter((c) => c.entryId === entryId) : []
  const isIngested = source === 'github'
  const isSummary = source === 'ai-summary'
  const SourceIcon = isSummary ? Sparkles : GitCommit

  const color = safeColor(authorColor)
  const author = safeName(authorName)
  const creator = createdByName ? safeName(createdByName) : author
  const wasEdited = !!(createdAt && updatedAt && Number(createdAt) !== Number(updatedAt))

  // Rendered directly rather than via Tiptap's Placeholder extension —
  // ReactNodeViewRenderer's update() skips re-rendering when only
  // decorations change and the node reference hasn't (see its source:
  // "ProseMirror renders decorations independently on the contentDOM"),
  // so Placeholder's is-empty/data-placeholder decoration never reaches a
  // custom NodeView's wrapper at all.
  //
  // isComposer (explicitly managed by ensureLeadingComposer in
  // Feed/index.tsx) — not raw emptiness — decides whether this shows the
  // composer's dashed-border placeholder look. A real entry that happens to
  // be empty (e.g. edited down to nothing) should look like a plain blank
  // entry, not the composer.
  const isComposer = !!node.attrs.isComposer && node.content.size === 0
  const isCleaning = !!node.attrs.cleaning
  // Both derived by SummaryGrouping.ts from whichever summary entries
  // currently exist — revert to false on their own the moment the claiming
  // summary is deleted, no cleanup needed here. isLastInGroup is whichever
  // claimed entry has a non-claimed (or no) paragraph right after it — the
  // one that closes the rim; every other claimed entry (including the
  // first, sitting flush under the summary) only needs side borders, so
  // summary + claimed entries read as one continuous outlined card instead
  // of separate ones.
  const isClaimed = !!node.attrs.claimedBySummary
  const isLastInGroup = !!node.attrs.isLastInGroup
  // A second (or third...) summary stacked on the same day without
  // deleting the earlier one first — treated like a claimed entry for
  // chain purposes (tight margin, no badge of its own) so re-summarizing
  // reads as one continuous root-summary-plus-everything-under-it group
  // instead of separately-badged cards with a visible seam between them.
  const isNestedSummary = !!node.attrs.isNestedSummary

  // Live streams this entry is filed in, shown as colored labels before the
  // text. Links to a deleted stream are skipped (the entry reads as unsorted).
  const linked = entryId ? streamLinks.get(entryId) : undefined
  const labels = linked
    ? streams.filter((s) => linked.has(slugOfStream(s))).map((s) => ({ slug: slugOfStream(s), name: s.name, color: s.color }))
    : []
  // AI summaries describe a whole day, so they aren't filed themselves.
  const fileable = !!entryId && !isComposer && !isSummary
  const composerSlug = isComposer ? singleSelectedStream(feedFilter) : null
  const composerStream = composerSlug ? streams.find((s) => slugOfStream(s) === composerSlug) : undefined

  return (
    <NodeViewWrapper
      as="p"
      data-entry-id={entryId}
      // Lets a `#entry-<id>` link to the page already open (Recent Activity,
      // search) scroll here natively: Astro's router hands same-page hash
      // links to the browser, which only matches element ids.
      id={entryId ? `entry-${entryId}` : undefined}
      className={`group relative ${isComposer ? 'border border-dashed border-border' : ''}`}
      style={{
        // The placeholder below is position: absolute (so it never
        // intercepts clicks meant for the empty editable content beneath
        // it) which means it contributes nothing to this box's height.
        // 36px keeps the card roughly one line tall instead of a chunky
        // blank block — the placeholder sits inside, centered.
        minHeight: isComposer ? 36 : undefined,
        marginBottom: isClaimed || isNestedSummary ? 2 : undefined,
        backgroundColor: isComposer || isSummary ? undefined : `color-mix(in srgb, ${color} 12%, var(--background))`,
        backgroundImage: isSummary
          ? 'linear-gradient(to right, color-mix(in srgb, #7c3aed 12%, var(--background)), var(--background))'
          : undefined,
      }}
    >
      {(isSummary || isClaimed) && (
        // A decorative thread bar, not a border — the global
        // .tiptap p[data-entry-id] rule (global.css) sets its own `border`
        // shorthand outside Tailwind's utility layer, so it always wins the
        // cascade over a border-* utility class here regardless of source
        // order in the component. An absolutely-positioned overlay can't
        // collide with that at all. Runs the summary's own left edge down
        // through every entry it claims, reading as one continuous thread;
        // each claimed entry's bar spans its own full height, so
        // consecutive entries (tight margin-bottom between them) look
        // unbroken. Stops halfway with a small dot on whichever entry is
        // last in the group, instead of dangling past the end.
        <span
          contentEditable={false}
          // -bottom-[5px] bridges this card's bottom border, the 2px
          // chained margin and the next card's top border, so consecutive
          // bars join into one line instead of dashes.
          className={`pointer-events-none absolute top-0 -left-2.5 w-0.5 bg-violet-300 dark:bg-violet-500 ${
            isLastInGroup ? 'h-1/2' : '-bottom-[5px]'
          }`}
        >
          {isLastInGroup && (
            <span className="absolute -left-0.5 top-full size-1.5 rounded-full bg-violet-300 dark:bg-violet-500" />
          )}
        </span>
      )}
      {isSummary && !isNestedSummary && (
        <span
          contentEditable={false}
          className="pointer-events-none absolute -top-5 left-2 flex items-center gap-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:bg-violet-500/20 dark:text-violet-300"
        >
          <Sparkles className="size-2.5" />
          AI Summary
        </span>
      )}
      {isComposer && (
        <span
          contentEditable={false}
          className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400 dark:text-neutral-500"
        >
          {composerStream ? (
            <>
              Write in <span style={{ color: composerStream.color }}>#{composerStream.name}</span>…
            </>
          ) : (
            'Write here. @ to mention, # to file in a stream, [[ to reference.'
          )}
        </span>
      )}
      {!isComposer && <Popover>
        {/* Details + actions for this entry. Inside the card's top-right
            corner as a real tap target: hover-revealed on desktop, always
            (faintly) shown on touch screens, which have no hover — the old
            floating pill above the card was unreachable on a phone. Touch
            cards reserve right padding for it (global.css) so it never
            covers text. Icon-only so it fits the gutter every card reserves
            (global.css); the time is in its tooltip and in the menu. */}
        <PopoverTrigger
          render={
            <button
              type="button"
              contentEditable={false}
              aria-label="Entry details"
              title={`${creator} · ${updatedAt ? relativeTime(Number(updatedAt)) : ''}`}
              className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-md border border-transparent text-muted-foreground opacity-0 outline-none transition-opacity group-hover:border-border group-hover:bg-background/90 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:opacity-100 [@media(hover:none)]:opacity-70"
            />
          }
        >
          <MoreHorizontal className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 text-sm" contentEditable={false}>
          <div className="flex items-center gap-2 font-medium">
            {isIngested || isSummary ? (
              <SourceIcon className="size-3 shrink-0" />
            ) : (
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
            )}
            {author}
          </div>
          <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
            {viaToken && (
              <p className="flex items-center gap-1 text-violet-600 dark:text-violet-300">
                <Bot className="size-3" />
                via {viaToken}
              </p>
            )}
            {createdAt && (
              <p>
                Created by {creator} · {relativeTime(Number(createdAt))}
                <br />
                {new Date(Number(createdAt)).toLocaleString()}
              </p>
            )}
            {wasEdited && (
              <p>
                Last edited by {author} · {relativeTime(Number(updatedAt))}
                <br />
                {new Date(Number(updatedAt)).toLocaleString()}
              </p>
            )}
          </div>
          {fileable && (
            <div className="mt-3 border-t pt-2.5">
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Streams</p>
              <StreamPicker entryId={entryId} autoFocus={false} />
            </div>
          )}
          {entryComments.length > 0 && (
            <div className="mt-3 border-t pt-2.5">
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Comments ({entryComments.length})</p>
              <div className="flex max-h-40 flex-col gap-2 overflow-y-auto">
                {entryComments.map((c) => (
                  <div key={c._id} className="text-xs">
                    <span className="font-medium" style={{ color: safeColor(c.authorColor) }}>
                      {safeName(c.authorName)}
                    </span>{' '}
                    <span className="text-muted-foreground">{relativeTime(c.createdAt)}</span>
                    <p className="mt-0.5 break-words text-foreground/90">{c.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!isSummary && createdAt && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={() => $summarizeDayOf.set(entryId)}
            >
              <Sparkles className="size-3.5" />
              Summarize this day
            </Button>
          )}
          {isSummary && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 w-full text-destructive hover:bg-destructive/10"
              onClick={() => deleteNode()}
            >
              <Trash2 className="size-3.5" />
              Delete summary
            </Button>
          )}
        </PopoverContent>
      </Popover>}
      {isCleaning && (
        <span
          contentEditable={false}
          className="pointer-events-none absolute inset-0 flex flex-col justify-center gap-1.5 px-3.5"
        >
          <span className="ai-shimmer h-2.5 w-3/4 rounded-full" />
          <span className="ai-shimmer h-2.5 w-1/2 rounded-full" />
        </span>
      )}
      {fileable && labels.length > 0 && (
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                contentEditable={false}
                title="Change streams"
                className="mr-1.5 inline-flex max-w-full items-center gap-1 rounded align-[1px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            {labels.map((l) => (
              <span
                key={l.slug}
                className="inline-flex items-center rounded px-1.5 py-px text-[11px] font-semibold leading-4"
                style={{ background: `color-mix(in srgb, ${l.color} 16%, transparent)`, color: l.color }}
              >
                {l.name}
              </span>
            ))}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-1.5 text-sm" contentEditable={false}>
            <StreamPicker entryId={entryId} />
          </PopoverContent>
        </Popover>
      )}
      <NodeViewContent as="span" className={isCleaning ? 'invisible' : undefined} />
    </NodeViewWrapper>
  )
}
