import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const key = new PluginKey('summarySkeleton')

// Loading placeholder rendered inside the feed at the spot the summary will
// land: directly above the day's topmost entry, which is the entry
// createSummaryEntry anchors the summary's id to. A widget decoration rather
// than React markup outside the editor, so it sits between real entries and
// follows that entry if the doc shifts while the request is in flight.
// Returns the cleanup that removes it.
export function showSummarySkeleton(editor: Editor, anchorEntryId: string): () => void {
  const el = document.createElement('div')
  el.contentEditable = 'false'
  el.className =
    'mb-1.5 flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-500/10'
  // Same markup as lucide's Loader2 icon — static DOM, so no React here.
  el.innerHTML =
    '<svg class="size-3.5 shrink-0 animate-spin text-violet-500 dark:text-violet-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>' +
    '<div class="flex-1 space-y-1.5"><div class="ai-shimmer h-2.5 w-3/4 rounded-full"></div><div class="ai-shimmer h-2.5 w-1/2 rounded-full"></div></div>'

  editor.registerPlugin(
    new Plugin({
      key,
      props: {
        decorations: (state) => {
          // `as` keeps TS from narrowing to null (it can't see the
          // callback's reassignment — same issue SummaryGrouping.ts notes).
          let at = null as number | null
          state.doc.forEach((node, pos) => {
            if (at === null && node.attrs.entryId === anchorEntryId) at = pos
          })
          if (at === null) return DecorationSet.empty
          return DecorationSet.create(state.doc, [Decoration.widget(at, el, { side: -1, key: 'summary-skeleton' })])
        },
      },
    })
  )
  // The day being summarized is often scrolled out of view (picked from the
  // outline), so bring the placeholder to where the user is looking.
  requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))

  return () => {
    if (!editor.isDestroyed) editor.unregisterPlugin(key)
  }
}
