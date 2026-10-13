import { describe, it, expect } from 'vitest'
import { parseQuery, isEmptyQuery, matchesEntry, matchRanges, snippet, type SearchableEntry } from './search'

const entry = (over: Partial<SearchableEntry> = {}): SearchableEntry => ({
  text: 'Activity of Left recursion elimination',
  streams: ['compiler-construction', 'compiler construction'],
  authorName: 'Kabeer',
  authorKey: 'kabeer@procheck.pk',
  source: null,
  viaToken: null,
  done: false,
  ...over,
})

describe('parseQuery', () => {
  it('splits words, operators and quoted phrases', () => {
    expect(parseQuery('Left "Dragon Book" #HCI @kab from:github is:done')).toEqual({
      terms: ['left', 'dragon book'],
      streams: ['hci'],
      authors: ['kab'],
      from: ['github'],
      done: true,
    })
  })
  it('treats a lone # or @ as plain text, not an operator', () => {
    expect(parseQuery('# @').terms).toEqual(['#', '@'])
  })
  it('accepts an unclosed quote while typing', () => {
    expect(parseQuery('"left rec').terms).toEqual(['left rec'])
  })
  it('is empty for whitespace', () => {
    expect(isEmptyQuery(parseQuery('   '))).toBe(true)
    expect(isEmptyQuery(parseQuery('is:open'))).toBe(false)
  })
})

describe('matchesEntry', () => {
  it('requires every term (AND), case-insensitively', () => {
    expect(matchesEntry(entry(), parseQuery('LEFT elimination'))).toBe(true)
    expect(matchesEntry(entry(), parseQuery('left parsing'))).toBe(false)
  })
  it('matches phrases as a unit', () => {
    expect(matchesEntry(entry(), parseQuery('"left recursion"'))).toBe(true)
    expect(matchesEntry(entry(), parseQuery('"recursion left"'))).toBe(false)
  })
  it('matches streams by partial name or slug', () => {
    expect(matchesEntry(entry(), parseQuery('#compiler'))).toBe(true)
    expect(matchesEntry(entry(), parseQuery('#hci'))).toBe(false)
    expect(matchesEntry(entry({ streams: [] }), parseQuery('#compiler'))).toBe(false)
  })
  it('matches authors by name or email', () => {
    expect(matchesEntry(entry(), parseQuery('@kab'))).toBe(true)
    expect(matchesEntry(entry(), parseQuery('@procheck'))).toBe(true)
    expect(matchesEntry(entry(), parseQuery('@dana'))).toBe(false)
  })
  it('matches from: sources', () => {
    expect(matchesEntry(entry({ source: 'github' }), parseQuery('from:github'))).toBe(true)
    expect(matchesEntry(entry({ source: 'ai-summary' }), parseQuery('from:ai'))).toBe(true)
    expect(matchesEntry(entry({ viaToken: 'claude' }), parseQuery('from:agent'))).toBe(true)
    expect(matchesEntry(entry({ viaToken: 'claude' }), parseQuery('from:claude'))).toBe(true)
    expect(matchesEntry(entry(), parseQuery('from:github'))).toBe(false)
  })
  it('matches done state', () => {
    expect(matchesEntry(entry({ done: true }), parseQuery('is:done'))).toBe(true)
    expect(matchesEntry(entry({ done: true }), parseQuery('is:open'))).toBe(false)
  })
})

describe('matchRanges', () => {
  it('finds every occurrence and merges overlaps', () => {
    expect(matchRanges('abc abc', ['abc'])).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
    ])
    expect(matchRanges('Left recursion', ['left', 'left rec'])).toEqual([{ from: 0, to: 8 }])
  })
  it('is case-insensitive', () => {
    expect(matchRanges('LEFT', ['left'])).toEqual([{ from: 0, to: 4 }])
  })
})

describe('snippet', () => {
  it('marks hit parts', () => {
    const text = 'Activity of Left recursion elimination'
    expect(snippet(text, matchRanges(text, ['left']))).toEqual([
      { text: 'Activity of ', hit: false },
      { text: 'Left', hit: true },
      { text: ' recursion elimination', hit: false },
    ])
  })
  it('adds ellipses when trimming long text', () => {
    const text = `${'x'.repeat(100)}needle${'y'.repeat(200)}`
    const parts = snippet(text, matchRanges(text, ['needle']), 10)
    expect(parts[0]).toEqual({ text: '…', hit: false })
    expect(parts.find((p) => p.hit)?.text).toBe('needle')
    expect(parts[parts.length - 1]).toEqual({ text: '…', hit: false })
  })
})
