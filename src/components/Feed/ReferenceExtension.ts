import { Node, mergeAttributes } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { Suggestion } from '@tiptap/suggestion'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { $drains } from '@/helpers/drains'
import { getDrainDb } from '@/services/db'
import { loadLatestPage } from '@/utils/ulid-pages'
import { ReferencePill } from './ReferencePill'

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export interface RefItem {
  refType: 'drain' | 'entry'
  dbName: string
  entryId: string | null
  label: string
}

// Matches against drain titles and each drain's already-synced local entry
// content — same local-first tradeoff as CommandPalette's search. The
// resulting label is ONLY used to populate the suggestion dropdown; it is
// NOT what gets stored or displayed once inserted (see ReferencePill —
// display is resolved per-viewer at render time, since a shared entry
// referencing someone's private drain must not leak that drain's title to
// other viewers who aren't members of it).
async function searchItems(query: string): Promise<RefItem[]> {
  const q = query.trim().toLowerCase()
  const drains = $drains.get()

  const drainMatches: RefItem[] = drains
    .filter((d: any) => (d.title || '').toLowerCase().includes(q))
    .slice(0, 5)
    .map((d: any) => ({ refType: 'drain' as const, dbName: d.dbName, entryId: null, label: d.title || 'Untitled' }))

  let entryMatches: RefItem[] = []
  if (q.length >= 2) {
    const groups = await Promise.all(
      drains.map(async (d: any) => {
        const db = getDrainDb(d.dbName)
        const page = await loadLatestPage(db, 30).catch(() => [] as any[])
        return page
          .map((doc: any) => ({ doc, text: stripHtml(doc.content) }))
          .filter(({ text }: any) => text.toLowerCase().includes(q))
          .slice(0, 3)
          .map(
            ({ doc, text }: any): RefItem => ({
              refType: 'entry',
              dbName: d.dbName,
              entryId: doc._id.slice('entry:'.length),
              label: `${d.title || 'Untitled'}: ${text.slice(0, 60)}`,
            })
          )
      })
    )
    entryMatches = groups.flat().slice(0, 5)
  }

  return [...drainMatches, ...entryMatches]
}

