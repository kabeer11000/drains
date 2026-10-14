import type { APIRoute } from 'astro'
import { lookup } from 'node:dns/promises'
import { requireAuth } from '@/lib/requireAuth'
import { isPrivateAddress, parsePreview, type LinkPreview } from '@/lib/unfurl'

export const prerender = false

const TIMEOUT_MS = 5000
const MAX_BYTES = 512 * 1024
const MAX_REDIRECTS = 3
const CACHE_LIMIT = 500

// ponytail: per-instance memory cache; a shared KV cache if previews get hot.
const cache = new Map<string, LinkPreview | null>()

async function assertPublicHost(url: URL) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http(s) URLs')
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('Port not allowed')
  const addresses = await lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error('Address not allowed')
}

// Follows redirects by hand so every hop is re-checked against private
// addresses — fetch's own redirect handling would follow a public URL that
// 302s to 169.254.169.254 without asking.
async function fetchPage(start: string): Promise<{ url: string; html: string } | null> {
  let url = new URL(start)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url)
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'DrainsBot/1.0 (+https://drains.dev)', Accept: 'text/html,application/xhtml+xml' },
    })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url)
      continue
    }
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html') || !res.body) return null
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
    }
    reader.cancel().catch(() => {})
    return { url: url.toString(), html: new TextDecoder().decode(Buffer.concat(chunks)) }
  }
  return null
}

// GET ?url= — link preview (title, description, image) for an embed card.
// Signed-in only, so it can't be used as an anonymous fetch proxy.
export const GET: APIRoute = async ({ request, url }) => {
  if (!(await requireAuth(request))) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const target = url.searchParams.get('url') ?? ''
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=86400' }

  if (cache.has(target)) return new Response(JSON.stringify({ preview: cache.get(target) }), { status: 200, headers })

  let preview: LinkPreview | null = null
  try {
    const page = await fetchPage(target)
    preview = page ? parsePreview(page.html, page.url) : null
  } catch {
    preview = null
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(target, preview)
  return new Response(JSON.stringify({ preview }), { status: 200, headers })
}
