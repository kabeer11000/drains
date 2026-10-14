import { describe, it, expect } from 'vitest'
import { fetchLatest, fetchOlder, fetchNewer, fetchAround, positionOf, type EntrySource } from './entrySource'

// Minimal in-memory stand-in for PouchDB's allDocs (range + keys queries).
function fakeDb(ids: string[]) {
  const docs = new Map(ids.map((id) => [`entry:${id}`, { _id: `entry:${id}`, type: 'entry' }]))
  const sorted = [...docs.keys()].sort()
  return {
    allDocs: async (o: any) => {
      if (o.keys) return { rows: o.keys.map((k: string) => ({ doc: docs.get(k) })) }
      let keys = sorted.filter((k) =>
        o.descending ? k <= o.startkey && k >= o.endkey : k >= o.startkey && k <= o.endkey
      )
      if (o.descending) keys = keys.reverse()
      keys = keys.slice(o.skip ?? 0, (o.skip ?? 0) + (o.limit ?? Infinity))
      return { rows: keys.map((k) => ({ doc: docs.get(k) })) }
    },
  } as any
}

const ids = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'] // ULID-like: larger = newer
const desc = [...ids].reverse()
const all: EntrySource = { kind: 'all' }
const some: EntrySource = { kind: 'ids', ids: ['09', '07', '05', '03', '01'] }
const rid = (d: any[]) => d.map((x) => x._id.slice(6))

describe('positionOf', () => {
  it('finds the slot in a newest-first list', () => {
    expect(positionOf(['09', '07', '05'], '07')).toBe(1)
    expect(positionOf(['09', '07', '05'], '08')).toBe(1)
    expect(positionOf(['09', '07', '05'], '10')).toBe(0)
    expect(positionOf(['09', '07', '05'], '01')).toBe(3)
  })
})

describe('all entries', () => {
  const db = fakeDb(ids)
  it('latest page, newest first', async () => {
    expect(rid(await fetchLatest(db, all, 3))).toEqual(['10', '09', '08'])
  })
  it('older and newer exclude the anchor', async () => {
    expect(rid(await fetchOlder(db, all, '05', 2))).toEqual(['04', '03'])
    expect(rid(await fetchNewer(db, all, '05', 2))).toEqual(['07', '06'])
  })
  it('window around an entry includes it, with end flags', async () => {
    const w = await fetchAround(db, all, '05', 2, 2)
    expect(rid(w.docs)).toEqual(['07', '06', '05', '04', '03'])
    expect(w.hasNewer).toBe(true)
    expect(w.hasOlder).toBe(true)
    const top = await fetchAround(db, all, '10', 2, 20)
    expect(top.hasNewer).toBe(false)
    expect(top.hasOlder).toBe(false)
  })
  it('agrees with a plain slice of the full list', async () => {
    expect(rid(await fetchOlder(db, all, desc[3], 4))).toEqual(desc.slice(4, 8))
  })
})

describe('a fixed id list (filter)', () => {
  const db = fakeDb(ids)
  it('pages through only the listed ids', async () => {
    expect(rid(await fetchLatest(db, some, 2))).toEqual(['09', '07'])
    expect(rid(await fetchOlder(db, some, '07', 2))).toEqual(['05', '03'])
    expect(rid(await fetchNewer(db, some, '05', 5))).toEqual(['09', '07'])
  })
  it('windows around an id, even one not in the list', async () => {
    expect(rid((await fetchAround(db, some, '05', 1, 1)).docs)).toEqual(['07', '05', '03'])
    expect(rid((await fetchAround(db, some, '06', 1, 1)).docs)).toEqual(['07', '05'])
  })
})

describe('withId / withoutId', () => {
  it('insert in order, ignore duplicates, remove', async () => {
    const { withId, withoutId } = await import('./entrySource')
    expect(withId(['09', '05'], '07')).toEqual(['09', '07', '05'])
    expect(withId(['09', '05'], '10')).toEqual(['10', '09', '05'])
    const same = ['09', '05']
    expect(withId(same, '05')).toBe(same)
    expect(withoutId(['09', '07', '05'], '07')).toEqual(['09', '05'])
    expect(withoutId(same, '01')).toBe(same)
  })
})
