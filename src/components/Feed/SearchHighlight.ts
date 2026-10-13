import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/core'
import { matchRanges, type SearchableEntry } from './search'
import { authorKeyOf, liveLinksOf } from './feedFilter'
import { slugOfStream, type StreamDoc } from '@/services/streams'

interface HighlightState {
  terms: string[]
  activeEntryId: string | null
}

export const searchHighlightKey = new PluginKey<HighlightState>('searchHighlight')

// An entry's searchable text plus, for each character, its offset inside
// the paragraph — mentions/references are atoms with no text, so text
// offsets and document positions drift apart without this map.
export function entryText(node: PMNode): { text: string; offsets: number[] } {
  let text = ''
  const offsets: number[] = []
  node.descendants((child, pos) => {
    if (!child.isText || !child.text) return
    for (let i = 0; i < child.text.length; i++) offsets.push(pos + i)
    text += child.text
  })
  return { text, offsets }
}

// Struck-through text is how people mark an entry done, so a fully struck
// entry counts as done for `is:done`.
function isDone(node: PMNode): boolean {
  let sawText = false
  let allStruck = true
  node.descendants((child) => {
    if (!child.isText || !child.text?.trim()) return
    sawText = true
    if (!child.marks.some((m) => m.type.name === 'strike')) allStruck = false
  })
  return sawText && allStruck
}

export function searchableOf(
  node: PMNode,
  links: Set<string> | undefined,
  streamsBySlug: Map<string, StreamDoc>
): SearchableEntry {
  const live = liveLinksOf(links, new Set(streamsBySlug.keys()))
  return {
    text: entryText(node).text,
    streams: live.flatMap((slug) => [slug, streamsBySlug.get(slug)!.name.toLowerCase()]),
    authorName: node.attrs.createdByName ?? '',
    authorKey: authorKeyOf(node.attrs),
    source: node.attrs.source,
    viaToken: node.attrs.viaToken,
    done: isDone(node),
  }
}

export function streamsBySlugOf(streams: StreamDoc[]): Map<string, StreamDoc> {
  return new Map(streams.map((s) => [slugOfStream(s), s]))
}

export function setSearchHighlight(editor: Editor, state: HighlightState) {
  const tr = editor.state.tr.setMeta(searchHighlightKey, state).setMeta('addToHistory', false)
  editor.view.dispatch(tr)
}

// Highlights search terms in the feed and rings the entry the find bar is
// currently on. Decorations only, so nothing here can touch saved content.
export const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<HighlightState>({
        key: searchHighlightKey,
        state: {
          init: () => ({ terms: [], activeEntryId: null }),
          apply: (tr, value) => tr.getMeta(searchHighlightKey) ?? value,
        },
        props: {
          decorations(state) {
            const { terms, activeEntryId } = searchHighlightKey.getState(state) ?? { terms: [], activeEntryId: null }
            if (!terms.length && !activeEntryId) return DecorationSet.empty
            const decorations: Decoration[] = []
            state.doc.forEach((node, pos) => {
              if (node.type.name !== 'paragraph' || !node.attrs.entryId) return
              if (node.attrs.entryId === activeEntryId) {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'search-active' }))
              }
              if (!terms.length) return
              const { text, offsets } = entryText(node)
              for (const r of matchRanges(text, terms)) {
                // +1 steps inside the paragraph; each char maps on its own,
                // so a hit spanning two marks (bold + plain) still lines up.
                const from = pos + 1 + offsets[r.from]
                const to = pos + 1 + offsets[r.to - 1] + 1
                decorations.push(Decoration.inline(from, to, { class: 'search-hit' }))
              }
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
