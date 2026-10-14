import { describe, it, expect } from 'vitest'
import { excerptOf, EXCERPT_CHARS } from './QuoteExtension'

describe('excerptOf', () => {
  it('collapses whitespace', () => {
    expect(excerptOf('  a\n\n b  ')).toBe('a b')
  })
  it('cuts long text with an ellipsis at the limit', () => {
    const out = excerptOf('x'.repeat(500))
    expect(out.length).toBe(EXCERPT_CHARS)
    expect(out.endsWith('…')).toBe(true)
  })
})
