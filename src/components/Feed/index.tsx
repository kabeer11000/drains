import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { DOMSerializer } from '@tiptap/pm/model'
import { ulid } from 'ulid'
import { Skeleton } from '@/components/ui/skeleton'
import { getDrainDb } from '@/services/db'
import { $identity } from '@/services/identity'
import { createEntry, saveEntry, deleteEntry, resolveConflicts, type EntryIdentity } from '@/services/entries'
import { loadComments, watchComments, createComment, deleteComment, type CommentDoc } from '@/services/comments'
import { summarizeEntries } from '@/services/aiApi'
import { slugOfStream, linkEntry, unlinkEntry } from '@/services/streams'
import { $streams, $streamLinks, $feedFilter, $activeDrain, $searchJump } from '@/stores/streams'
import {
  isEntryVisible,
  isFilterActive,
  singleSelectedStream,
  UNSORTED,
  EMPTY_FILTER,
} from './feedFilter'
import { parseQuery, isEmptyQuery, matchesEntry } from './search'
import { SearchHighlight, searchableOf, streamsBySlugOf, setSearchHighlight } from './SearchHighlight'
import { SearchPill } from './SearchPill'
import { SyncBanner } from './SyncBanner'
import { StreamBar } from './StreamBar'
// @ts-ignore - plain JS module
import { sanitizeHtml } from '@/services/sanitize'
import { BlockParagraph } from './BlockParagraph'
import { AssignBlockId } from './AssignBlockId'
import { SummaryGrouping } from './SummaryGrouping'
import { StreamFilter, setHiddenEntries } from './StreamFilter'
import { showSummarySkeleton } from './SummarySkeleton'
import { CommentMark } from './CommentMark'
import { createMentionExtension } from './MentionExtension'
import { ReferenceExtension } from './ReferenceExtension'
import { CommentsAside } from './CommentsAside'
import { OutlineAside } from './OutlineAside'
import { AddCommentPopover } from './AddCommentPopover'
import { EditorToolbar } from './EditorToolbar'
import { useDrainStreams } from './useDrainStreams'
import { createStreamSuggestion } from './StreamSuggestion'
import { onlyEntryTextChanged } from './docDiff'
import { Embed } from './EmbedExtension'
import { AiTarget } from './AiTarget'
import { Quote } from './QuoteExtension'
import { EntrySelectAll } from './EntrySelectAll'
import { notifyEntryChanged } from '@/services/quotes'
import { safeName, safeColor, handleChannelShortcut, collectDays } from './utils'
import { $comments, $summarizeDayOf, $entryIndex, $sourceIds, $jumpTo } from '@/stores/feed'
import { fetchLatest, fetchOlder, fetchNewer, fetchAround, positionOf, withId, withoutId, type EntrySource } from './entrySource'
import { matchingIds } from '@/services/searchIndex'
import { $sync } from '@/stores/sync'
import { useStoreSelector } from '@/hooks/use-store-selector'
import { DateScrubber } from './DateScrubber'
import { X } from 'lucide-react'

const PAGE_SIZE = 50
// Opening a drain renders this many cards; the rest page in as you scroll.
// Every card is a React node view, so fewer up front = a faster open.
const INITIAL_PAGE_SIZE = 20
// The editor never holds more than MAX_WINDOW entries: past it, offscreen
// ones at the far end are dropped (TRIM_SLACK at a time) and paged back in
// on the way back. Keeps the DOM and node-view count bounded for any drain
// size. Jumps load WINDOW_NEWER above and WINDOW_OLDER below the target.
const MAX_WINDOW = 250
const TRIM_SLACK = 50
const WINDOW_NEWER = 20
const WINDOW_OLDER = 30
const RECENT_EDIT_MS = 5 * 60_000
const SAVE_DEBOUNCE_MS = 500

// Astro's ClientRouter can swap client:only islands without reliably running
// React's unmount cleanup (same class of bug already hit in helpers/drains.ts),
// which would otherwise leak one db.changes() listener per navigation. Cancel
// whatever's currently active before starting a new one, on top of the normal
// effect cleanup, so a missed cleanup can never leave more than one stale feed.
let activeEntriesChanges: ReturnType<ReturnType<typeof getDrainDb>['changes']> | null = null
let activeCommentsChanges: ReturnType<typeof watchComments> | null = null
// Varying widths so the loading state reads as text lines, not a uniform bar grid.
const SKELETON_ENTRY_WIDTHS = ['w-3/4', 'w-1/2', 'w-5/6', 'w-2/3', 'w-full', 'w-1/3']

// Build a plain paragraph. Author/time/history are stored as data attributes
// on the <p> (via BlockParagraph attrs) and read by the EntryBlockView
// NodeView, NOT inside the content. Strip any stale meta spans that may be
// baked into old entry content from bad saves.
function entryToBlockHtml(entry: any, rid: string) {
  const rawContent = typeof entry.content === 'string' ? entry.content : '<p></p>'
  const src = document.createElement('div')
  src.innerHTML = rawContent
  // Remove stale meta spans that old saves may have left in content
  src.querySelectorAll('.entry-meta, .entry-dot, .entry-author, .entry-sep, .entry-time, .entry-content').forEach((el) => el.remove())
  const innerSrc = src.firstElementChild as HTMLElement | null

  const p = document.createElement('p')
  p.setAttribute('data-entry-id', rid)
  p.innerHTML = innerSrc ? sanitizeHtml(innerSrc.innerHTML) : ''

  p.setAttribute('data-author-name', safeName(entry.updatedByName))
  p.setAttribute('data-author-color', safeColor(entry.updatedByColor))
  if (entry.updatedAt) p.setAttribute('data-updated-at', String(entry.updatedAt))
  if (entry.createdAt) p.setAttribute('data-created-at', String(entry.createdAt))
  p.setAttribute('data-created-by', safeName(entry.createdByName ?? entry.updatedByName))
  if (entry.createdByEmail) p.setAttribute('data-created-by-email', entry.createdByEmail)
  if (entry.source) p.setAttribute('data-source', entry.source)
  if (entry.viaToken) p.setAttribute('data-via-token', entry.viaToken)
  if (entry.summarizedEntryIds?.length) {
    p.setAttribute('data-summarized-ids', entry.summarizedEntryIds.join(','))
  }

  return p.outerHTML
}

