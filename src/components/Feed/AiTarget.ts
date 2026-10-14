import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// What the AI panel is working on: a text range inside one entry, or the
// whole entry. Kept in plugin state so the range is mapped through any edits
// (typing elsewhere, sync patches) while the panel is open, and highlighted
// so it's always clear what Replace will change.
export interface AiTargetState {
  entryId: string
  from: number
  to: number
  whole: boolean
}

export const aiTargetKey = new PluginKey<{ target: AiTargetState | null; decorations: DecorationSet }>('aiTarget')

function decorate(doc: any, target: AiTargetState | null): DecorationSet {
  if (!target) return DecorationSet.empty
  if (target.whole) {
    let deco: Decoration | null = null
    doc.forEach((node: any, pos: number) => {
      if (!deco && node.attrs.entryId === target.entryId) deco = Decoration.node(pos, pos + node.nodeSize, { class: 'ai-target-entry' })
    })
    return deco ? DecorationSet.create(doc, [deco]) : DecorationSet.empty
  }
  if (target.to <= target.from) return DecorationSet.empty
  return DecorationSet.create(doc, [Decoration.inline(target.from, target.to, { class: 'ai-target' })])
}

export function setAiTarget(editor: Editor, target: AiTargetState | null) {
  editor.view.dispatch(editor.state.tr.setMeta(aiTargetKey, { target }).setMeta('addToHistory', false))
}

export function getAiTarget(editor: Editor): AiTargetState | null {
  return aiTargetKey.getState(editor.state)?.target ?? null
}

export const AiTarget = Extension.create({
  name: 'aiTarget',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: aiTargetKey,
        state: {
          init: () => ({ target: null as AiTargetState | null, decorations: DecorationSet.empty }),
          apply(tr, value) {
            const meta = tr.getMeta(aiTargetKey)
            if (meta) return { target: meta.target, decorations: decorate(tr.doc, meta.target) }
            if (!tr.docChanged || !value.target) return value
            const target = {
              ...value.target,
              from: tr.mapping.map(value.target.from, 1),
              to: tr.mapping.map(value.target.to, -1),
            }
            return { target, decorations: target.whole ? decorate(tr.doc, target) : value.decorations.map(tr.mapping, tr.doc) }
          },
        },
        props: {
          decorations: (state) => aiTargetKey.getState(state)?.decorations ?? DecorationSet.empty,
        },
      }),
    ]
  },
})
