import { describe, it, expect } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { onlyEntryTextChanged } from './docDiff'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'text*',
      attrs: { entryId: { default: null }, source: { default: null }, summarizedEntryIds: { default: null } },
      toDOM: () => ['p', 0],
    },
    text: { group: 'inline' },
  },
})
const p = (entryId: string | null, text = 'hi') => schema.nodes.paragraph.create({ entryId }, text ? schema.text(text) : undefined)
const state = (...ps: ReturnType<typeof p>[]) => EditorState.create({ schema, doc: schema.nodes.doc.create(null, ps) })

describe('onlyEntryTextChanged', () => {
  it('is true for typing inside an entry', () => {
    const s = state(p('a'), p('b'))
    const end = s.doc.child(0).nodeSize + 1 + 2
    const tr = s.tr.setSelection(TextSelection.create(s.doc, end)).insertText('!')
    expect(onlyEntryTextChanged(s.doc, tr.doc)).toBe(true)
  })

  it('is false when an entry is added or removed', () => {
    const s = state(p('a'), p('b'))
    expect(onlyEntryTextChanged(s.doc, s.tr.insert(s.doc.content.size, p('c')).doc)).toBe(false)
    expect(onlyEntryTextChanged(s.doc, s.tr.delete(0, s.doc.child(0).nodeSize).doc)).toBe(false)
  })

  it('is false when the edited paragraph has no id yet (the composer needs one)', () => {
    const s = state(p(null, ''), p('b'))
    expect(onlyEntryTextChanged(s.doc, s.tr.insertText('x', 1).doc)).toBe(false)
  })

  it('is false when an id or summary attr changes', () => {
    const s = state(p('a'), p('b'))
    expect(onlyEntryTextChanged(s.doc, s.tr.setNodeAttribute(0, 'entryId', 'z').doc)).toBe(false)
    expect(onlyEntryTextChanged(s.doc, s.tr.setNodeAttribute(0, 'summarizedEntryIds', ['b']).doc)).toBe(false)
  })

  it('is true for the same doc', () => {
    const s = state(p('a'))
    expect(onlyEntryTextChanged(s.doc, s.doc)).toBe(true)
  })
})
