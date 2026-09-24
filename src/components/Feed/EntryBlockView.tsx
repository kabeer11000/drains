import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import { History, GitCommit, Sparkles, Bot, Trash2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { relativeTime, safeName, safeColor } from './utils'

export function EntryBlockView({ node, deleteNode }: NodeViewProps) {
  const { entryId, authorColor, authorName, updatedAt, createdAt, createdByName, source, viaToken } = node.attrs
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
        // it) which means it contributes nothing to this box's height —
        // without an explicit reservation, the wrapped two-line placeholder
        // text overflows past a box sized only for one empty line.
        minHeight: isComposer ? 68 : undefined,
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
          className={`pointer-events-none absolute top-0 -left-2.5 w-0.5 rounded-full bg-violet-300 dark:bg-violet-500 ${
            isLastInGroup ? 'h-1/2' : 'bottom-0'
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
          className="pointer-events-none absolute left-3.5 right-3.5 text-neutral-400"
        >
          Click to start typing, all your changes autosave… Type @ to mention someone, [[ to reference a drain or entry.
        </span>
      )}
      {!isComposer && <Popover>
        {/* Sits above the padding box entirely (-top-6, clear of the text's
            own top padding) so it never overlaps the actual text glyphs —
            a pill sitting -top-2.5 (inside the box) previously intercepted
            the mousedown/mouseup of a text-selection drag ending near that
            corner. Safe to keep pointer-events on even while hidden now,
            since there's nothing selectable in the gap above the card. */}
        <PopoverTrigger
          render={
            <button
              type="button"
              contentEditable={false}
              className="absolute -top-6 right-2 flex items-center gap-1 rounded-full border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 shadow-sm outline-none transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          }
        >
          {isIngested || isSummary ? <SourceIcon className="size-2.5" /> : <History className="size-2.5" />}
          {creator} · {updatedAt ? relativeTime(Number(updatedAt)) : ''}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 text-sm" contentEditable={false}>
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
      <NodeViewContent as="span" className={isCleaning ? 'invisible' : undefined} />
    </NodeViewWrapper>
  )
}
