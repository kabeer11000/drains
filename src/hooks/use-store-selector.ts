import { useRef, useSyncExternalStore } from 'react'
import type { ReadableAtom } from 'nanostores'

// Subscribe to a slice of a nanostore. The component re-renders only when
// `select` returns something `equal` says is different. Unlike useStore,
// which re-renders on any change — with one store read by every entry card,
// filing one entry re-rendered all of them.
//
// `key` holds whatever else the selection depends on (e.g. the entry id),
// so the cached result is recomputed when it changes.
export function useStoreSelector<T, S>(
  store: ReadableAtom<T>,
  select: (value: T) => S,
  key: unknown = null,
  equal: (a: S, b: S) => boolean = Object.is
): S {
  const selectRef = useRef(select)
  selectRef.current = select
  const cache = useRef<{ value: T; key: unknown; selected: S } | null>(null)

  const getSnapshot = () => {
    const value = store.get()
    const prev = cache.current
    if (prev && prev.value === value && prev.key === key) return prev.selected
    const selected = selectRef.current(value)
    // Same answer from a new store value: keep the old reference so React
    // sees no change.
    if (prev && prev.key === key && equal(prev.selected, selected)) {
      cache.current = { value, key, selected: prev.selected }
      return prev.selected
    }
    cache.current = { value, key, selected }
    return selected
  }

  return useSyncExternalStore((onChange) => store.listen(onChange), getSnapshot, getSnapshot)
}

export function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}
