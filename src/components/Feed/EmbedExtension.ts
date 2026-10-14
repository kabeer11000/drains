import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { EmbedView } from './EmbedView'
import { parseEmbed, bareUrl } from './embeds'

// An embedded video/design/link card inside an entry. Inline atom (entries
// are paragraphs, so their content is inline), shown as a block by the node
// view.
//
// Stored HTML is only `<span data-embed data-url><a href>url</a></span>`:
// the public page, the export, search and older clients all see a plain
// link, and no iframe ever comes from stored content — the node view
// rebuilds the player URL from data-url through the parseEmbed allowlist.
export const Embed = Node.create({
  name: 'embed',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      url: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-url') },
      kind: { default: 'link', parseHTML: (el: HTMLElement) => el.getAttribute('data-embed') || 'link' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-embed]',
        getAttrs: (el: HTMLElement) => (parseEmbed(el.getAttribute('data-url') ?? '') ? null : false),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const url = String(node.attrs.url)
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-embed': node.attrs.kind, 'data-url': url }),
      ['a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow' }, url],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView)
  },

  // Pasting nothing but a URL into an empty entry makes it an embed. A URL
  // pasted next to other text stays an ordinary link.
  addProseMirrorPlugins() {
    const type = this.type
    return [
      new Plugin({
        key: new PluginKey('embedPaste'),
        props: {
          handlePaste(view, event) {
            const url = bareUrl(event.clipboardData?.getData('text/plain') ?? '')
            const { $from, empty } = view.state.selection
            if (!url || !empty || $from.parent.content.size > 0) return false
            const embed = parseEmbed(url)!
            view.dispatch(view.state.tr.replaceSelectionWith(type.create({ url: embed.url, kind: embed.kind })))
            return true
          },
        },
      }),
    ]
  },
})
