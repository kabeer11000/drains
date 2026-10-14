import { describe, it, expect } from 'vitest'
import { parseEmbed, bareUrl } from './embeds'

describe('parseEmbed', () => {
  it('turns YouTube URLs into a no-cookie player', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=mfmYb44Goc8',
      'https://youtu.be/mfmYb44Goc8',
      'https://youtube.com/shorts/mfmYb44Goc8',
      'https://m.youtube.com/watch?v=mfmYb44Goc8&list=x',
    ]) {
      expect(parseEmbed(url)).toMatchObject({ kind: 'youtube', src: 'https://www.youtube-nocookie.com/embed/mfmYb44Goc8' })
    }
    expect(parseEmbed('https://youtu.be/mfmYb44Goc8?t=90')?.src).toBe('https://www.youtube-nocookie.com/embed/mfmYb44Goc8?start=90')
  })

  it('rejects malformed YouTube ids instead of building a player from them', () => {
    expect(parseEmbed('https://www.youtube.com/watch?v="><script>')).toMatchObject({ kind: 'link' })
  })

  it('handles Vimeo, Loom and Figma', () => {
    expect(parseEmbed('https://vimeo.com/76979871')?.src).toBe('https://player.vimeo.com/video/76979871')
    expect(parseEmbed('https://www.loom.com/share/0123456789abcdef0123456789abcdef')?.src).toBe(
      'https://www.loom.com/embed/0123456789abcdef0123456789abcdef'
    )
    const figma = parseEmbed('https://www.figma.com/design/abc123/My-File')
    expect(figma?.kind).toBe('figma')
    expect(figma?.src).toContain('https://www.figma.com/embed?embed_host=drains&url=')
  })

  it('falls back to a link card for other http(s) URLs', () => {
    expect(parseEmbed('https://brownhistory.substack.com/p/x')).toEqual({ kind: 'link', url: 'https://brownhistory.substack.com/p/x' })
  })

  it('refuses non-http schemes', () => {
    expect(parseEmbed('javascript:alert(1)')).toBeNull()
    expect(parseEmbed('data:text/html,hi')).toBeNull()
    expect(parseEmbed('not a url')).toBeNull()
  })
})

describe('bareUrl', () => {
  it('accepts exactly one URL, surrounding whitespace allowed', () => {
    expect(bareUrl('  https://x.dev/a  ')).toBe('https://x.dev/a')
  })
  it('rejects text with a URL in it', () => {
    expect(bareUrl('see https://x.dev')).toBeNull()
    expect(bareUrl('https://x.dev https://y.dev')).toBeNull()
  })
})
