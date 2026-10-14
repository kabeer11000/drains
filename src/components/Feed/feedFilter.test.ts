import { describe, it, expect } from 'vitest'
import {
  EMPTY_FILTER,
  UNSORTED,
  authorKeyOf,
  countByStream,
  isPristine,
  isEntryVisible,
  isFilterActive,
  selectStream,
  singleSelectedStream,
  type FeedFilter,
} from './feedFilter'

const f = (over: Partial<FeedFilter> = {}): FeedFilter => ({ ...EMPTY_FILTER, ...over })
const live = new Set(['hci', 'compiler'])
const me = {}

describe('isFilterActive', () => {
  it('is false for the default filter', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false)
  })
  it('is true for a channel selection', () => {
    expect(isFilterActive(f({ streams: new Set(['hci']) }))).toBe(true)
  })
  it('ignores a query unless onlyMatches is on', () => {
    expect(isFilterActive(f({ query: 'x' }))).toBe(false)
    expect(isFilterActive(f({ query: 'x', onlyMatches: true }))).toBe(true)
    expect(isFilterActive(f({ query: '  ', onlyMatches: true }))).toBe(false)
  })
})

describe('selectStream', () => {
  it('switches to a single channel on plain click', () => {
    expect([...selectStream(f({ streams: new Set(['hci']) }), 'compiler', false).streams]).toEqual(['compiler'])
  })
  it('goes back to All when clicking the only active channel', () => {
    expect(selectStream(f({ streams: new Set(['hci']) }), 'hci', false).streams.size).toBe(0)
  })
  it('adds and removes with additive click', () => {
    const two = selectStream(f({ streams: new Set(['hci']) }), 'compiler', true)
    expect([...two.streams].sort()).toEqual(['compiler', 'hci'])
    expect([...selectStream(two, 'hci', true).streams]).toEqual(['compiler'])
  })
  it('collapses a multi-selection to one channel on plain click', () => {
    const two = f({ streams: new Set(['hci', 'compiler']) })
    expect([...selectStream(two, 'hci', false).streams]).toEqual(['hci'])
  })
  it('does not mutate the input filter', () => {
    const input = f({ streams: new Set(['hci']) })
    selectStream(input, 'compiler', true)
    expect([...input.streams]).toEqual(['hci'])
  })
})

describe('singleSelectedStream', () => {
  it('returns the slug when exactly one real stream is selected', () => {
    expect(singleSelectedStream(f({ streams: new Set(['hci']) }))).toBe('hci')
  })
  it('is null for All, Unsorted, or several streams', () => {
    expect(singleSelectedStream(EMPTY_FILTER)).toBeNull()
    expect(singleSelectedStream(f({ streams: new Set([UNSORTED]) }))).toBeNull()
    expect(singleSelectedStream(f({ streams: new Set(['hci', 'compiler']) }))).toBeNull()
  })
})

describe('authorKeyOf', () => {
  it('prefers source over everything', () => {
    expect(authorKeyOf({ source: 'github', createdByEmail: 'a@b.com' })).toBe('source:github')
  })
  it('prefers viaToken over email', () => {
    expect(authorKeyOf({ viaToken: 'ci-bot', createdByEmail: 'a@b.com' })).toBe('token:ci-bot')
  })
  it('lowercases email', () => {
    expect(authorKeyOf({ createdByEmail: 'Kabeer@ProCheck.pk' })).toBe('kabeer@procheck.pk')
  })
  it('falls back to name when no email', () => {
    expect(authorKeyOf({ createdByName: 'Kabeer' })).toBe('name:Kabeer')
  })
})

describe('isEntryVisible', () => {
  it('shows everything under All', () => {
    expect(isEntryVisible(me, undefined, live, EMPTY_FILTER)).toBe(true)
    expect(isEntryVisible(me, new Set(['hci']), live, EMPTY_FILTER)).toBe(true)
  })

  it('shows an entry in any selected stream', () => {
    const filter = f({ streams: new Set(['hci']) })
    expect(isEntryVisible(me, new Set(['hci', 'compiler']), live, filter)).toBe(true)
    expect(isEntryVisible(me, new Set(['compiler']), live, filter)).toBe(false)
    expect(isEntryVisible(me, undefined, live, filter)).toBe(false)
  })

  it('shows unfiled entries only when Unsorted is selected', () => {
    expect(isEntryVisible(me, undefined, live, f({ streams: new Set([UNSORTED]) }))).toBe(true)
    expect(isEntryVisible(me, new Set(['hci']), live, f({ streams: new Set([UNSORTED]) }))).toBe(false)
  })

  it('treats links to deleted streams as unfiled', () => {
    const links = new Set(['deleted-stream'])
    expect(isEntryVisible(me, links, live, f({ streams: new Set([UNSORTED]) }))).toBe(true)
    expect(isEntryVisible(me, links, live, f({ streams: new Set(['deleted-stream']) }))).toBe(false)
  })

  it('hides non-matching entries only with onlyMatches on', () => {
    const noMatch = { ...me, matches: false }
    expect(isEntryVisible(noMatch, undefined, live, f({ query: 'x' }))).toBe(true)
    expect(isEntryVisible(noMatch, undefined, live, f({ query: 'x', onlyMatches: true }))).toBe(false)
    expect(isEntryVisible({ ...me, matches: true }, undefined, live, f({ query: 'x', onlyMatches: true }))).toBe(
      true
    )
  })

  it('always shows pinned entries (composer, cursor, just-typed)', () => {
    const filter = f({ streams: new Set(['hci']) })
    expect(isEntryVisible({ ...me, pinned: true }, undefined, live, filter)).toBe(true)
  })
})

describe('countByStream', () => {
  it('counts entries per live stream and skips deleted streams', () => {
    const links = new Map([
      ['e1', new Set(['hci', 'compiler'])],
      ['e2', new Set(['hci'])],
      ['e3', new Set(['gone'])],
    ])
    const counts = countByStream(links, live)
    expect(counts.get('hci')).toBe(2)
    expect(counts.get('compiler')).toBe(1)
    expect(counts.has('gone')).toBe(false)
  })
})

describe('isPristine', () => {
  it('is true only with no narrowing and no active search', () => {
    expect(isPristine(EMPTY_FILTER, false)).toBe(true)
    expect(isPristine(EMPTY_FILTER, true)).toBe(false)
    expect(isPristine(f({ streams: new Set(['hci']) }), false)).toBe(false)
    expect(isPristine(f({ query: 'x', onlyMatches: true }), false)).toBe(false)
    expect(isPristine(f({ query: 'x' }), false)).toBe(true)
  })
})
