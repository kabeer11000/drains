import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { DOMSerializer } from '@tiptap/pm/model'
import { ulid } from 'ulid'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2 } from 'lucide-react'
import { getDrainDb } from '@/services/db'
import { $identity } from '@/services/identity'
import { loadLatestPage, loadOlderPage } from '@/utils/ulid-pages'
import { createEntry, saveEntry, deleteEntry, resolveConflicts, type EntryIdentity } from '@/services/entries'
import { loadComments, watchComments, createComment, deleteComment, type CommentDoc } from '@/services/comments'
import { summarizeEntries } from '@/services/aiApi'
// @ts-ignore - plain JS module
import { sanitizeHtml } from '@/services/sanitize'
import { BlockParagraph } from './BlockParagraph'
import { AssignBlockId } from './AssignBlockId'
import { SummaryGrouping } from './SummaryGrouping'
import { CommentMark } from './CommentMark'
import { createMentionExtension } from './MentionExtension'
import { ReferenceExtension } from './ReferenceExtension'
import { CommentsAside } from './CommentsAside'
import { OutlineAside } from './OutlineAside'
import { AddCommentPopover } from './AddCommentPopover'
import { EditorToolbar } from './EditorToolbar'
import { safeName, safeColor } from './utils'

const PAGE_SIZE = 50
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

  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const editorColumnRef = useRef<HTMLDivElement>(null)
  const identityRef = useRef<EntryIdentity>(identity)
  const oldestFullIdRef = useRef<string | null>(null)
  const hasMoreRef = useRef(true)
  const loadingOlderRef = useRef(false)
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
      createMentionExtension(dbName),
      ReferenceExtension,
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
            })
            .finally(() => saveInFlightRef.current.delete(rid))
        )
      }
    })

    for (const rid of existsInDbRef.current) {
      if (!currentIds.has(rid)) {
        ops.push(
          deleteEntry(db, fullId(rid)).then(() => {
            existsInDbRef.current.delete(rid)
            lastSavedRef.current.delete(rid)
            lastAuthorRef.current.delete(rid)
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

    Promise.all([loadLatestPage(db, PAGE_SIZE), db.info()]).then(([page, info]) => {
      if (cancelled) return
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
      hasMoreRef.current = page.length === PAGE_SIZE
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
    scrollRef.current
      ?.querySelector(`[data-entry-id="${entryId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [initialLoaded])

  // Load older pages when the bottom sentinel scrolls into view — older
  // entries append at the end, which doesn't disturb the current scroll
  // position (unlike prepending at the top did in the old oldest-first order).
  useEffect(() => {
    const sentinel = sentinelRef.current
    const scrollEl = scrollRef.current
    if (!sentinel || !scrollEl || !editor || !initialLoaded) return

    const observer = new IntersectionObserver(
      async (observerEntries) => {
        if (!observerEntries[0].isIntersecting) return
        if (loadingOlderRef.current || !hasMoreRef.current || !oldestFullIdRef.current) return

        loadingOlderRef.current = true
        const page = await loadOlderPage(db, oldestFullIdRef.current, PAGE_SIZE)

        if (page.length > 0) {
          const html = page.map((e: any) => entryToBlockHtml(e, rawId(e._id))).join('')
          // Same addToHistory + re-serialized-baseline fixes as the
          // initial load above (see that comment for why preventUpdate
          // isn't used here — it broke ensureLeadingComposer).
          editor
            .chain()
            .insertContentAt(editor.state.doc.content.size, html, { updateSelection: false })
            .command(({ tr }: any) => {
              tr.setMeta('addToHistory', false)
              return true
            })
            .run()
          page.forEach((e: any) => {
            const rid = rawId(e._id)
            existsInDbRef.current.add(rid)
            if (e.updatedByName) lastAuthorRef.current.set(rid, { name: e.updatedByName, color: e.updatedByColor })
          })
          page.forEach((e: any) => {
            const rid = rawId(e._id)
            const block = findBlock(rid)
            lastSavedRef.current.set(rid, block ? serializeBlockContent(editor, block.node) : e.content)
          })
          oldestFullIdRef.current = page[page.length - 1]._id
        } else {
          // Issue 7 fix: anchor was deleted, stop pagination gracefully
          hasMoreRef.current = false
        }
        loadingOlderRef.current = false
      },
      { root: scrollEl }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, db, initialLoaded])

  // Live changes feed — patch just the affected block, never the whole doc.
  // Issue 2 fix: use update_seq captured after initial load so no gap.
  // Issue 3 fix: sequential processing with per-entry queue prevents races.
  // Issue 4 fix: always refresh authorship attrs, not just when content differs.
  useEffect(() => {
    if (!editor) return
    activeEntriesChanges?.cancel()
    const since = sinceSeqRef.current ?? 'now'
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
              // would make flushBlocks delete it as "removed".
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

  const handleSummarize = async (key: string, entryIds: string[]) => {
    setSummarizingKey(key)
    setSummarizeError(null)
    try {
      await summarizeEntries(dbName, entryIds)
    } catch (err: any) {
      // Nothing was optimistically inserted into the doc, so there's
      // nothing to undo — but the user still needs to know why (e.g. the
      // daily AI limit was reached), not just watch the skeleton vanish.
      setSummarizeError(err?.message || 'Failed to summarize')
    } finally {
      setSummarizingKey(null)
    }
  }

  if (!identity) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {saveState !== 'idle' && (
        <div className="absolute top-4 right-32 z-50 rounded-full border bg-background/80 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Saved'}
          {saveState === 'error' && <span className="text-destructive">Couldn't save</span>}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16"
          style={{ background: 'linear-gradient(to bottom, var(--background), transparent)' }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8"
          style={{ background: 'linear-gradient(to top, var(--background), transparent)' }}
        />
        {editor && <EditorToolbar editor={editor} anchorRef={editorColumnRef} />}
        <div ref={scrollRef} className="feed-scroll h-full overflow-y-auto px-2 pt-16 pb-16">
        <div className="flex gap-4">
          {editor && (
            <OutlineAside editor={editor} summarizingKey={summarizingKey} onSummarize={handleSummarize} />
          )}
          <div ref={editorColumnRef} className="min-w-0 flex-1">
            {summarizingKey && (
              <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-500/10">
                <Loader2 className="size-3.5 shrink-0 animate-spin text-violet-500 dark:text-violet-400" />
                <div className="flex-1 space-y-1.5">
                  <div className="ai-shimmer h-2.5 w-3/4 rounded-full" />
                  <div className="ai-shimmer h-2.5 w-1/2 rounded-full" />
                </div>
              </div>
            )}
            {summarizeError && (
              <div className="mb-1.5 flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {summarizeError}
                <button type="button" className="shrink-0 text-xs underline" onClick={() => setSummarizeError(null)}>
                  Dismiss
                </button>
              </div>
            )}
            {!initialLoaded && (
              <div className="flex flex-col gap-1.5">
                {SKELETON_ENTRY_WIDTHS.map((width, i) => (
                  <div key={i} className="rounded-lg border border-border bg-card p-2.5">
                    <Skeleton className={`h-4 ${width}`} />
                  </div>
                ))}
              </div>
            )}
            <div className={initialLoaded ? 'min-h-full' : 'hidden'} onClick={handleContainerClick}>
              <EditorContent editor={editor} />
            </div>
            <div ref={sentinelRef} />
          </div>
          {editor && <CommentsAside editor={editor} comments={comments} onDelete={handleDeleteComment} />}
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
