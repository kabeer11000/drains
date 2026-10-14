import { describe, it, expect } from 'vitest'
import { splitStreams } from './aiStreams'

describe('splitStreams', () => {
  it('pulls a trailing STREAMS line out of the answer', () => {
    expect(splitStreams('Fix the parser bug\nSTREAMS: Compiler, #HCI, compiler')).toEqual({
      text: 'Fix the parser bug',
      streams: ['Compiler', 'HCI'],
    })
  })
  it('leaves answers without the line alone', () => {
    expect(splitStreams('just text\nmore')).toEqual({ text: 'just text\nmore', streams: [] })
  })
  it('is case-insensitive, trims punctuation and caps at five', () => {
    expect(splitStreams('x\nstreams: a, b, c, d, e, f.').streams).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})
