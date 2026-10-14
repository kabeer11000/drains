import type { Node as PMNode } from '@tiptap/pm/model'

// True when the only thing that changed between two docs is the inline
// content of existing entries: same number of top-level paragraphs, and
// every paragraph that differs kept its entryId (a real one, not null),
// source and summarizedEntryIds. ProseMirror shares unchanged child nodes
// between docs, so unchanged entries are skipped by reference; this costs
// one pointer comparison per entry, no content walk.
//
// Per-keystroke plugins use it to skip whole-drain work while typing
// inside an entry: summary threads, visibility, the day outline and id
// assignment depend only on this "shape", not on the text.
export function onlyEntryTextChanged(before: PMNode, after: PMNode): boolean {
  if (before === after) return true
  if (before.childCount !== after.childCount) return false
  for (let i = 0; i < after.childCount; i++) {
    const a = before.child(i)
    const b = after.child(i)
    if (a === b) continue
    if (a.type !== b.type) return false
    const id = b.attrs.entryId
    if (!id || a.attrs.entryId !== id) return false
    if (a.attrs.source !== b.attrs.source) return false
    if (a.attrs.summarizedEntryIds !== b.attrs.summarizedEntryIds) return false
  }
  return true
}
