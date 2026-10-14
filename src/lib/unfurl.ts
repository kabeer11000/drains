// Pure helpers for /api/unfurl: private-address checks (SSRF guard) and
// pulling preview metadata out of a page's <head>.

export interface LinkPreview {
  url: string
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
}

// Loopback, private, link-local, CGNAT, multicast/reserved, and their IPv6
// equivalents (incl. IPv4-mapped). The server must never fetch these on a
// user's behalf: that's how an unfurler gets turned into a way to reach
// internal services or cloud metadata (169.254.169.254).
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    )
  }
  const v6 = ip.toLowerCase()
  return (
    v6 === '::' || v6 === '::1' ||
    v6.startsWith('fc') || v6.startsWith('fd') || // unique local
    v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || // link-local
    v6.startsWith('ff') // multicast
  )
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }
function decode(s: string) {
  return s
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim()
}

function meta(html: string, keys: string[]): string | null {
  for (const key of keys) {
    // property/name before or after content, single or double quotes.
    const a = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html)
    const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i').exec(html)
    const v = a?.[1] ?? b?.[1]
    if (v && v.trim()) return decode(v)
  }
  return null
}

export function parsePreview(html: string, pageUrl: string): LinkPreview {
  const head = html.slice(0, 200_000)
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1]
  const title = meta(head, ['og:title', 'twitter:title']) ?? (titleTag ? decode(titleTag) || null : null)
  const rawImage = meta(head, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src'])
  let image: string | null = null
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, pageUrl)
      image = resolved.protocol === 'https:' || resolved.protocol === 'http:' ? resolved.toString() : null
    } catch {}
  }
  return {
    url: pageUrl,
    title: title ? title.slice(0, 300) : null,
    description: meta(head, ['og:description', 'twitter:description', 'description'])?.slice(0, 500) ?? null,
    image,
    siteName: meta(head, ['og:site_name']) ?? new URL(pageUrl).hostname.replace(/^www\./, ''),
  }
}
