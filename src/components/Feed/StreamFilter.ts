import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { onlyEntryTextChanged } from './docDiff'
import type { Step } from '@tiptap/pm/transform'
import type { Editor } from '@tiptap/core'

interface FilterState {
  hidden: Set<string>
  decorations: DecorationSet
}

export const streamFilterKey = new PluginKey<FilterState>('streamFilter')

function buildDecorations(doc: PMNode, hidden: Set<string>): DecorationSet {
  if (hidden.size === 0) return DecorationSet.empty
  return DecorationSet.create(
    doc,
    hiddenRangesInDoc(doc, hidden).map(({ from, to }) =>
      Decoration.node(from, to, { style: 'display:none', 'data-stream-hidden': 'true' })
    )
  )
}

export interface Range {
  from: number
  to: number
}

// Closed-interval overlap — touching at a shared endpoint counts as
// overlap, not just strictly interleaving ranges. A join step's old-range
// can sit exactly at a hidden node's boundary (joinBackward/joinForward,
// ReplaceAroundStep) rather than dipping into its content by a full
// position, and that boundary-adjacent case must still count as "touches
// the hidden node," not "just past it."
export function rangesOverlap(a: Range, b: Range): boolean {
  return a.from <= b.to && a.to >= b.from
}

// Every top-level paragraph whose entryId is in `hidden`, as a [from, to)
// range in `doc`'s own coordinates.
export function hiddenRangesInDoc(doc: PMNode, hidden: Set<string>): Range[] {
  if (hidden.size === 0) return []
  const ranges: Range[] = []
  doc.forEach((node, pos) => {
    if (node.type.name === 'paragraph' && node.attrs.entryId && hidden.has(node.attrs.entryId)) {
      ranges.push({ from: pos, to: pos + node.nodeSize })
    }
  })
  return ranges
}

// Does this transaction's steps touch any of `hiddenRanges`? Ranges are
// given in tr.before's coordinates; as each step is walked, they're carried
// forward through that step's own StepMap so a later step in a multi-step
// transaction is still checked against the right (that step's "before")
// coordinates, not the original doc's.
export function stepsTouchHidden(steps: readonly Step[], hiddenRanges: Range[]): boolean {
  if (hiddenRanges.length === 0) return false
  let ranges = hiddenRanges
  for (const step of steps) {
    const map = step.getMap()
    let touched = false
    map.forEach((oldStart, oldEnd) => {
      if (touched) return
      if (ranges.some((r) => rangesOverlap({ from: oldStart, to: oldEnd }, r))) touched = true
    })
    if (touched) return true
    ranges = ranges.map((r) => ({ from: map.map(r.from, -1), to: map.map(r.to, 1) }))
  }
  return false
}

// Publishes a new hidden-entryId set to the plugin (skips the dispatch
// entirely if it's unchanged, so toggling doesn't re-fire 'update' for
// nothing). If the current selection sits inside a paragraph that's about
// to become hidden, moves it to pos 1 (inside the always-visible composer)
// in the SAME transaction, so hiding your own cursor's entry doesn't leave
// you typing into an invisible block.
export function setHiddenEntries(editor: Editor, hidden: Set<string>): boolean {
  const { state } = editor
  const current = streamFilterKey.getState(state)?.hidden ?? new Set<string>()
  const same = current.size === hidden.size && [...current].every((id) => hidden.has(id))
  if (same) return false

  const tr = state.tr
  tr.setMeta(streamFilterKey, { hidden })
  tr.setMeta('addToHistory', false)

  const $from = state.selection.$from
  const selectedEntryId = $from.parent.attrs?.entryId
  if (selectedEntryId && hidden.has(selectedEntryId)) {
    tr.setSelection(TextSelection.create(tr.doc, 1))
  }

  editor.view.dispatch(tr)
  return true
}

// Hides filtered-out entries via decorations (display:none), never by
// removing nodes — Feed/index.tsx's flushBlocks treats a removed top-level
// paragraph as a deleted entry (see its diff loop), so decorations are the
// only safe way to hide something without actually deleting it.
export const StreamFilter = Extension.create({
  name: 'streamFilter',

  addProseMirrorPlugins() {
    return [
      new Plugin<FilterState>({
        key: streamFilterKey,
        // Decorations live in plugin state: built when the hidden set changes,
        // mapped through ordinary typing, rebuilt only when entries are added,
        // removed or replaced. (Building them in the decorations prop walked
        // the whole doc on every redraw.)
        state: {
          init: () => ({ hidden: new Set<string>(), decorations: DecorationSet.empty }),
          apply(tr, value) {
            const meta = tr.getMeta(streamFilterKey)
            if (meta) return { hidden: meta.hidden, decorations: buildDecorations(tr.doc, meta.hidden) }
            if (!tr.docChanged || value.hidden.size === 0) return value
            return {
              hidden: value.hidden,
              decorations: onlyEntryTextChanged(tr.before, tr.doc)
                ? value.decorations.map(tr.mapping, tr.doc)
                : buildDecorations(tr.doc, value.hidden),
            }
          },
        },
        props: {
          decorations(state) {
            return streamFilterKey.getState(state)?.decorations ?? DecorationSet.empty
          },
        },
        // Guards against USER-originated edits reaching into a hidden
        // entry. Anything programmatic/sync already tags addToHistory:
        // false (see AssignBlockId/SummaryGrouping/the load & live-changes
        // paths in Feed/index.tsx) and is let through unconditionally —
        // only a real user transaction (typing/backspace/delete/paste/
        // cut/drag) needs checking against the currently-hidden ranges.
        // (filterTransaction is a top-level PluginSpec field, not a prop —
        // see prosemirror-state's PluginSpec, unlike decorations above.)
        filterTransaction(tr: Transaction, state: any) {
          if (tr.getMeta('addToHistory') === false) return true
          const filter = streamFilterKey.getState(state)
          if (!filter || filter.hidden.size === 0) return true
          // The decoration set already holds every hidden range; no doc walk.
          const ranges = filter.decorations.find().map((d) => ({ from: d.from, to: d.to }))
          return !stepsTouchHidden(tr.steps, ranges)
        },
      }),
    ]
  },
})
