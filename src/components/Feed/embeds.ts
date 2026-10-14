// Which URLs embed as a player, and the player URL to load for each. Pure,
// so the editor node view and the tests share it. The stored entry only ever
// holds the original URL; the iframe src is always rebuilt from it here, so
// nothing a user can type becomes an arbitrary iframe.

export type EmbedKind = 'youtube' | 'vimeo' | 'loom' | 'figma' | 'link'

export interface Embed {
  kind: EmbedKind
  url: string
  // Player URL for iframe kinds; absent for plain link cards.
  src?: string
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

export function parseEmbed(raw: string): Embed | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const url = u.toString()
  const host = u.hostname.replace(/^www\.|^m\./, '')

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    let id: string | null = null
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0]
    else if (u.pathname === '/watch') id = u.searchParams.get('v')
    else {
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)
      if (m) id = m[1]
    }
    if (id && YOUTUBE_ID.test(id)) {
      const start = Number.parseInt(u.searchParams.get('t') ?? u.searchParams.get('start') ?? '', 10)
      const query = Number.isFinite(start) && start > 0 ? `?start=${start}` : ''
      return { kind: 'youtube', url, src: `https://www.youtube-nocookie.com/embed/${id}${query}` }
    }
  }

  if (host === 'vimeo.com') {
    const m = u.pathname.match(/^\/(\d+)(?:\/([a-f0-9]+))?/)
    if (m) return { kind: 'vimeo', url, src: `https://player.vimeo.com/video/${m[1]}${m[2] ? `?h=${m[2]}` : ''}` }
  }

  if (host === 'loom.com') {
    const m = u.pathname.match(/^\/(?:share|embed)\/([a-f0-9]{20,})/)
    if (m) return { kind: 'loom', url, src: `https://www.loom.com/embed/${m[1]}` }
  }

  if (host === 'figma.com' && /^\/(?:file|design|proto|board)\//.test(u.pathname)) {
    return { kind: 'figma', url, src: `https://www.figma.com/embed?embed_host=drains&url=${encodeURIComponent(url)}` }
  }

  return { kind: 'link', url }
}

// A paste that's nothing but one URL — the only thing that becomes an embed.
export function bareUrl(text: string): string | null {
  const t = text.trim()
  if (!t || /\s/.test(t)) return null
  const e = parseEmbed(t)
  return e ? e.url : null
}
