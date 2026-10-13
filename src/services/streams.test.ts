import { describe, it, expect } from 'vitest'
import { slugify, applyLinkChange } from './streams'

// PouchDB-backed functions (createStream, linkEntry, watchStreams, etc.)
// are not tested here: pouchdb-adapter-memory isn't installed in
// node_modules, and adding a new dependency just for tests goes against
// the "don't add deps" instruction for this phase. Only the pure helpers
// (slugify, applyLinkChange) are covered.

describe('slugify', () => {
  it('lowercases and joins words with dashes', () => {
    expect(slugify('HCI')).toBe('hci')
    expect(slugify('Reading / Viewing')).toBe('reading-viewing')
  })
  it('collapses repeated punctuation into one dash', () => {
    expect(slugify('foo---bar')).toBe('foo-bar')
    expect(slugify('a!!  b')).toBe('a-b')
  })
  it('strips leading/trailing dashes', () => {
    expect(slugify('  -HCI- ')).toBe('hci')
  })
  it('keeps unicode letters instead of stripping them to ascii', () => {
    expect(slugify('Café')).toBe('café')
  })
  it('falls back to "stream" for an empty result', () => {
    expect(slugify('')).toBe('stream')
    expect(slugify('   ')).toBe('stream')
    expect(slugify('!!!')).toBe('stream')
  })
})

describe('applyLinkChange', () => {
  it('adds a link from the doc body', () => {
    const map = new Map<string, Set<string>>()
    applyLinkChange(map, {
      id: 'streamlink:entry1:hci',
      deleted: false,
      doc: { _id: 'streamlink:entry1:hci', type: 'streamlink', entryId: 'entry1', streamId: 'hci', createdByEmail: 'a@b.com', createdAt: 1 },
    })
    expect(map.get('entry1')).toEqual(new Set(['hci']))
  })

  it('removes a link using the doc body when present', () => {
    const map = new Map<string, Set<string>>([['entry1', new Set(['hci', 'procheck'])]])
    applyLinkChange(map, {
      id: 'streamlink:entry1:hci',
      deleted: true,
      doc: { _id: 'streamlink:entry1:hci', type: 'streamlink', entryId: 'entry1', streamId: 'hci', createdByEmail: 'a@b.com', createdAt: 1 },
    })
    expect(map.get('entry1')).toEqual(new Set(['procheck']))
  })

  it('drops the map entry once its set is empty', () => {
    const map = new Map<string, Set<string>>([['entry1', new Set(['hci'])]])
    applyLinkChange(map, {
      id: 'streamlink:entry1:hci',
      deleted: true,
      doc: { _id: 'streamlink:entry1:hci', type: 'streamlink', entryId: 'entry1', streamId: 'hci', createdByEmail: 'a@b.com', createdAt: 1 },
    })
    expect(map.has('entry1')).toBe(false)
  })

  it('falls back to parsing the id (last colon) when the doc body is gone', () => {
    const map = new Map<string, Set<string>>([['weird:entry:id', new Set(['hci'])]])
    applyLinkChange(map, { id: 'streamlink:weird:entry:id:hci', deleted: true })
    expect(map.has('weird:entry:id')).toBe(false)
  })
})
