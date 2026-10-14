import { describe, it, expect } from 'vitest'
import { sanitizeEntryHtml } from './sanitizeServer'

describe('sanitizeEntryHtml', () => {
  it('strips scripts, event handlers and javascript: links', () => {
    const out = sanitizeEntryHtml(
      '<p onclick="steal()">hi<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a></p>'
    )
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|<img/i)
    expect(out).toContain('hi')
  })

  it('keeps the formatting the editor produces', () => {
    const html = '<p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>c</code> <mark>m</mark></p>'
    expect(sanitizeEntryHtml(html)).toBe(html)
  })

  it('keeps mention colours but drops other inline styles', () => {
    const out = sanitizeEntryHtml('<span data-type="mention" style="color: #ff0000; position: fixed; inset: 0">@k</span>')
    expect(out).toContain('color:#ff0000')
    expect(out).not.toContain('position')
  })

  it('forces safe link attributes', () => {
    expect(sanitizeEntryHtml('<a href="https://x.dev">x</a>')).toBe(
      '<a href="https://x.dev" rel="noopener noreferrer nofollow" target="_blank">x</a>'
    )
  })
})
