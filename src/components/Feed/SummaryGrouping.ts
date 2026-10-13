import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'

// Marks every entry an AI summary claims (summarizedEntryIds) with a
// derived claimedBySummary attr. Re-summarizing the same day without
// deleting the old summary first stacks a second summary node directly
// above the same claimed entries — rather than treating that as a second,
// separately-badged card (which looked janky: bigger gap between the two
// summaries than between claimed entries, second badge overlapping the
// first card), a summary node whose immediately-preceding sibling is
// ALSO a summary is treated exactly like a claimed entry for chain
// purposes (isNestedSummary) — same tight margin, same continuous bar,
// no badge of its own. Only the topmost ("root") summary in a stack shows
// the badge; isLastInGroup marks whichever node (claimed entry OR nested
// summary) is the true end of the whole chain. Recomputed from scratch on
// every doc-changing transaction — deleting a summary means the next scan
// simply finds one fewer link in the chain, no cleanup logic needed.
export interface ChainBlock {
  entryId?: string | null
  isSummary: boolean
  claims?: string[]
}

// Which blocks the thread bar runs through. A summary's thread spans every
// block from the summary down to the LAST entry it claims, not only the
// claimed entries themselves: an entry added to that day after summarizing
// (or split off a claimed one) sits inside the range without being in
// summarizedEntryIds, and treating it as outside broke the bar into pieces.
export function chainFlags(blocks: ChainBlock[]): boolean[] {
  const flags = blocks.map((b) => b.isSummary)
  const indexById = new Map<string, number>()
  blocks.forEach((b, i) => {
    if (b.entryId) indexById.set(b.entryId, i)
  })
  blocks.forEach((b, start) => {
    if (!b.isSummary || !b.claims?.length) return
    let end = start
    for (const id of b.claims) {
      const i = indexById.get(id)
      if (i !== undefined && i > end) end = i
    }
    for (let i = start; i <= end; i++) flags[i] = true
  })
  return flags
}

export const SummaryGrouping = Extension.create({
  name: 'summaryGrouping',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('summaryGrouping'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null

          // Collected as a plain array first, then walked with a normal
          // index-based loop (not nested closures) — TypeScript loses
          // narrowing on a `let` reassigned inside a forEach callback, same
          // class of issue already hit elsewhere in this codebase
          // (EditorToolbar.tsx's currentBlock).
          const blocks: ChainBlock[] = []
          const positions: number[] = []
          newState.doc.forEach((node, pos) => {
            if (node.type.name !== 'paragraph') return
            blocks.push({
              entryId: node.attrs.entryId,
              isSummary: node.attrs.source === 'ai-summary',
              claims: node.attrs.summarizedEntryIds ?? undefined,
            })
            positions.push(pos)
          })
          const chain = chainFlags(blocks)
          const paragraphs = blocks.map((b, i) => ({ pos: positions[i], isSummary: b.isSummary, inChain: chain[i] }))

          const changes: {
            pos: number
            shouldClaim: boolean
            isNestedSummary: boolean
            isLastInGroup: boolean
          }[] = []
          for (let i = 0; i < paragraphs.length; i++) {
            const { pos, isSummary, inChain } = paragraphs[i]
            const shouldClaim = inChain && !isSummary
            const isNestedSummary = isSummary && (paragraphs[i - 1]?.isSummary ?? false)
            const isLastInGroup = inChain && !(paragraphs[i + 1]?.inChain ?? false)
            const node = newState.doc.nodeAt(pos)
            if (!node) continue
            if (
              !!node.attrs.claimedBySummary !== shouldClaim ||
              !!node.attrs.isNestedSummary !== isNestedSummary ||
              !!node.attrs.isLastInGroup !== isLastInGroup
            ) {
              changes.push({ pos, shouldClaim, isNestedSummary, isLastInGroup })
            }
          }
          if (changes.length === 0) return null

          const tr: Transaction = newState.tr
          for (const { pos, shouldClaim, isNestedSummary, isLastInGroup } of changes) {
            tr.setNodeAttribute(pos, 'claimedBySummary', shouldClaim)
            tr.setNodeAttribute(pos, 'isNestedSummary', isNestedSummary)
            tr.setNodeAttribute(pos, 'isLastInGroup', isLastInGroup)
          }
          tr.setMeta('addToHistory', false)
          return tr
        },
      }),
    ]
  },
})