export default function Feed({ dbName }: { dbName: string }) {
  const identity = $identity.get()
  const db = getDrainDb(dbName)
  const entryPrefix = 'entry:'
  const rawId = (fullId: string) => fullId.slice(entryPrefix.length)
  const fullId = (rid: string) => `${entryPrefix}${rid}`

  useDrainStreams(dbName)
  const streams = useStore($streams)
  const streamLinks = useStore($streamLinks)
  const feedFilter = useStore($feedFilter)
  // EntryBlockView's chips/+# popover are Tiptap NodeViews — they can't
  // receive a dbName prop the way OutlineAside/EditorToolbar can, so this
  // is the one bit of context they read back out of a store instead.
  useEffect(() => {
    $activeDrain.set({ dbName })
    return () => {
      if ($activeDrain.get()?.dbName === dbName) $activeDrain.set(null)
    }
  }, [dbName])
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  // First open of a drain on this device: the local DB starts with no docs
  // and fills as sync pulls them. Purely presentational — entries still
  // arrive through the normal live-changes path; this only decides whether
  // to show a skeleton instead of an empty feed in the meantime.
  const [firstSync, setFirstSync] = useState(false)
  const [hasEntries, setHasEntries] = useState(true)
  const syncStatus = useStoreSelector($sync, (m) => m[dbName]?.status ?? 'connecting', dbName)
  useEffect(() => {
    if (syncStatus === 'synced' || syncStatus === 'offline' || syncStatus === 'error') setFirstSync(false)
  }, [syncStatus])
  const hiddenIdsRef = useRef(hiddenIds)
  hiddenIdsRef.current = hiddenIds
  const searchJump = useStore($searchJump)
  // Entries (not the composer or AI summaries) currently shown — drives the
  // channel header's count and its empty state.
  const [visibleCount, setVisibleCount] = useState(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const editorColumnRef = useRef<HTMLDivElement>(null)
  const identityRef = useRef<EntryIdentity>(identity)
  const oldestFullIdRef = useRef<string | null>(null)
  const hasMoreRef = useRef(true)
  const loadingOlderRef = useRef(false)
  // Windowing: the editor holds a contiguous window of the source's entries
  // (newest first), never the whole drain. oldestFullIdRef/hasMoreRef above
  // are its older end; these are its newer end and where it pages from.
  const newestRidRef = useRef<string | null>(null)
  // rid -> when it was last saved from this editor. Trimming skips these for
  // RECENT_EDIT_MS so undo still has the content it needs.
  const recentEditsRef = useRef(new Map<string, number>())
  const hasNewerRef = useRef(false)
  const loadingNewerRef = useRef(false)
  const sourceRef = useRef<EntrySource>({ kind: 'all' })
  // The pagination IntersectionObserver isn't created until this flips —
  // otherwise its very first (always-fires-once) callback reports the
  // sentinel as "in view" against an empty, unscrolled container, and
  // since that's the only edge IntersectionObserver ever reports for a
  // steady state, gating just the callback body would swallow that one
  // legitimate trigger and pagination would never fire again.
  const [initialLoaded, setInitialLoaded] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [summarizingKey, setSummarizingKey] = useState<string | null>(null)
  const [summarizeError, setSummarizeError] = useState<string | null>(null)
  const [comments, setComments] = useState<CommentDoc[]>([])
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveStateResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Issue 1 fix: prevent StrictMode double-render from overwriting content
  const contentInitializedRef = useRef(false)

  // rid -> last content this client knows is persisted (skip redundant saves,
  // and skip re-applying a remote change that's just an echo of our own write).
  const lastSavedRef = useRef<Map<string, string>>(new Map())
  // rid -> true once a doc for it exists in PouchDB (create vs update).
  const existsInDbRef = useRef<Set<string>>(new Set())
  // rid -> authorship from last remote update (updatedByName, updatedByColor)
  const lastAuthorRef = useRef<Map<string, { name: string; color: string }>>(new Map())
  // Per-entry mutex: true while a save for this entry is in-flight.
  // Prevents concurrent saves for the same entry from racing (last-write-wins).
  const saveInFlightRef = useRef<Set<string>>(new Set())
  // Issue 4 fix: sequential change processing — pending op for each entry
  const changePendingRef = useRef<Set<string>>(new Set())
  // Issue 2 fix: update_seq captured after initial load — changes feed starts from here
  const sinceSeqRef = useRef<number | string | null>(null)

  identityRef.current = identity

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      // Every top-level node in this doc must be a plain paragraph — that's
      // the unit AssignBlockId/flushBlocks key entries off of. Disabling the
      // other block types means pasted headings/lists/quotes/code blocks get
      // flattened to paragraphs by ProseMirror's parser instead of becoming
      // untracked nodes that silently vanish on reload.
      StarterKit.configure({
        paragraph: false,
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      BlockParagraph,
      CommentMark,
      AssignBlockId.configure({ getIdentity: () => identityRef.current }),
      SummaryGrouping,
      StreamFilter,
      SearchHighlight,
      createMentionExtension(dbName),
      createStreamSuggestion(dbName),
      ReferenceExtension,
      Embed,
      AiTarget,
      Quote,
      EntrySelectAll,
    ],
    content: '',
    onUpdate: () => scheduleSave(),
  })

  const scrollToTop = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0
    })
  }, [])

  // Keeps an always-empty paragraph pinned at position 0 as the composer
  // for the next new entry (newest-first order — new entries belong at the
  // top), flagged via the isComposer attr so EntryBlockView can tell it
  // apart from any other paragraph that just happens to be empty (e.g. a
  // real entry edited down to nothing) — those should look like plain
  // blank entries, not the composer's placeholder/dashed-border look.
  // Once the user types into the composer, it becomes a real entry like
  // any other, and this inserts a fresh flagged-empty one before it.
  const composerRidRef = useRef<string | null>(null)
  useEffect(() => {
    if (!editor) return
    const ensureLeadingComposer = () => {
      const first = editor.state.doc.firstChild
      if (!first || first.type.name !== 'paragraph') return
      const firstRid = first.attrs.entryId as string | null
      const firstIsEmpty = first.textContent.length === 0
      const firstFlagged = !!first.attrs.isComposer

      if (firstIsEmpty && firstFlagged && composerRidRef.current === firstRid) return

      editor.commands.command(({ tr }: any) => {
        // Clear the flag from whichever entry held it before, in case it's
        // no longer the first child — otherwise it could show the composer
        // look again if later edited back down to empty.
        if (composerRidRef.current && composerRidRef.current !== firstRid) {
          editor.state.doc.forEach((node: any, pos: number) => {
            if (node.attrs.entryId === composerRidRef.current && node.attrs.isComposer) {
              tr.setNodeAttribute(pos, 'isComposer', null)
            }
          })
        }

        if (firstIsEmpty) {
          if (!firstFlagged) tr.setNodeAttribute(0, 'isComposer', true)
          composerRidRef.current = firstRid
        } else {
          tr.setNodeAttribute(0, 'isComposer', null)
          tr.insert(0, editor.schema.nodes.paragraph.create({ isComposer: true }))
          composerRidRef.current = null
        }
        tr.setMeta('addToHistory', false)
        return true
      })
    }
    editor.on('update', ensureLeadingComposer)
    ensureLeadingComposer()
    return () => {
      editor.off('update', ensureLeadingComposer)
    }
  }, [editor])

  const findBlock = useCallback(
    (rid: string): { pos: number; node: any } | null => {
      if (!editor) return null
      let found: { pos: number; node: any } | null = null
      editor.state.doc.forEach((node, pos) => {
        if (found || node.type.name !== 'paragraph') return
        if (node.attrs.entryId === rid) found = { pos, node }
      })
      return found
    },
    [editor]
  )

  // Debounced: walk every top-level block, save whatever changed since the
  // last known-persisted content, and remove docs for blocks that vanished
  // (merged away via backspace) so they don't reappear from a stale doc.
  // Issue 5 fix: per-entry mutex prevents concurrent saves for the same entry.
  const flushBlocks = useCallback(async () => {
    if (!editor) return
    const identity = identityRef.current
    if (!identity) return

    const currentIds = new Set<string>()
    const ops: Promise<any>[] = []

    editor.state.doc.forEach((node: any) => {
      if (node.type.name !== 'paragraph' || !node.attrs.entryId) return
      const rid = node.attrs.entryId
      currentIds.add(rid)

      const html = serializeBlockContent(editor, node)
      if (lastSavedRef.current.get(rid) === html) return
      // Skip if a save for this entry is already in-flight
      if (saveInFlightRef.current.has(rid)) return

      if (!existsInDbRef.current.has(rid)) {
        if (html === '<p></p>') return // never persist an empty new block
        saveInFlightRef.current.add(rid)
        ops.push(
          createEntry(db, html, identity, rid)
            .then((doc) => {
              if (doc) {
                existsInDbRef.current.add(rid)
                lastSavedRef.current.set(rid, html)
                recentEditsRef.current.set(rid, Date.now())
              }
            })
            .finally(() => saveInFlightRef.current.delete(rid))
        )
      } else {
        saveInFlightRef.current.add(rid)
        ops.push(
          saveEntry(db, fullId(rid), html, identity)
            .then(() => {
              lastSavedRef.current.set(rid, html)
              recentEditsRef.current.set(rid, Date.now())
            })
            .finally(() => saveInFlightRef.current.delete(rid))
        )
      }
    })

    for (const rid of existsInDbRef.current) {
      if (!currentIds.has(rid)) {
        ops.push(
          deleteEntry(db, fullId(rid)).then(async () => {
            existsInDbRef.current.delete(rid)
            lastSavedRef.current.delete(rid)
            lastAuthorRef.current.delete(rid)
            // Drop any streamlinks that pointed at this now-deleted entry,
            // otherwise the rail's "files in X" count stays one too high
            // for the stream until the stream itself is deleted. loadLinks
            // returns the full map but it's already cached in
            // $streamLinks — we'd rather just unlink the slugs we know
            // about from the live store rather than re-querying.
            const links = $streamLinks.get().get(rid)
            if (links) {
              const ops2 = [...links].map((slug) => unlinkEntry(db, rid, slug))
              await Promise.all(ops2)
            }
          })
        )
      }
    }

    if (ops.length === 0) {
      setSaveState('idle')
      return
    }

    const results = await Promise.allSettled(ops)
    const hasError = results.some((r) => r.status === 'rejected')
    if (hasError) {
      setSaveState('error')
      return
    }
    setSaveState('saved')
    if (saveStateResetRef.current) clearTimeout(saveStateResetRef.current)
    saveStateResetRef.current = setTimeout(() => setSaveState('idle'), 1500)
  }, [editor, db])

  const scheduleSave = useCallback(() => {
    setSaveState('saving')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(flushBlocks, SAVE_DEBOUNCE_MS)
  }, [flushBlocks])

  // Initial load — latest page, newest entry at the top (changelog
  // convention, not chat) — no scroll adjustment needed since that's
  // already where the viewport starts.
  // Issue 1 fix: guard against StrictMode double-render destroying content.
  // Issue 2 fix: capture update_seq after allDocs, pass to db.changes so we
  // never miss changes that arrive between the snapshot and the live feed.
  useEffect(() => {
    if (!editor) return
    if (contentInitializedRef.current) return
    let cancelled = false

    Promise.all([fetchLatest(db, sourceRef.current, INITIAL_PAGE_SIZE), db.info()]).then(([page, info]) => {
      if (cancelled) return
      setFirstSync(info.doc_count === 0)
      contentInitializedRef.current = true
      sinceSeqRef.current = info.update_seq

      // Leading empty paragraph is the always-there composer for the next
      // new entry (see ensureLeadingComposer below) — pinned at position 0.
      const html = '<p></p>' + page.map((e: any) => entryToBlockHtml(e, rawId(e._id))).join('')
      // addToHistory: false — without this, populating the doc from the
      // database becomes ONE undoable step. A stray Ctrl+Z (nothing else
      // undoable having happened yet) reverts it straight back to empty,
      // and since flushBlocks' diffing sees every entry vanish, it deletes
      // all of them from the database too — confirmed as the actual cause
      // of "clicking an entry and hitting Ctrl+Z deletes everything,"
      // not theoretical.
      //
      // preventUpdate was tried here too (this is a load, not a user edit)
      // but reverted — it also suppresses the 'update' event
      // ensureLeadingComposer (below) listens for, so the leading
      // paragraph never got flagged as the composer after a fresh load,
      // rendering as a plain empty entry instead — confirmed as a real
      // regression, not just a theoretical risk. The lastSavedRef fix
      // below is what actually stops the spurious-save bug; preventUpdate
      // wasn't needed for it.
      editor.chain().setContent(html).command(({ tr }: any) => {
        tr.setMeta('addToHistory', false)
        return true
      }).run()
      page.forEach((e: any) => {
        const rid = rawId(e._id)
        existsInDbRef.current.add(rid)
        if (e.updatedByName) lastAuthorRef.current.set(rid, { name: e.updatedByName, color: e.updatedByColor })
      })
      // Seeded from what this node ACTUALLY re-serializes to right now,
      // not the raw stored e.content — DOMPurify's sanitizer (used when
      // building the HTML fed into the editor) and ProseMirror's own
      // DOMSerializer (used later by flushBlocks to detect changes) don't
      // necessarily round-trip byte-identical output for the same markup
      // (attribute ordering/quoting differ). Comparing raw stored content
      // against a re-serialized string was a real, demonstrated false-
      // positive "changed" detection for entries with any tags/attributes
      // (links, mentions, bot-formatted GitHub entries) — this makes the
      // baseline and the later comparison go through the identical
      // serialization pipeline, so only an actual edit can ever differ.
      page.forEach((e: any) => {
        const rid = rawId(e._id)
        const block = findBlock(rid)
        lastSavedRef.current.set(rid, block ? serializeBlockContent(editor, block.node) : e.content)
      })
      // page is newest-first; the oldest loaded entry (pagination anchor) is last.
      oldestFullIdRef.current = page[page.length - 1]?._id ?? null
      hasMoreRef.current = page.length === INITIAL_PAGE_SIZE
      newestRidRef.current = page[0] ? rawId(page[0]._id) : null
      hasNewerRef.current = false
      requestAnimationFrame(() => setInitialLoaded(true))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, db])

  // Command palette search results link to `#entry-<id>` — jump to it once
  // the initial page has rendered. Only searches the already-loaded page;
  // an older entry not yet paginated in simply won't be found (same
  // best-effort limitation OutlineAside's jumpTo already has).
  useEffect(() => {
    if (!initialLoaded) return
    const hash = window.location.hash
    if (!hash.startsWith('#entry-')) return
    const entryId = hash.slice('#entry-'.length)
    jumpToEntry(entryId).then(() =>
      requestAnimationFrame(() =>
        scrollRef.current?.querySelector(`[data-entry-id="${entryId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      )
    )
  }, [initialLoaded])

  // Shared by both the scroll-triggered pagination below and the
  // filter-active "load everything" effect further down — one place that
  // knows how to bring in the next older page, so neither path duplicates
  // the other's addToHistory/re-serialized-baseline handling.
  // Bookkeeping for entries just put into the editor: they exist in the DB,
  // and their saved baseline is what they re-serialize to (see the initial
  // load for why the raw stored content can't be used).
  const adoptDocs = useCallback(
    (docs: any[]) => {
      if (!editor) return
      for (const e of docs) {
        const rid = rawId(e._id)
        existsInDbRef.current.add(rid)
        if (e.updatedByName) lastAuthorRef.current.set(rid, { name: e.updatedByName, color: e.updatedByColor })
        const block = findBlock(rid)
        lastSavedRef.current.set(rid, block ? serializeBlockContent(editor, block.node) : e.content)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, findBlock]
  )

  // An entry leaving the editor (windowing, not deletion) must be forgotten
  // BEFORE its node is removed: flushBlocks deletes any entry it knows exists
  // but can't find in the doc.
  const forget = (rid: string) => {
    existsInDbRef.current.delete(rid)
    lastSavedRef.current.delete(rid)
    lastAuthorRef.current.delete(rid)
  }

  // Safe to drop from the editor: nothing unsaved and no save in flight.
  const isClean = (node: any) => {
    if (!editor) return false
    const rid = node.attrs.entryId
    if (!rid || saveInFlightRef.current.has(rid)) return false
    const edited = recentEditsRef.current.get(rid)
    if (edited && Date.now() - edited < RECENT_EDIT_MS) return false
    const html = serializeBlockContent(editor, node)
    return existsInDbRef.current.has(rid) ? lastSavedRef.current.get(rid) === html : html === '<p></p>'
  }

  // Keep the window at most MAX_WINDOW entries: drop offscreen, clean entries
  // from the far end (the side away from where the user is heading), keeping
  // the scroll position steady when the top end shrinks.
  const trimWindow = useCallback(
    (side: 'top' | 'bottom') => {
      const scroller = scrollRef.current
      if (!editor || !scroller) return
      const composerEnd = editor.state.doc.firstChild?.nodeSize ?? 0
      const entries: { pos: number; node: any }[] = []
      editor.state.doc.forEach((node: any, pos: number) => {
        if (pos >= composerEnd && node.attrs.entryId) entries.push({ pos, node })
      })
      if (entries.length <= MAX_WINDOW) return
      const excess = entries.length - (MAX_WINDOW - TRIM_SLACK)
      const view = scroller.getBoundingClientRect()
      const selFrom = editor.state.selection.from
      const drop: { pos: number; node: any }[] = []
      for (const e of side === 'top' ? entries : [...entries].reverse()) {
        if (drop.length >= excess) break
        const rect = (editor.view.nodeDOM(e.pos) as HTMLElement | null)?.getBoundingClientRect()
        const offscreen = !!rect && (side === 'top' ? rect.bottom < view.top - view.height : rect.top > view.bottom + view.height)
        const holdsSelection = selFrom >= e.pos && selFrom <= e.pos + e.node.nodeSize
        // Stop at the first entry that can't go, so the window stays contiguous.
        if (!offscreen || holdsSelection || !isClean(e.node)) break
        drop.push(e)
      }
      if (!drop.length) return
      const kept = side === 'top' ? entries[drop.length] : entries[entries.length - 1 - drop.length]
      const anchor = side === 'top' ? (editor.view.nodeDOM(kept.pos) as HTMLElement | null) : null
      const before = anchor?.getBoundingClientRect().top ?? 0
      const lo = Math.min(...drop.map((d) => d.pos))
      const hi = Math.max(...drop.map((d) => d.pos + d.node.nodeSize))
      drop.forEach((d) => forget(d.node.attrs.entryId))
      editor.view.dispatch(editor.state.tr.delete(lo, hi).setMeta('addToHistory', false))
      if (anchor) scroller.scrollTop += anchor.getBoundingClientRect().top - before
      if (side === 'top') {
        newestRidRef.current = kept.node.attrs.entryId
        hasNewerRef.current = true
      } else {
        oldestFullIdRef.current = fullId(kept.node.attrs.entryId)
        hasMoreRef.current = true
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor]
  )

  const loadOlderPageIntoEditor = useCallback(async () => {
    if (!editor) return
    if (loadingOlderRef.current || !hasMoreRef.current || !oldestFullIdRef.current) return

    loadingOlderRef.current = true
    try {
      const page = await fetchOlder(db, sourceRef.current, rawId(oldestFullIdRef.current), PAGE_SIZE)
      if (page.length > 0) {
        const html = page.map((e: any) => entryToBlockHtml(e, rawId(e._id))).join('')
        // addToHistory: false — loading isn't an edit (see the initial load).
        editor
          .chain()
          .insertContentAt(editor.state.doc.content.size, html, { updateSelection: false })
          .command(({ tr }: any) => {
            tr.setMeta('addToHistory', false)
            return true
          })
          .run()
        adoptDocs(page)
        oldestFullIdRef.current = page[page.length - 1]._id
        hasMoreRef.current = page.length === PAGE_SIZE
        trimWindow('top')
      } else {
        hasMoreRef.current = false
      }
    } finally {
      loadingOlderRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, db])

  // Newer pages (when the top of the window was trimmed and the user scrolls
  // back up): inserted under the composer, keeping the view where it was.
  const loadNewerPageIntoEditor = useCallback(async () => {
    const scroller = scrollRef.current
    if (!editor || !scroller || loadingNewerRef.current || !hasNewerRef.current || !newestRidRef.current) return
    loadingNewerRef.current = true
    try {
      const page = await fetchNewer(db, sourceRef.current, newestRidRef.current, PAGE_SIZE)
      if (!page.length) {
        hasNewerRef.current = false
        return
      }
      const composerEnd = editor.state.doc.firstChild?.nodeSize ?? 0
      const anchor = editor.view.nodeDOM(composerEnd) as HTMLElement | null
      const before = anchor?.getBoundingClientRect().top ?? 0
      const html = page.map((e: any) => entryToBlockHtml(e, rawId(e._id))).join('')
      editor
        .chain()
        .insertContentAt(composerEnd, html, { updateSelection: false })
        .command(({ tr }: any) => {
          tr.setMeta('addToHistory', false)
          return true
        })
        .run()
      if (anchor) scroller.scrollTop += anchor.getBoundingClientRect().top - before
      adoptDocs(page)
      newestRidRef.current = rawId(page[0]._id)
      hasNewerRef.current = page.length === PAGE_SIZE
      trimWindow('bottom')
    } finally {
      loadingNewerRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, db])

  // Swap the whole window (jumps, filter changes). Pending edits are saved
  // first; if anything is still unsaved (a failed save) the swap is refused
  // rather than dropping it.
  const replaceWindow = useCallback(
    async (docs: any[], hasNewer: boolean, hasOlder: boolean) => {
      if (!editor) return false
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      await flushBlocks()
      // New entries being written right under the composer (never saved,
      // newest by definition) stay put above the new window.
      let keepUntil = editor.state.doc.firstChild?.nodeSize ?? 0
      let leadingNew = true
      const leaving: string[] = []
      let dirty = false
      editor.state.doc.forEach((node: any, pos: number) => {
        if (pos < keepUntil || !node.attrs.entryId) return
        if (leadingNew && !existsInDbRef.current.has(node.attrs.entryId)) {
          keepUntil = pos + node.nodeSize
          return
        }
        leadingNew = false
        if (!isClean(node)) dirty = true
        leaving.push(node.attrs.entryId)
      })
      if (dirty) return false
      leaving.forEach(forget)
      const composerEnd = keepUntil
      const html = docs.map((e: any) => entryToBlockHtml(e, rawId(e._id))).join('')
      editor
        .chain()
        .command(({ tr }: any) => {
          tr.delete(composerEnd, tr.doc.content.size)
          tr.setMeta('addToHistory', false)
          return true
        })
        .run()
      if (html) {
        editor
          .chain()
          .insertContentAt(editor.state.doc.content.size, html, { updateSelection: false })
          .command(({ tr }: any) => {
            tr.setMeta('addToHistory', false)
            return true
          })
          .run()
      }
      adoptDocs(docs)
      newestRidRef.current = docs[0] ? rawId(docs[0]._id) : null
      hasNewerRef.current = hasNewer
      oldestFullIdRef.current = docs[docs.length - 1]?._id ?? null
      hasMoreRef.current = hasOlder
      return true
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, flushBlocks]
  )

  // Bring an entry into the window (search, quotes, scrubber, days, links):
  // already loaded, or swap in a window around it.
  const jumpToEntry = useCallback(
    async (rid: string) => {
      if (findBlock(rid)) return true
      const around = await fetchAround(db, sourceRef.current, rid, WINDOW_NEWER, WINDOW_OLDER)
      if (!around.docs.length) return false
      return replaceWindow(around.docs, around.hasNewer, around.hasOlder)
    },
    [db, findBlock, replaceWindow]
  )

  // Load older pages when the bottom sentinel scrolls into view — older
  // entries append at the end, which doesn't disturb the current scroll
  // position (unlike prepending at the top did in the old oldest-first order).
  useEffect(() => {
    const sentinel = sentinelRef.current
    const scrollEl = scrollRef.current
    if (!sentinel || !scrollEl || !editor || !initialLoaded) return

    const observer = new IntersectionObserver(
      (observerEntries) => {
        if (!observerEntries[0].isIntersecting) return
        loadOlderPageIntoEditor()
      },
      { root: scrollEl }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, db, initialLoaded])

  // Scrolling back up past a trimmed top: page newer entries back in.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || !initialLoaded) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (hasNewerRef.current && scroller.scrollTop < scroller.clientHeight * 1.5) loadNewerPageIntoEditor()
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [initialLoaded, loadNewerPageIntoEditor])

  // Every entry id in the drain (ids only), for the scrubber, the day
  // outline and filters. Kept current by the live-changes handler.
  const [indexReady, setIndexReady] = useState(false)
  useEffect(() => {
    let alive = true
    setIndexReady(false)
    db.allDocs({ startkey: 'entry:\uffff', endkey: 'entry:', descending: true })
      .then((res) => {
        if (!alive) return
        $entryIndex.set(res.rows.map((r) => r.id.slice(entryPrefix.length)))
        setIndexReady(true)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db])

  // What the feed pages through: every entry, or just a stream's / the
  // search's matches. Filtered views never load the whole drain; they page
  // through the matching ids like any other window.
  const filterKey = `${[...feedFilter.streams].sort().join(',')}|${feedFilter.onlyMatches ? feedFilter.query.trim() : ''}`
  const computeSource = useCallback(async (): Promise<EntrySource> => {
    const query = feedFilter.onlyMatches ? feedFilter.query.trim() : ''
    if (feedFilter.streams.size === 0 && !query) return { kind: 'all' }
    let ids = $entryIndex.get()
    if (feedFilter.streams.size) {
      const live = new Set($streams.get().map(slugOfStream))
      const links = $streamLinks.get()
      const f = { ...EMPTY_FILTER, streams: feedFilter.streams }
      ids = ids.filter((id) => isEntryVisible({}, links.get(id), live, f))
    }
    if (query) {
      const matches = new Set(await matchingIds(dbName, parseQuery(query)))
      ids = ids.filter((id) => matches.has(id))
    }
    return { kind: 'ids', ids }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, dbName])

  // Filter changed: rebuild the window from the new source, from the top.
  const appliedFilterRef = useRef('|')
  useEffect(() => {
    if (!editor || !initialLoaded || !indexReady) return
    if (appliedFilterRef.current === filterKey) return
    let cancelled = false
    ;(async () => {
      const source = await computeSource()
      if (cancelled) return
      appliedFilterRef.current = filterKey
      sourceRef.current = source
      $sourceIds.set(source.kind === 'ids' ? source.ids : null)
      const docs = await fetchLatest(db, source, INITIAL_PAGE_SIZE)
      if (cancelled) return
      if (await replaceWindow(docs, false, docs.length === INITIAL_PAGE_SIZE)) scrollRef.current?.scrollTo({ top: 0 })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, editor, initialLoaded, indexReady])

  // While filtered, keep the matching ids current as entries are filed or
  // created (no window reload; paging just follows the updated list).
  useEffect(() => {
    if (sourceRef.current.kind !== 'ids' || (feedFilter.onlyMatches && feedFilter.query.trim())) return
    computeSource().then((source) => {
      if (appliedFilterRef.current !== filterKey) return
      sourceRef.current = source
      $sourceIds.set(source.kind === 'ids' ? source.ids : null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamLinks, streams])

  // Starting a new entry while scrolled into older history: bring the
  // window back to the newest entries first, so the new one lands in order.
  useEffect(() => {
    if (!editor) return
    const onSelection = () => {
      if (!hasNewerRef.current) return
      const first = editor.state.doc.firstChild
      if (!first || editor.state.selection.from > first.nodeSize) return
      fetchLatest(db, sourceRef.current, INITIAL_PAGE_SIZE).then((docs) =>
        replaceWindow(docs, false, docs.length === INITIAL_PAGE_SIZE)
      )
    }
    editor.on('selectionUpdate', onSelection)
    return () => {
      editor.off('selectionUpdate', onSelection)
    }
  }, [editor, db, replaceWindow])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (handleChannelShortcut(e)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!editor) return
    const check = () => setHasEntries(editor.state.doc.childCount > 1)
    check()
    const onUpdate = ({ transaction }: { transaction: any }) => {
      if (!onlyEntryTextChanged(transaction.before, transaction.doc)) check()
    }
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
    }
  }, [editor])

  // Entry menus read comments from a store (the comments column is
  // desktop-only) and ask for "summarize this day" through one.
  useEffect(() => $comments.set(comments), [comments])
  const summarizeRequest = useStore($summarizeDayOf)
  useEffect(() => {
    if (!summarizeRequest || !editor) return
    $summarizeDayOf.set(null)
    const day = collectDays(editor.state.doc, hiddenIdsRef.current).find((d) => d.entryIds.includes(summarizeRequest))
    if (day) handleSummarize(day.key, day.entryIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summarizeRequest, editor])

  // Plain jumps (scrubber, day outline, quotes): bring the entry into the
  // window and scroll to it, without the search highlight.
  const jumpRequest = useStore($jumpTo)
  useEffect(() => {
    if (!jumpRequest || !editor || !initialLoaded) return
    $jumpTo.set(null)
    jumpToEntry(jumpRequest.entryId).then(() =>
      requestAnimationFrame(() =>
        editor.view.dom
          .querySelector(`p[data-entry-id="${jumpRequest.entryId}"]`)
          ?.scrollIntoView({ block: jumpRequest.block, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      )
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpRequest, editor, initialLoaded])

  // Search: highlight the query's words (while stepping through picked
  // results, or while "only matches" filters the feed) and bring the
  // current result into view — paging older entries in if it isn't loaded
  // yet, and leaving a channel that would hide it.
  useEffect(() => {
    if (!editor || !initialLoaded) return
    const query = searchJump?.query ?? (feedFilter.onlyMatches ? feedFilter.query : '')
    const target = searchJump ? searchJump.entryIds[searchJump.index] ?? null : null
    setSearchHighlight(editor, { terms: parseQuery(query).terms, activeEntryId: target })
    if (!target) return

    let cancelled = false
    ;(async () => {
      await jumpToEntry(target)
      if (cancelled) return
      // Not part of the filtered view: leave the filter, which rebuilds the
      // window from every entry; this effect then runs again.
      if (!findBlock(target) || hiddenIdsRef.current.has(target)) {
        if (isFilterActive($feedFilter.get())) $feedFilter.set({ ...EMPTY_FILTER })
        return
      }
      // A frame for the un-hide to render before measuring the scroll.
      requestAnimationFrame(() =>
        editor.view.dom
          .querySelector(`p[data-entry-id="${target}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      )
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, initialLoaded, searchJump, feedFilter.onlyMatches, feedFilter.query])

  // Live changes feed — patch just the affected block, never the whole doc.
  // Issue 2 fix: use update_seq captured after initial load so no gap.
  // Issue 3 fix: sequential processing with per-entry queue prevents races.
  // Issue 4 fix: always refresh authorship attrs, not just when content differs.
  useEffect(() => {
    if (!editor) return
    activeEntriesChanges?.cancel()
    const since = sinceSeqRef.current ?? 'now'
    // Index updates are batched per frame: the first sync of a big drain
    // streams thousands of changes, and one store update (plus an O(n) copy)
    // per change re-renders every subscriber thousands of times.
    const indexPending = new Map<string, boolean>()
    let indexFrame = 0
    const queueIndex = (rid: string, present: boolean) => {
      indexPending.set(rid, present)
      if (indexFrame) return
      indexFrame = requestAnimationFrame(() => {
        indexFrame = 0
        let ids = $entryIndex.get()
        for (const [id, has] of indexPending) ids = has ? withId(ids, id) : withoutId(ids, id)
        indexPending.clear()
        $entryIndex.set(ids)
      })
    }
    const changes = db
      .changes({ since, live: true, include_docs: true, conflicts: true })
      .on('change', async (change: any) => {
        if (!change.id.startsWith(entryPrefix)) return
        const rid = rawId(change.id)

        // Issue 3 fix: wait for any pending operation on this entry before
        // processing the next one. Sequential per-entry processing prevents
        // races from concurrent resolveConflicts calls for the same entry.
        while (changePendingRef.current.has(rid)) {
          await new Promise((r) => setTimeout(r, 20))
        }
        changePendingRef.current.add(rid)

        try {
          if (change.deleted) {
            notifyEntryChanged(dbName, rid, null)
            queueIndex(rid, false)
            const block = findBlock(rid)
            if (block) editor.commands.deleteRange({ from: block.pos, to: block.pos + block.node.nodeSize })
            existsInDbRef.current.delete(rid)
            lastSavedRef.current.delete(rid)
            lastAuthorRef.current.delete(rid)
            return
          }

          let doc = change.doc
          // Issue 3 fix: await resolveConflicts before proceeding
          if (doc._conflicts?.length) {
            doc = await resolveConflicts(db, change.id)
          }
          // Quotes of this entry anywhere on screen follow the change.
          notifyEntryChanged(dbName, rid, doc)
          queueIndex(rid, true)

          // Not in the editor and outside the window's newer end (trimmed
          // away above), or not part of the filtered view: nothing to patch.
          // Paging will bring it in. Must return before the bookkeeping
          // below marks it as existing, or flushBlocks would delete it.
          if (!findBlock(rid)) {
            const src = sourceRef.current
            const aboveWindow = hasNewerRef.current && !!newestRidRef.current && rid > newestRidRef.current
            const notInView = src.kind === 'ids' && src.ids[positionOf(src.ids, rid)] !== rid
            if (aboveWindow || notInView) return
          }

          // Issue 4 fix: always update authorship ref — even if content matches
          // (remote author could have changed the same text we wrote).
          // Echo guard: only skip if THIS client wrote it very recently (<2s ago).
          const savedContent = lastSavedRef.current.get(rid)
          const savedTime = savedContent ? Date.now() : 0
          const isOwnEcho = savedContent === doc.content && (Date.now() - savedTime) < 2000

          existsInDbRef.current.add(rid)
          lastSavedRef.current.set(rid, doc.content)
          if (doc.updatedByName) {
            lastAuthorRef.current.set(rid, { name: doc.updatedByName, color: doc.updatedByColor })
          }

          if (isOwnEcho) return

          const block = findBlock(rid)
          const innerHtml = innerOf(doc.content)
          const safeAuth = safeName(doc.updatedByName)
          const authorColor = safeColor(doc.updatedByColor)

          if (block) {
            const from = block.pos + 1
            const to = block.pos + block.node.nodeSize - 1
            // Was two separate editor.commands.X() calls before — each
            // dispatches its own transaction immediately, so the content
            // replacement itself was never actually excluded from undo
            // history, only the follow-up attr update was. Chained into
            // one transaction so addToHistory covers both — a remote edit
            // syncing into your view shouldn't be a step your own Ctrl+Z
            // can walk back through. (preventUpdate was tried and reverted
            // here too — see the initial-load effect's comment.)
            editor
              .chain()
              .insertContentAt({ from, to }, sanitizeHtml(innerHtml), { updateSelection: false })
              .command(({ tr }: any) => {
                tr.setNodeAttribute(block.pos, 'authorColor', authorColor)
                tr.setNodeAttribute(block.pos, 'authorName', safeAuth)
                tr.setNodeAttribute(block.pos, 'updatedAt', doc.updatedAt)
                tr.setNodeAttribute(block.pos, 'createdAt', doc.createdAt)
                tr.setNodeAttribute(block.pos, 'createdByName', safeName(doc.createdByName ?? doc.updatedByName))
                tr.setNodeAttribute(block.pos, 'createdByEmail', doc.createdByEmail ?? doc.updatedByEmail ?? null)
                tr.setMeta('addToHistory', false)
                return true
              })
              .run()
          } else {
            // Placed by _id, the same key the initial load and pagination
            // sort on (descending) — NOT always at the top. Most new entries
            // do have the newest id, but an AI summary of a past day is
            // minted just above that day's newest entry (createSummaryEntry),
            // so pinning it under the composer showed it above every newer
            // entry until a reload re-sorted it.
            const composerSize = editor.state.doc.firstChild?.nodeSize ?? 0
            // `as` keeps TS from narrowing to null (it can't see the
            // callback's reassignment — same issue SummaryGrouping.ts notes).
            let insertAt = null as number | null
            editor.state.doc.forEach((node: any, pos: number) => {
              if (insertAt !== null || pos < composerSize) return
              if (node.attrs.entryId && node.attrs.entryId < rid) insertAt = pos
            })
            if (insertAt === null) {
              // Older than everything loaded. If older pages remain,
              // pagination will bring it in — inserting now would duplicate
              // it then, and leaving it in existsInDbRef without a block
              // would make flushBlocks delete it as "removed". A full window
              // (first sync streaming a big drain in) counts as having more.
              const last = editor.state.doc.lastChild?.attrs.entryId
              if (!hasMoreRef.current && last && editor.state.doc.childCount > MAX_WINDOW) {
                hasMoreRef.current = true
                oldestFullIdRef.current = fullId(last)
              }
              if (hasMoreRef.current) {
                existsInDbRef.current.delete(rid)
                lastSavedRef.current.delete(rid)
                lastAuthorRef.current.delete(rid)
                return
              }
              insertAt = editor.state.doc.content.size
            }
            // Only auto-scroll if it landed at the top and the user was
            // already up there to see it.
            const shouldScroll = insertAt === composerSize && isNearTop(scrollRef.current)
            // Same addToHistory fix — a brand-new entry arriving from
            // another tab/user shouldn't be undoable from here either.
            editor
              .chain()
              .insertContentAt(insertAt, entryToBlockHtml(doc, rid), { updateSelection: false })
              .command(({ tr }: any) => {
                tr.setMeta('addToHistory', false)
                return true
              })
              .run()
            if (shouldScroll) scrollToTop()
            // Arrivals inside the window (first sync streams in out of
            // order) still have to respect its size.
            trimWindow('bottom')
          }

          // Overwrites the raw-content baseline set above (line ~485) with
          // what this node ACTUALLY re-serializes to now that it's really
          // in the editor — see the initial-load effect's comment for why:
          // content built server-side (GitHub ingestion, AI summaries, the
          // agent API) was never round-tripped through ProseMirror's own
          // DOMSerializer the way this client's own writes always are, so
          // comparing raw stored content against a freshly re-serialized
          // string is a real, demonstrated false-positive "changed"
          // detection — confirmed as the cause of a GitHub-authored entry
          // flipping to "edited by" the current viewer after only viewing
          // it, no edit ever made.
          const finalBlock = findBlock(rid)
          if (finalBlock) lastSavedRef.current.set(rid, serializeBlockContent(editor, finalBlock.node))
        } finally {
          changePendingRef.current.delete(rid)
        }
      })
    activeEntriesChanges = changes
    return () => {
      cancelAnimationFrame(indexFrame)
      changes.cancel()
      if (activeEntriesChanges === changes) activeEntriesChanges = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, db])

  // Comments live in their own docs (comment:<id>), separate from entries —
  // load the current set, then keep it live.
  useEffect(() => {
    let cancelled = false
    loadComments(db).then((initial) => {
      if (!cancelled) setComments(initial)
    })
    activeCommentsChanges?.cancel()
    const changes = watchComments(db, ({ id, deleted, doc }) => {
      setComments((prev) => {
        if (deleted) return prev.filter((c) => c._id !== id)
        if (!doc) return prev
        const idx = prev.findIndex((c) => c._id === id)
        if (idx === -1) return [...prev, doc]
        const next = [...prev]
        next[idx] = doc
        return next
      })
    })
    activeCommentsChanges = changes
    return () => {
      cancelled = true
      changes.cancel()
      if (activeCommentsChanges === changes) activeCommentsChanges = null
    }
  }, [db])

  // When the current filter was set. An entry YOU created after this moment
  // stays pinned (see the visibility effect below), so typing a new entry a
  // filter would otherwise hide doesn't make it vanish out from under you.
  // Keyed on author + createdAt rather than "wasn't in the doc when the
  // filter changed": older pages pulled in by load-all and other people's
  // synced entries also weren't in the doc yet, and must still be filtered.
  const filterSetAtRef = useRef(Date.now())
  useEffect(() => {
    filterSetAtRef.current = Date.now()
  }, [feedFilter])

  // Recomputes which top-level paragraphs the current filter hides and
  // hands the result to StreamFilter's decoration plugin. Runs on every
  // editor 'update' (so newly-typed/synced text/authors are reflected) and
  // whenever the streams/links/filter themselves change.
  useEffect(() => {
    if (!editor) return

    const recomputeVisibility = () => {
      if (!isFilterActive(feedFilter)) {
        if (setHiddenEntries(editor, new Set())) setHiddenIds(new Set())
        return
      }
      let shown = 0

      const liveSlugs = new Set(streams.map(slugOfStream))
      const bySlug = streamsBySlugOf(streams)
      const query = parseQuery(feedFilter.query)
      const searching = feedFilter.onlyMatches && !isEmptyQuery(query)
      const selectionEntryId = editor.state.selection.$from.parent.attrs?.entryId
      const myEmail = identityRef.current?.email?.toLowerCase()
      const hidden = new Set<string>()

      editor.state.doc.forEach((node: any) => {
        if (node.type.name !== 'paragraph' || !node.attrs.entryId) return
        const entryId = node.attrs.entryId
        const links = streamLinks.get(entryId)
        // Never hide the composer, the entry being edited, or one you just
        // wrote under this filter — otherwise new text vanishes mid-typing.
        const pinned =
          !!node.attrs.isComposer ||
          entryId === selectionEntryId ||
          (!!myEmail &&
            node.attrs.createdByEmail?.toLowerCase() === myEmail &&
            Number(node.attrs.createdAt) >= filterSetAtRef.current)
        const visible = isEntryVisible(
          {
            pinned,
            matches: searching ? matchesEntry(searchableOf(node, links, bySlug), query) : undefined,
          },
          links,
          liveSlugs,
          feedFilter
        )
        if (!visible) hidden.add(entryId)
        else if (!node.attrs.isComposer && node.attrs.source !== 'ai-summary') shown++
      })
      setVisibleCount(shown)

      // Only touch React state when the hidden set actually changed —
      // this runs on every keystroke via the 'update' listener.
      if (setHiddenEntries(editor, hidden)) setHiddenIds(hidden)
    }

    recomputeVisibility()
    // Typing inside an entry can't change who's visible unless the feed is
    // filtered by search text; skip the whole-drain pass in that case.
    const onUpdate = ({ transaction }: { transaction: any }) => {
      if (!feedFilter.onlyMatches && onlyEntryTextChanged(transaction.before, transaction.doc)) return
      recomputeVisibility()
    }
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
    }
  }, [editor, feedFilter, streams, streamLinks])

  // "The composer follows the view": while exactly one stream channel is open
  // (singleSelectedStream), a brand-new entry typed in the composer is auto-filed into it
  // the moment it has an entryId (AssignBlockId assigns one on the very
  // first keystroke, see its appendTransaction). inheritedRef is just to
  // avoid re-issuing the same (idempotent) linkEntry call on every
  // keystroke — linkEntry itself already no-ops a repeat link via its own
  // 409 handling either way.
  const inheritedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!editor) return
    const slug = singleSelectedStream(feedFilter)
    if (!slug || !streams.some((s) => slugOfStream(s) === slug)) return

    const maybeInherit = () => {
      const first = editor.state.doc.firstChild
      // Only once something is typed: filing the empty composer left a link
      // to an entry that never got written, inflating the stream's count.
      if (!first || !first.attrs.isComposer || !first.attrs.entryId || first.content.size === 0) return
      const entryId = first.attrs.entryId
      if (inheritedRef.current.has(entryId)) return
      inheritedRef.current.add(entryId)
      const identity = identityRef.current
      if (identity) linkEntry(db, entryId, slug, identity)
    }

    maybeInherit()
    editor.on('update', maybeInherit)
    return () => {
      editor.off('update', maybeInherit)
    }
  }, [editor, streams, feedFilter, db])

  // Applying/removing the comment mark is a normal doc edit — it rides the
  // existing onUpdate -> scheduleSave -> flushBlocks path, so no separate
  // save call is needed here or in handleDeleteComment below.
  const handleAddComment = useCallback(
    (text: string) => {
      if (!editor) return
      const identity = identityRef.current
      if (!identity) return
      const { from, to } = editor.state.selection
      if (from === to) return
      const entryId = editor.state.doc.resolve(from).parent.attrs.entryId
      if (!entryId) return

      const commentId = ulid()
      editor.chain().setMark('comment', { commentId }).setTextSelection(to).run()
      createComment(db, entryId, commentId, text, identity)
    },
    [editor, db]
  )

  const handleDeleteComment = useCallback(
    (comment: CommentDoc) => {
      if (!editor) return
      const markType = editor.schema.marks.comment
      const ranges: { from: number; to: number }[] = []
      editor.state.doc.descendants((node: any, pos: number) => {
        if (!node.isText) return
        if (node.marks.some((m: any) => m.type.name === 'comment' && m.attrs.commentId === comment.commentId)) {
          ranges.push({ from: pos, to: pos + node.nodeSize })
        }
      })
      if (ranges.length) {
        editor
          .chain()
          .command(({ tr }: any) => {
            ranges.forEach(({ from, to }) => tr.removeMark(from, to, markType))
            return true
          })
          .run()
      }
      deleteComment(db, comment._id)
      setComments((prev) => prev.filter((c) => c._id !== comment._id))
    },
    [editor, db]
  )

  const handleContainerClick = (e: React.MouseEvent) => {
    // Blank space jumps to the composer at the top, not the oldest entry.
    if (e.target === e.currentTarget) editor?.chain().focus('start').run()
  }

  // Stable identity so the memoized sidebar doesn't re-render on every save.
  const handleSummarize = useCallback(async (key: string, entryIds: string[]) => {
    setSummarizingKey(key)
    setSummarizeError(null)
    // entryIds come in doc order, so [0] is the day's topmost entry — the
    // one the summary lands directly above.
    const hideSkeleton = editor && entryIds[0] ? showSummarySkeleton(editor, entryIds[0]) : null
    try {
      await summarizeEntries(dbName, entryIds)
    } catch (err: any) {
      // Nothing was optimistically inserted into the doc, so there's
      // nothing to undo — but the user still needs to know why (e.g. the
      // daily AI limit was reached), not just watch the skeleton vanish.
      setSummarizeError(err?.message || 'Failed to summarize')
    } finally {
      hideSkeleton?.()
      setSummarizingKey(null)
    }
  }, [editor, dbName])

  // Same skeleton before the first page loads and during a drain's first sync
  // to this device (until an entry arrives or sync settles), so the page
  // never switches between two loading looks.
  const showSkeleton = !initialLoaded || (firstSync && !hasEntries)

  if (!identity) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {saveState !== 'idle' && (
        <div className="absolute top-4 right-32 z-30 rounded-full border bg-background/80 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Saved'}
          {saveState === 'error' && <span className="text-destructive">Couldn't save</span>}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 lg:h-16"
          style={{ background: 'linear-gradient(to bottom, var(--background), transparent)' }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8"
          style={{ background: 'linear-gradient(to top, var(--background), transparent)' }}
        />
        <StreamBar />
        {editor && initialLoaded && <DateScrubber editor={editor} />}
        {editor && <EditorToolbar editor={editor} anchorRef={editorColumnRef} />}
        {/* The channel sidebar is its own column OUTSIDE the scroller. Inside
            it (as a sticky child) its resting spot depended on the feed's
            scroll state and height, so it sat 64px lower on drains with
            entries than on empty ones. Out here only the entries scroll. */}
        <div className="flex h-full gap-4 pl-2">
          {editor && (
            <OutlineAside
              editor={editor}
              dbName={dbName}
              summarizingKey={summarizingKey}
              onSummarize={handleSummarize}
            />
          )}
        {/* lg:pl-3: the AI-summary thread bar sits 10px left of each card
            (EntryBlockView), and a scroll box clips anything outside it. On
            phones only the cards in a summary thread indent for it instead,
            so every other entry gets the full width. */}
        <div ref={scrollRef} data-feed-scroller className="feed-scroll h-full min-w-0 flex-1 overflow-y-auto [overflow-anchor:none] pt-24 pr-2 pb-16 lg:pl-3 lg:pt-16 [@media(pointer:fine)]:pr-9">
          <div className="flex gap-4">
            <div ref={editorColumnRef} className="min-w-0 flex-1">
              {summarizeError && (
                <div className="mb-1.5 flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {summarizeError}
                  <button type="button" className="shrink-0 text-xs underline" onClick={() => setSummarizeError(null)}>
                    Dismiss
                  </button>
                </div>
              )}
              <SearchPill />
              <SyncBanner dbName={dbName} />
              {initialLoaded && isFilterActive(feedFilter) && (
                <ChannelHeader count={visibleCount} loadingMore={hasMoreRef.current} />
              )}
              {showSkeleton && (
                <div className="flex flex-col gap-1.5" aria-busy="true" aria-label="Loading entries">
                  {SKELETON_ENTRY_WIDTHS.map((width, i) => (
                    <div key={i} className="rounded-lg border border-border bg-card p-2.5">
                      <Skeleton className={`h-4 ${width}`} />
                    </div>
                  ))}
                </div>
              )}
              <div className={showSkeleton ? 'hidden' : 'min-h-full'} onClick={handleContainerClick}>
                <EditorContent editor={editor} />
              </div>
              <div ref={sentinelRef} />
            </div>
            {editor && <CommentsAside editor={editor} comments={comments} onDelete={handleDeleteComment} />}
          </div>
        </div>
        </div>
      </div>
      {editor && <AddCommentPopover editor={editor} onSubmit={handleAddComment} />}
    </div>
  )
}

// Serializes just this block's inline content back into the plain
// `<p>...</p>` shape stored in the entry doc — strips the author/time meta
// spans so only user text is saved.
function serializeBlockContent(editor: any, node: any) {
  const serializer = DOMSerializer.fromSchema(editor.schema)
  const frag = serializer.serializeFragment(node.content)
  const wrapper = document.createElement('div')
  wrapper.appendChild(frag)

  // Remove meta + content wrapper spans before saving
  wrapper.querySelectorAll('.entry-meta, .entry-dot, .entry-author, .entry-sep, .entry-time, .entry-content').forEach((el) => el.remove())

  return `<p>${wrapper.innerHTML}</p>`
}

// Extract just the user text content from a stored entry, stripping meta.
function innerOf(pHtml: string) {
  const div = document.createElement('div')
  div.innerHTML = pHtml || '<p></p>'
  div.querySelectorAll('.entry-meta, .entry-dot, .entry-author, .entry-sep, .entry-time, .entry-content').forEach((el) => el.remove())
  const p = div.firstElementChild as HTMLElement | null
  return p ? p.innerHTML : ''
}

function isNearTop(el: HTMLElement | null, threshold = 120) {
  if (!el) return true
  return el.scrollTop < threshold
}

// Sits above the composer whenever the feed is narrowed: names the channel
// (or combination), counts what's shown, and offers the way back to All.
// When nothing matches it doubles as the empty state.
function ChannelHeader({ count, loadingMore }: { count: number; loadingMore: boolean }) {
  const filter = useStore($feedFilter)
  const streams = useStore($streams)

  const selected = streams.filter((s) => filter.streams.has(slugOfStream(s)))
  const single = selected.length === 1 && filter.streams.size === 1 ? selected[0] : null
  const extras: string[] = []
  if (filter.onlyMatches && filter.query.trim()) extras.push(`matching "${filter.query.trim()}"`)

  return (
    <div className="mb-3 px-1">
      <div className="flex items-center gap-2">
        <h2 className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-lg font-semibold tracking-tight">
          {selected.map((s) => (
            <span key={s._id} className="truncate">
              <span style={{ color: s.color }}>#</span>
              {s.name}
            </span>
          ))}
          {filter.streams.has(UNSORTED) && <span>Unsorted</span>}
          {filter.streams.size === 0 && <span>All entries</span>}
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {count} {count === 1 ? 'entry' : 'entries'}
          {extras.length > 0 && ` · ${extras.join(' · ')}`}
        </span>
        <button
          type="button"
          title="Back to all entries"
          onClick={() => $feedFilter.set(EMPTY_FILTER)}
          className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
          All entries
        </button>
      </div>
      {count === 0 && !loadingMore && (
        <p className="mt-1 text-sm text-muted-foreground">
          {single
            ? `Nothing in #${single.name} yet. Write above and it's filed here, or type # in any entry.`
            : 'No entries match.'}
        </p>
      )}
    </div>
  )
}
