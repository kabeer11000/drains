import Mention from '@tiptap/extension-mention'
import { listDrainMembers } from '@/services/drainsApi'
import { createSuggestionPopup } from './suggestionPopup'

// Same deterministic-hue idea as deriveIdentity's color derivation, but
// synchronous (no crypto.subtle) since renderHTML can't await — good enough
// for "consistent color per person," which is all a mention pill needs.
// Returns both a solid text color and a translucent background — string-
// concatenating "22" (hex alpha shorthand) onto an hsl() value doesn't work
// like it does for hex colors, hsl() needs its own explicit alpha argument,
// confirmed by testing the resulting CSS wasn't being applied.
export function colorsForEmail(email: string) {
  let hash = 0
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return {
    text: `light-dark(hsl(${hue}, 35%, 45%), hsl(${hue}, 55%, 75%))`,
    background: `light-dark(hsl(${hue}, 35%, 45%, 0.13), hsl(${hue}, 45%, 65%, 0.2))`,
  }
}

// Cached per drain for the lifetime of this editor instance — members don't
// change often enough to justify refetching on every keystroke while typing
// after "@".
const membersCache = new Map<string, Promise<string[]>>()

function getMembers(dbName: string): Promise<string[]> {
  let cached = membersCache.get(dbName)
  if (!cached) {
    cached = listDrainMembers(dbName).catch(() => [])
    membersCache.set(dbName, cached)
  }
  return cached
}

// Moved into shared suggestionPopup.ts so StreamSuggestion's '#' popup
// reuses the same widget rather than a copy — behaviour here is unchanged,
// only the DOM-widget plumbing moved. items are plain email strings, same
// as before; the command mapping ({id: email}) that Mention's default
// `command` option expects still happens here, not in the shared module.
const renderSuggestionList = createSuggestionPopup<string>({
  kind: 'mention',
  emptyText: 'No matching members',
  renderItem: (email, btn) => {
    btn.textContent = email
  },
  toCommandArg: (email) => ({ id: email }),
})

export function createMentionExtension(dbName: string) {
  return Mention.configure({
    HTMLAttributes: { class: 'mention-pill' },
    // The Mention node's own renderHTML only auto-adds data-type/data-id
    // wrapping when this callback returns a plain string — since a full
    // ["span", attrs, text] array is returned here instead (needed for the
    // inline color style), both attributes have to be set explicitly or
    // parseHTML (which matches span[data-type="mention"]) can't round-trip
    // a mention back out of stored/reloaded content.
    renderHTML({ node }) {
      const { text: color, background } = colorsForEmail(node.attrs.id || '')
      return [
        'span',
        {
          class: 'mention-pill',
          'data-type': 'mention',
          'data-id': node.attrs.id,
          style: `background:${background};color:${color}`,
        },
        `@${node.attrs.id}`,
      ]
    },
    suggestion: {
      char: '@',
      items: async ({ query }: { query: string }) => {
        const members = await getMembers(dbName)
        return members.filter((email) => email.toLowerCase().includes(query.toLowerCase())).slice(0, 5)
      },
      render: renderSuggestionList,
    },
  })
}
