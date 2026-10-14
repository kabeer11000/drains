import { describe, it, expect } from 'vitest'
import { daysFromIds } from './utils'

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ulidAt = (t: number) => { let s = ''; for (let i = 0; i < 10; i++) { s = B32[t % 32] + s; t = Math.floor(t / 32) } return s + 'A'.repeat(16) }
const at = (y: number, m: number, d: number, h: number) => ulidAt(new Date(y, m, d, h).getTime())

describe('daysFromIds', () => {
  it('groups newest-first ids by local day, first id is the jump target', () => {
    const ids = [at(2026, 9, 14, 18), at(2026, 9, 14, 9), at(2026, 9, 12, 20), at(2026, 9, 12, 8)]
    const days = daysFromIds(ids)
    expect(days.map((d) => d.entryIds.length)).toEqual([2, 2])
    expect(days[0].entryId).toBe(ids[0])
    expect(days[1].entryId).toBe(ids[2])
  })
  it('skips ids that are not ULIDs', () => {
    expect(daysFromIds(['not-a-ulid'])).toEqual([])
  })
})
