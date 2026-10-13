import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { monotonicFactory } from 'ulid'
import { idBetween } from '@/utils/ulidArithmetic'

// Plain ulid() only sorts correctly across different milliseconds — pasting
// N lines assigns N ids inside one synchronous pass, all in the same
// millisecond, so plain ulid() can hand out ids in a different order than
// the lines appear in. Entries reload sorted by id, so that reshuffles them.
// monotonicFactory keeps ids strictly increasing even within the same ms.
const ulid = monotonicFactory()

// Splitting an existing (already-saved) entry via Enter should keep both
// halves sorted right next to each other, not send the new half to "now" —
// under newest-first display, a fresh timestamp would fly it to the very
// top on reload even though it visually stayed put mid-edit. The split-off
// half always lands BELOW the original in the document (it's whatever came
// after the cursor), and under descending/newest-first order a lower
// on-screen position needs a SMALLER id, not a larger one — see idBetween
// in utils/ulidArithmetic.ts, which finds the real predecessor id and slots
// the split-off piece strictly between the two rather than just
// decrementing (which can land exactly on, or past, an adjacent real entry).

export interface BlockIdentity {
  publicUserId: string
  name: string
  color: string
  email: string
}

// Every top-level paragraph must have an entryId to be linkable to a
// PouchDB doc. Splitting a block (Enter) produces a new paragraph with no
// entryId — this plugin notices on the very next transaction and assigns
// one, tagged with whoever is currently typing.
export const AssignBlockId = Extension.create<{ getIdentity: () => BlockIdentity }>({
  name: 'assignBlockId',

  addOptions() {
    return { getIdentity: () => ({ publicUserId: '', name: '', color: '', email: '' }) }
  },

  addProseMirrorPlugins() {
    const getIdentity = this.options.getIdentity
    return [
      new Plugin({
        key: new PluginKey('assignBlockId'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null

          let tr: ReturnType<typeof newState.tr> | null = null
          const identity = getIdentity()
          const seen = new Set<string>()
          const duplicateCount = new Map<string, number>()

          // Every id currently visible in the doc, sorted — a split-off id
          // needs to know its actual predecessor (the next-lower real id),
          // not just decrement blindly from the original. This app's ulid
          // generator (monotonicFactory) hands out strictly +1 ids for
          // anything minted in the same millisecond (quick typing, pasted
          // multi-line content, seeded entries), so a naive decrement can
          // land EXACTLY on — or even past — the next real entry's id,
          // confirmed directly, not theoretical.
          const sortedIds: string[] = []
          newState.doc.forEach((node) => {
            if (node.type.name === 'paragraph' && node.attrs.entryId) sortedIds.push(node.attrs.entryId)
          })
          sortedIds.sort()
          const findPredecessor = (id: string) => {
            let predecessor: string | null = null
            for (const existing of sortedIds) {
              if (existing < id && (predecessor === null || existing > predecessor)) predecessor = existing
            }
            return predecessor
          }

          // Splitting a block (Enter) copies the original node's attrs onto
          // the new node, so a duplicate entryId — not just a missing one —
          // means "this is actually a new block": keep the first occurrence
          // (the content before the cursor), reassign every later duplicate.
          //
          // Two different kinds of "needs an id" are collected separately
          // because they need opposite processing order. Duplicates
          // (splits) are handled via idBetween, which is purely id-based
          // and doesn't care what order they're processed in. Genuinely
          // new paragraphs (pasting several lines at once, all with no id
          // yet) call ulid() — monotonicFactory's whole point is that
          // repeated calls within the same millisecond come out strictly
          // increasing, so assigning them in top-to-bottom document order
          // would give the TOPMOST pasted line the SMALLEST id, sorting it
          // to the bottom on reload under newest-first/descending order
          // (confirmed directly) — assigning bottom-to-top instead gives
          // the topmost line the largest id, matching its on-screen position.
          const duplicates: { pos: number; id: string }[] = []
          const fresh: number[] = []

          newState.doc.forEach((node, pos) => {
            if (node.type.name !== 'paragraph') return
            const id = node.attrs.entryId
            if (id && !seen.has(id)) {
              seen.add(id)
              return
            }
            if (id) duplicates.push({ pos, id })
            else fresh.push(pos)
          })

          if (duplicates.length || fresh.length) tr = newState.tr

          for (const { pos, id } of duplicates) {
            // bump distinguishes several simultaneous duplicates of the
            // same original id — each gets a different suffix off the
            // same predecessor (see idBetween), not chained off each
            // other's result.
            const bump = (duplicateCount.get(id) ?? 0) + 1
            duplicateCount.set(id, bump)
            const newId = idBetween(findPredecessor(id), id, bump)
            tr!.setNodeAttribute(pos, 'entryId', newId)
            tr!.setNodeAttribute(pos, 'authorColor', identity.color)
            tr!.setNodeAttribute(pos, 'authorName', identity.name)
            tr!.setNodeAttribute(pos, 'updatedAt', null)
            tr!.setNodeAttribute(pos, 'createdAt', Date.now())
            tr!.setNodeAttribute(pos, 'createdByName', identity.name)
            tr!.setNodeAttribute(pos, 'createdByEmail', identity.email)
            // The split-off half is newly human-edited content, not the
            // machine-generated entry it was copied from — an AI summary
            // (or GitHub-ingested entry) split via Mod-Shift-Enter would
            // otherwise keep showing the AI/bot badge on a piece that's no
            // longer actually AI/bot-authored.
            tr!.setNodeAttribute(pos, 'source', null)
          }

          for (const pos of [...fresh].reverse()) {
            const newId = ulid()
            tr!.setNodeAttribute(pos, 'entryId', newId)
            tr!.setNodeAttribute(pos, 'authorColor', identity.color)
            tr!.setNodeAttribute(pos, 'authorName', identity.name)
            tr!.setNodeAttribute(pos, 'updatedAt', null)
            tr!.setNodeAttribute(pos, 'createdAt', Date.now())
            tr!.setNodeAttribute(pos, 'createdByName', identity.name)
            tr!.setNodeAttribute(pos, 'createdByEmail', identity.email)
          }

          if (tr) tr.setMeta('addToHistory', false)
          return tr
        },
      }),
    ]
  },
})
