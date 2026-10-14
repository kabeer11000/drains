import { describe, it, expect } from 'vitest'
import { chooseGranularity, thinTicks, itemAt, bubbleLabel, unitKey } from './scrubber'

const DAY = 86_400_000
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime()

describe('chooseGranularity', () => {
  it('picks day, month or year from the span', () => {
    expect(chooseGranularity([at(2026, 9, 14), at(2026, 9, 1)])).toBe('day')
    expect(chooseGranularity([at(2026, 9, 14), at(2026, 1, 1)])).toBe('month')
    expect(chooseGranularity([at(2026, 9, 14), at(2023, 1, 1)])).toBe('year')
    expect(chooseGranularity([at(2026, 9, 14)])).toBe('day')
  })
})

describe('thinTicks', () => {
  const ticks = [
    { y: 100, label: 'Oct' },
    { y: 110, label: 'Sep' },
    { y: 600, label: 'Aug' },
  ]
  it('drops ticks that would collide on the rail', () => {
    expect(thinTicks(ticks, 1000, 500).map((t) => t.label)).toEqual(['Oct', 'Aug'])
  })
  it('keeps everything on a tall rail', () => {
    expect(thinTicks(ticks, 1000, 5000).map((t) => t.label)).toEqual(['Oct', 'Sep', 'Aug'])
  })
  it('is empty without geometry', () => {
    expect(thinTicks(ticks, 0, 500)).toEqual([])
  })
})

describe('itemAt', () => {
  const tops = [0, 100, 250, 400]
  it('finds the item covering a content offset', () => {
    expect(itemAt(tops, 0)).toBe(0)
    expect(itemAt(tops, 99)).toBe(0)
    expect(itemAt(tops, 100)).toBe(1)
    expect(itemAt(tops, 399)).toBe(2)
    expect(itemAt(tops, 9999)).toBe(3)
    expect(itemAt([], 5)).toBe(-1)
  })
})

describe('labels', () => {
  it('names today and yesterday', () => {
    const now = at(2026, 9, 14, 15)
    expect(bubbleLabel(at(2026, 9, 14, 9), now)).toBe('Today')
    expect(bubbleLabel(now - DAY, now)).toBe('Yesterday')
  })
  it('keys units consistently', () => {
    expect(unitKey(at(2026, 9, 14), 'year')).toBe('2026')
    expect(unitKey(at(2026, 9, 14, 1), 'day')).toBe(unitKey(at(2026, 9, 14, 23), 'day'))
  })
})
