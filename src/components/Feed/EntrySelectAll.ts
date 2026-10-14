import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

// Ctrl/Cmd+A selects the entry the caret is in, not the whole editor.
// The editor only ever holds a window of the drain's entries, so a
// document-wide selection would be both wrong (not "all") and dangerous:
// Delete would remove every loaded entry from the database. Same idea as
// Notion's first Ctrl+A selecting the current block; actions across many
// entries belong to bulk select, which works on ids, not on the window.
export const EntrySelectAll = Extension.create({
  name: 'entrySelectAll',
  addKeyboardShortcuts() {
    return {
      'Mod-a': ({ editor }) => {
        const { $from } = editor.state.selection
        if ($from.depth < 1) return true
        const start = $from.start(1)
        const end = $from.end(1)
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start, end)))
        return true
      },
    }
  },
})
