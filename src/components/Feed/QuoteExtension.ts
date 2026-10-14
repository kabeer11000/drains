import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { QuoteView } from './QuoteView'

export const EXCERPT_CHARS = 160

// A quote of another entry (this drain or another). Inline atom inside the
// quoting entry, drawn as a card by QuoteView, which fetches the quoted
// entry itself (services/quotes.ts) — it doesn't matter whether that entry
// is loaded in the feed.
//
// Stored as <span data-type="quote" data-db-name data-entry-id-ref> with an
// excerpt link inside, so the public page, exports and search still show
// what was quoted without resolving anything.
export const Quote = Node.create({
  name: 'quote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      dbName: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-db-name') },
      entryIdRef: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-entry-id-ref') },
      excerpt: { default: '', parseHTML: (el: HTMLElement) => (el.textContent ?? '').replace(/^[“"]|[”"]$/g, '') },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="quote"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const { dbName, entryIdRef, excerpt } = node.attrs
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'quote', 'data-db-name': dbName, 'data-entry-id-ref': entryIdRef }),
      ['a', { href: `/drains/${dbName}#entry-${entryIdRef}` }, `“${excerpt}”`],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(QuoteView)
  },
})

export function excerptOf(text: string) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > EXCERPT_CHARS ? `${t.slice(0, EXCERPT_CHARS - 1)}…` : t
}
