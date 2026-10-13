// Vanilla-DOM suggestion popup (no tippy.js dependency), shared by every
// Tiptap `@tiptap/suggestion`-based popup in this app (MentionExtension's
// '@', StreamSuggestion's '#') — positioned via the clientRect the
// suggestion plugin already computes from cursor position, matching the
// popover styling used elsewhere (AddCommentPopover).
//
// Each caller supplies how an item renders and, via its own `command`
// option, what picking an item actually does — this module only owns the
// DOM widget: positioning, keyboard nav, and forwarding the picked item to
// `props.command`.
export function createSuggestionPopup<T>(options: {
  // Value for data-suggestion-popup — BlockParagraph's Enter handler only
  // checks for the attribute's presence, not its value, but a distinct
  // value per popup kind makes this trivial to debug in devtools.
  kind: string
  renderItem: (item: T, container: HTMLButtonElement) => void
  emptyText?: string
  hint?: string
  // What to hand to props.command() when an item is picked — defaults to
  // the item itself. Mention's default `command` option expects `{id}`
  // rather than a bare email string, so MentionExtension overrides this.
  toCommandArg?: (item: T) => any
}) {
  return function renderSuggestion() {
    let container: HTMLDivElement | null = null
    let items: T[] = []
    let selected = 0
    let onPick: ((item: T) => void) | null = null

    const draw = () => {
      if (!container) return
      container.innerHTML = ''
      if (items.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'px-2 py-1.5 text-xs text-muted-foreground'
        empty.textContent = options.emptyText ?? 'No matches'
        container.appendChild(empty)
        return
      }
      items.forEach((item, i) => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = `block w-full truncate rounded-md px-2 py-1 text-left text-sm ${
          i === selected ? 'bg-accent' : ''
        }`
        options.renderItem(item, btn)
        btn.onmousedown = (e) => {
          e.preventDefault()
          onPick?.(item)
        }
        container!.appendChild(btn)
      })

      const hint = document.createElement('div')
      hint.className = 'mt-0.5 border-t px-2 pt-1 text-[10px] text-muted-foreground'
      hint.textContent = options.hint ?? '↑↓ navigate · ↵ select · Esc cancel'
      container!.appendChild(hint)
    }

    // Re-bound on every update, not just onStart: props.command closes
    // over the suggestion's current range, and at onStart that range is
    // only the trigger char. Keeping the first one meant picking "#hci"
    // replaced just the "#" and left "hci" behind in the entry.
    const bindPick = (props: any) => {
      onPick = props.command
        ? (item: T) => props.command(options.toCommandArg ? options.toCommandArg(item) : item)
        : null
    }

    return {
      onStart: (props: any) => {
        items = props.items
        bindPick(props)
        container = document.createElement('div')
        container.setAttribute('data-suggestion-popup', options.kind)
        container.className =
          'fixed z-50 min-w-[180px] max-w-[260px] rounded-lg border bg-popover p-1 text-popover-foreground shadow-md'
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
        bindPick(props)
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
}
