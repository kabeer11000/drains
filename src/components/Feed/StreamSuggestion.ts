import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { Suggestion } from '@tiptap/suggestion'
import { createSuggestionPopup } from './suggestionPopup'
import { $streams } from '@/stores/streams'
import { $identity } from '@/services/identity'
import { getDrainDb } from '@/services/db'
import { createStream, linkEntry, slugOfStream, STREAM_COLORS, type StreamDoc } from '@/services/streams'

// @tiptap/suggestion's default PluginKey is shared by every Suggestion()
// call and ProseMirror rejects duplicates, so each popup needs its own.
const streamSuggestionKey = new PluginKey('suggestionStream')

type StreamItem = { kind: 'stream'; stream: StreamDoc } | { kind: 'create'; name: string }

const renderStreamList = createSuggestionPopup<StreamItem>({
  kind: 'stream',
  emptyText: 'Type a name to create a stream',
  hint: '↑↓ navigate · ↵ file entry · Esc cancel',
  renderItem: (item, btn) => {
    btn.classList.add('flex', 'items-center', 'gap-1.5')
    const mark = document.createElement('span')
    mark.className = 'font-semibold'
    if (item.kind === 'stream') {
      mark.textContent = '#'
      mark.style.color = item.stream.color
      btn.appendChild(mark)
      btn.appendChild(document.createTextNode(item.stream.name))
    } else {
      mark.textContent = '+'
      btn.appendChild(mark)
      btn.appendChild(document.createTextNode(`Create "${item.name}"`))
    }
  },
})

// `#` files the entry the caret is in. The typed `#query` is removed and
// the stream shows as a prefix label on the entry (EntryBlockView) — the
// streamlink doc is the only record of membership, never the entry text,
// so filing works the same from here, the label picker, the composer
// following a channel, or the API.
export function createStreamSuggestion(dbName: string) {
  return Extension.create({
    name: 'streamSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion<StreamItem>({
          pluginKey: streamSuggestionKey,
          editor: this.editor,
          char: '#',
          // Default allowedPrefixes ([' ']): only after whitespace or at
          // the start, so `C#`, `url#anchor` and `[[db#entry` never fire.
          // Never inside inline code either (`#include`).
          allow: ({ state, range }) =>
            !state.doc
              .resolve(range.from)
              .marks()
              .some((m) => m.type.name === 'code'),
          items: ({ query }) => {
            const q = query.trim().toLowerCase()
            const streams = $streams.get()
            const matches = streams.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 6)
            const items: StreamItem[] = matches.map((stream) => ({ kind: 'stream', stream }))
            const exact = streams.some((s) => s.name.toLowerCase() === q)
            if (q && !exact) items.push({ kind: 'create', name: query.trim() })
            return items
          },
          command: ({ editor, range, props }) => {
            const entryId = editor.state.doc.resolve(range.from).parent.attrs.entryId as string | undefined
            editor.chain().focus().deleteRange(range).run()
            const identity = $identity.get()
            if (!entryId || !identity) return
            const db = getDrainDb(dbName)
            const file = async () => {
              const stream =
                props.kind === 'stream'
                  ? props.stream
                  : await createStream(
                      db,
                      props.name,
                      identity,
                      STREAM_COLORS[$streams.get().length % STREAM_COLORS.length]
                    )
              await linkEntry(db, entryId, slugOfStream(stream), identity)
            }
            file().catch((err) => console.error('Failed to file entry into stream', err))
          },
          render: renderStreamList,
        }),
      ]
    },
  })
}
