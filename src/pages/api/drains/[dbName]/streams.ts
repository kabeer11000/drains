import type { APIRoute } from 'astro'
import { requireAuth } from '@/lib/requireAuth'
import { getDirectoryDrains, getStreamIndex } from '@/lib/couchdb-admin'

export const prerender = false

// GET — the drain's streams with entry counts, for agents choosing where to
// file (MCP list_streams).
export const GET: APIRoute = async ({ request, params }) => {
  const caller = await requireAuth(request)
  if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const dbName = params.dbName!
  const drains = await getDirectoryDrains(caller.email)
  if (!drains.some((d) => d.dbName === dbName)) {
    return new Response(JSON.stringify({ error: 'Not a member of this drain' }), { status: 403 })
  }

  const { streams, byEntry } = await getStreamIndex(dbName)
  const counts = new Map<string, number>()
  for (const list of byEntry.values()) for (const s of list) counts.set(s.slug, (counts.get(s.slug) ?? 0) + 1)

  return new Response(
    JSON.stringify({ streams: streams.map((s) => ({ ...s, entries: counts.get(s.slug) ?? 0 })) }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}