// Vanilla-DOM suggestion popup, same pattern as MentionExtension.ts (no
// tippy.js dependency) — positioned via the clientRect the suggestion
// plugin already computes from cursor position.
function renderSuggestionList() {
  let container: HTMLDivElement | null = null
  let items: RefItem[] = []
  let selected = 0
  let onPick: ((item: RefItem) => void) | null = null

  const draw = () => {
    if (!container) return
    container.innerHTML = ''
    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'px-2 py-1.5 text-xs text-muted-foreground'
      empty.textContent = 'No matching drains or entries'
      container.appendChild(empty)
      return
    }

    // Grouped with headings + a type badge per row — without this, drains
    // and entries were an unlabeled flat list with no way to tell which was
    // which before picking one.
    let lastType: RefItem['refType'] | null = null
    items.forEach((item, i) => {
      if (item.refType !== lastType) {
        lastType = item.refType
        const heading = document.createElement('div')
        heading.className = 'px-2 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'
        heading.textContent = item.refType === 'drain' ? 'Drains' : 'Entries'
        container!.appendChild(heading)
      }

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs ${
        i === selected ? 'bg-accent' : ''
      }`

      const badge = document.createElement('span')
      badge.className = 'shrink-0 rounded bg-secondary px-1 py-0.5 text-[9px] font-medium text-muted-foreground'
      badge.textContent = item.refType === 'drain' ? 'DRAIN' : 'ENTRY'
      btn.appendChild(badge)

      const label = document.createElement('span')
      label.className = 'truncate'
      label.textContent = item.label
      btn.appendChild(label)

      btn.onmousedown = (e) => {
        e.preventDefault()
        onPick?.(item)
      }
      container!.appendChild(btn)
    })

    const hint = document.createElement('div')
    hint.className = 'mt-0.5 border-t px-2 pt-1 text-[10px] text-muted-foreground'
    hint.textContent = '↑↓ navigate · ↵ select · Esc cancel'
    container!.appendChild(hint)
  }

  return {
    onStart: (props: any) => {
      items = props.items
      onPick = props.command ? (item: RefItem) => props.command(item) : null
      container = document.createElement('div')
      container.setAttribute('data-suggestion-popup', 'reference')
      container.className =
        'fixed z-50 min-w-[220px] max-w-[320px] rounded-lg border bg-popover p-1 text-popover-foreground shadow-md'
      document.body.appendChild(container)
      const rect = props.clientRect?.()
      if (rect && container) {
        container.style.left = `${rect.left}px`
        container.style.top = `${rect.bottom + 4}px`
      }
      draw()
    },
    onUpdate: (props: any) => {
      items = props.items
      selected = 0
      const rect = props.clientRect?.()
      if (rect && container) {
        container.style.left = `${rect.left}px`
        container.style.top = `${rect.bottom + 4}px`
      }
      draw()
    },
    onKeyDown: (props: any) => {
      if (!items.length) return false
      if (props.event.key === 'ArrowDown') {
        selected = (selected + 1) % items.length
        draw()
        return true
      }
      if (props.event.key === 'ArrowUp') {
        selected = (selected - 1 + items.length) % items.length
        draw()
        return true
      }
      if (props.event.key === 'Enter') {
        onPick?.(items[selected])
        return true
      }
      if (props.event.key === 'Escape') {
        container?.remove()
        return true
      }
      return false
    },
    onExit: () => {
      container?.remove()
      container = null
    },
  }
}

// Inline atom referencing a drain or a specific entry, possibly in a
// different drain than the one this reference lives in. Deliberately
// stores only dbName/entryId, never a title or content snippet — those are
// resolved per-viewer at render time by ReferencePill, so a viewer without
// access to the referenced drain sees a locked placeholder instead of
// whatever the referrer could see when they created it.
export const ReferenceExtension = Node.create({
  name: 'reference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      refType: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-ref-type'),
        renderHTML: (attrs: any) => (attrs.refType ? { 'data-ref-type': attrs.refType } : {}),
      },
      dbName: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-db-name'),
        renderHTML: (attrs: any) => (attrs.dbName ? { 'data-db-name': attrs.dbName } : {}),
      },
      // Named entryIdRef (not entryId) and data-entry-id-ref (not
      // data-entry-id) to avoid any confusion with BlockParagraph's own
      // entryId/data-entry-id, which is a completely different thing (the
      // id of the paragraph THIS reference happens to live inside).
      entryIdRef: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-entry-id-ref'),
        renderHTML: (attrs: any) => (attrs.entryIdRef ? { 'data-entry-id-ref': attrs.entryIdRef } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="reference"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-type': 'reference', class: 'reference-pill-src' }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReferencePill)
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        // @tiptap/suggestion's default key is shared between every
        // Suggestion() call — ProseMirror rejects duplicates ("Adding
        // different instances of a keyed plugin"). Mention uses the
        // built-in default; Reference needs its own key to coexist with
        // Mention AND any future Suggestion (StreamSuggestion already does).
        pluginKey: new PluginKey('suggestionReference'),
        editor: this.editor,
        char: '[[',
        // Default `allowedPrefixes` ([" "]) — popup fires only when "[["
        // starts at the trigger spot AND the char before it is whitespace
        // or start-of-doc. Previously null (mid-word firing), which let a
        // stray "[[" mid-sentence open the popup and was the same class of
        // bug a mid-word `##` surfaced in the stream popup.
        items: ({ query }) => searchItems(query),
        command: ({ editor, range, props }: any) => {
          const item = props as RefItem
          editor
            .chain()
            .focus()
            .insertContentAt(range, {
              type: 'reference',
              attrs: { refType: item.refType, dbName: item.dbName, entryIdRef: item.entryId },
            })
            .run()
        },
        render: renderSuggestionList,
      }),
    ]
  },
})
