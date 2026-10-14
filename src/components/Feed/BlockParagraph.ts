import Paragraph from '@tiptap/extension-paragraph'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { EntryBlockView } from './EntryBlockView'

// Every top-level paragraph IS a block/entry. entryId is the stable link
// back to its `entry:<entryId>` PouchDB doc (in this drain's own database)
// — null means the block hasn't been assigned one yet (see AssignBlockId).
//
// Rendered via a React NodeView (EntryBlockView) so the entry can host a
// real shadcn Popover for author/history details — once a NodeView is
// registered, ProseMirror no longer uses renderHTML to build the live DOM,
// only parseHTML (reading these attrs back out of stored/pasted HTML).
export const BlockParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      entryId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-entry-id'),
        renderHTML: (attrs: any) => (attrs.entryId ? { 'data-entry-id': attrs.entryId } : {}),
      },
      authorColor: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-author-color'),
        renderHTML: (attrs: any) =>
          attrs.authorColor ? { 'data-author-color': attrs.authorColor } : {},
      },
      authorName: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-author-name'),
        renderHTML: (attrs: any) =>
          attrs.authorName ? { 'data-author-name': attrs.authorName } : {},
      },
      updatedAt: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-updated-at'),
        renderHTML: (attrs: any) =>
          attrs.updatedAt ? { 'data-updated-at': attrs.updatedAt } : {},
      },
      createdAt: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-created-at'),
        renderHTML: (attrs: any) =>
          attrs.createdAt ? { 'data-created-at': attrs.createdAt } : {},
      },
      createdByName: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-created-by'),
        renderHTML: (attrs: any) =>
          attrs.createdByName ? { 'data-created-by': attrs.createdByName } : {},
      },
      // Streams' author filter (authorKeyOf in feedFilter.ts) keys human
      // authors off this, not the display name — names collide, emails don't.
      createdByEmail: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-created-by-email'),
        renderHTML: (attrs: any) =>
          attrs.createdByEmail ? { 'data-created-by-email': attrs.createdByEmail } : {},
      },
      // Set only for entries created by an integration (e.g. GitHub webhook
      // ingestion, see api/ingest/[token].ts) — distinguishes bot-authored
      // entries from ones a person typed, so EntryBlockView can render a
      // different badge instead of the usual colored-dot author indicator.
      source: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-source'),
        renderHTML: (attrs: any) => (attrs.source ? { 'data-source': attrs.source } : {}),
      },
      // Set only for entries created/edited via the agent API
      // (api/drains/[dbName]/entries*) with the token's name — this is
      // still a real person's entry (unlike source: 'github'/'ai-summary'),
      // just agent-mediated, so it's a small badge alongside the normal
      // author info rather than a replacement for it.
      viaToken: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-via-token'),
        renderHTML: (attrs: any) => (attrs.viaToken ? { 'data-via-token': attrs.viaToken } : {}),
      },
      // Set only on a summary entry (source: 'ai-summary') — the entry ids
      // it was generated from. SummaryGrouping.ts scans the doc for these
      // to derive claimedBySummary on the entries themselves.
      summarizedEntryIds: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const raw = el.getAttribute('data-summarized-ids')
          return raw ? raw.split(',') : null
        },
        renderHTML: (attrs: any) =>
          attrs.summarizedEntryIds?.length ? { 'data-summarized-ids': attrs.summarizedEntryIds.join(',') } : {},
      },
      // Derived, not stored — true when some visible summary entry's
      // summarizedEntryIds claims this entry (see SummaryGrouping.ts).
      // Recomputed on every relevant transaction, so deleting the summary
      // naturally reverts this back to false on its next scan.
      claimedBySummary: {
        default: false,
        parseHTML: () => false,
        renderHTML: () => ({}),
      },
      // Derived alongside claimedBySummary — true for a summary entry
      // whose immediately-preceding sibling is ALSO a summary (re-
      // summarizing the same day without deleting the old one first stacks
      // a second summary node). Treated like a claimed entry for chain
      // purposes — no badge of its own, blends into the same bar/margin as
      // the root summary above it.
      isNestedSummary: {
        default: false,
        parseHTML: () => false,
        renderHTML: () => ({}),
      },
      // Derived alongside claimedBySummary — true for whichever claimed
      // entry has a non-claimed (or no) paragraph right after it, i.e. the
      // one that closes the visual "rim" wrapping the group.
      isLastInGroup: {
        default: false,
        parseHTML: () => false,
        renderHTML: () => ({}),
      },
      // Explicitly managed by ensureLeadingComposer in Feed/index.tsx —
      // distinguishes "the one pinned composer slot at the top" from any
      // other paragraph that happens to be empty (e.g. a real entry edited
      // down to nothing), which should render as a plain blank entry, not
      // the composer's dashed-border placeholder look.
      isComposer: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(EntryBlockView)
  },

  // Plain Enter always jumps back to the composer slot at the top
  // (Slack-message-box style) — newest-first order means "continue below"
  // doesn't make sense as the default. Detecting "am I currently in the
  // composer" to decide this conditionally doesn't work: ensureLeadingComposer
  // (Feed/index.tsx) moves the isComposer flag away the moment you type the
  // first character, so by the time Enter is pressed you're never actually
  // in the flagged node anymore. Mod-Shift-Enter is the explicit escape
  // hatch for the other case — splitting an older, already-positioned entry
  // into two in place. AssignBlockId's duplicate-id handling gives the
  // split-off half an id sorted right below the original's (idBefore)
  // instead of "now", so newest-first reload order matches what splitting
  // in place looked like.
  addKeyboardShortcuts() {
    return {
      // A @mention or [[reference popup is open — let its own Enter
      // handling (select the highlighted item) run instead of jumping to
      // the composer. Extension registration order makes this plugin's
      // keymap run before the suggestion plugins' handleKeyDown, so without
      // this check Enter would always jump to composer instead of ever
      // reaching the popup, confirmed directly (see MentionExtension.ts /
      // ReferenceExtension.ts, whose popups both set data-suggestion-popup).
      Enter: () => {
        if (document.querySelector('[data-suggestion-popup]')) return false
        this.editor.commands.focus(1)
        return true
      },
      'Mod-Shift-Enter': () => this.editor.commands.splitBlock(),
    }
  },
})
