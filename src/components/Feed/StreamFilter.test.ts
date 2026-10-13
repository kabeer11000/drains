import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { joinBackward, joinForward } from '@tiptap/pm/commands'
import { hiddenRangesInDoc, rangesOverlap, stepsTouchHidden } from './StreamFilter'

// Minimal schema — just enough to build the "top-level paragraph per
// entry" shape the real app uses, without pulling in Tiptap/StarterKit.
const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'text*',
      attrs: { entryId: { default: null } },
      toDOM: (node) => ['p', { 'data-entry-id': node.attrs.entryId }, 0],
      parseDOM: [{ tag: 'p' }],
    },
    text: { group: 'inline' },
  },
})

function p(entryId: string, text = 'hello') {
  return schema.nodes.paragraph.create({ entryId }, text ? schema.text(text) : undefined)
}

function stateWithDoc(...paragraphs: ReturnType<typeof p>[]) {
  const doc = schema.nodes.doc.create(null, paragraphs)
  return EditorState.create({ schema, doc })
}

describe('rangesOverlap', () => {
  it('overlaps for interleaving ranges', () => {
    expect(rangesOverlap({ from: 0, to: 5 }, { from: 3, to: 8 })).toBe(true)
  })
  it('overlaps when ranges only touch at a shared endpoint', () => {
    expect(rangesOverlap({ from: 0, to: 5 }, { from: 5, to: 8 })).toBe(true)
  })
  it('does not overlap when ranges are clearly apart', () => {
    expect(rangesOverlap({ from: 0, to: 5 }, { from: 6, to: 8 })).toBe(false)
  })
})

describe('hiddenRangesInDoc', () => {
  it('returns a range only for hidden top-level paragraphs', () => {
    const state = stateWithDoc(p('a'), p('b'), p('c'))
    const ranges = hiddenRangesInDoc(state.doc, new Set(['b']))
    expect(ranges).toHaveLength(1)
    const node = state.doc.nodeAt(ranges[0].from)
    expect(node?.attrs.entryId).toBe('b')
  })
  it('returns nothing for an empty hidden set', () => {
    const state = stateWithDoc(p('a'))
    expect(hiddenRangesInDoc(state.doc, new Set())).toEqual([])
  })
})

describe('stepsTouchHidden — the filterTransaction guard', () => {
  it('allows typing inside a visible neighbour', () => {
    const state = stateWithDoc(p('hidden-entry'), p('visible-entry'))
    // Place the cursor at the end of the visible paragraph's text and type.
    const visiblePos = state.doc.content.firstChild!.nodeSize + 1 + 'hello'.length
    const tr = state.tr.setSelection(TextSelection.create(state.doc, visiblePos)).insertText('!')
    const ranges = hiddenRangesInDoc(state.doc, new Set(['hidden-entry']))
    expect(stepsTouchHidden(tr.steps, ranges)).toBe(false)
  })

  it('rejects joinBackward merging a visible entry into the preceding hidden one', () => {
    const state = stateWithDoc(p('hidden-entry'), p('visible-entry'))
    const secondParaStart = state.doc.content.firstChild!.nodeSize + 1
    const withSelection = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, secondParaStart))
    )
    let produced: any = null
    joinBackward(withSelection, (tr) => {
      produced = tr
    })
    expect(produced).toBeTruthy()
    const ranges = hiddenRangesInDoc(withSelection.doc, new Set(['hidden-entry']))
    expect(stepsTouchHidden(produced.steps, ranges)).toBe(true)
  })

  it('rejects joinForward merging a visible entry into the following hidden one', () => {
    const state = stateWithDoc(p('visible-entry'), p('hidden-entry'))
    const endOfFirst = state.doc.content.firstChild!.nodeSize - 1
    const withSelection = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, endOfFirst))
    )
    let produced: any = null
    joinForward(withSelection, (tr) => {
      produced = tr
    })
    expect(produced).toBeTruthy()
    const ranges = hiddenRangesInDoc(withSelection.doc, new Set(['hidden-entry']))
    expect(stepsTouchHidden(produced.steps, ranges)).toBe(true)
  })

  it('rejects a select-all delete that spans a hidden entry', () => {
    const state = stateWithDoc(p('visible-a'), p('hidden-entry'), p('visible-b'))
    const tr = state.tr.delete(0, state.doc.content.size)
    const ranges = hiddenRangesInDoc(state.doc, new Set(['hidden-entry']))
    expect(stepsTouchHidden(tr.steps, ranges)).toBe(true)
  })

  it('allows a sync-originated delete of a hidden entry (addToHistory: false is checked by the caller, not this function)', () => {
    // stepsTouchHidden itself only reasons about ranges — the
    // addToHistory:false fast path lives in filterTransaction, one layer up.
    // This test documents that a sync transaction's steps WOULD be flagged
    // by stepsTouchHidden alone, which is exactly why filterTransaction
    // must check the meta first and skip this function entirely for those.
    const state = stateWithDoc(p('hidden-entry'))
    const tr = state.tr.delete(0, state.doc.content.size)
    const ranges = hiddenRangesInDoc(state.doc, new Set(['hidden-entry']))
    expect(stepsTouchHidden(tr.steps, ranges)).toBe(true)
  })
})
