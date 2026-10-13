import { describe, it, expect } from 'vitest'
import { chainFlags, type ChainBlock } from './SummaryGrouping'

const entry = (entryId: string): ChainBlock => ({ entryId, isSummary: false })
const summary = (entryId: string, claims: string[]): ChainBlock => ({ entryId, isSummary: true, claims })

describe('chainFlags', () => {
  it('runs from the summary to its last claimed entry, including unclaimed entries in between', () => {
    // b was added after the day was summarized, so it is not in claims.
    const blocks = [entry('composer'), summary('s', ['a', 'c']), entry('a'), entry('b'), entry('c'), entry('older')]
    expect(chainFlags(blocks)).toEqual([false, true, true, true, true, false])
  })

  it('leaves a summary alone when none of its claimed entries are loaded', () => {
    expect(chainFlags([summary('s', ['gone']), entry('x')])).toEqual([true, false])
  })

  it('never extends upward to claimed entries above the summary', () => {
    expect(chainFlags([entry('a'), summary('s', ['a', 'b']), entry('b')])).toEqual([false, true, true])
  })

  it('joins stacked summaries over the same day into one chain', () => {
    const blocks = [summary('s2', ['a', 'b']), summary('s1', ['a', 'b']), entry('a'), entry('b'), entry('next')]
    expect(chainFlags(blocks)).toEqual([true, true, true, true, false])
  })

  it('keeps separate days separate', () => {
    const blocks = [summary('s1', ['a']), entry('a'), entry('free'), summary('s2', ['b']), entry('b')]
    expect(chainFlags(blocks)).toEqual([true, true, false, true, true])
  })
})
