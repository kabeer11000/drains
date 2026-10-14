import type { APIRoute } from 'astro'
import { getAdminDoc, getPublicEntries } from '@/lib/couchdb-admin'
import { stripHtmlTags } from '@/lib/htmlEscape'

export const prerender = false

// The "What's new" drain is an ordinary published drain; a `whatsnew` doc in
// the directory database points at it, so moving or replacing it is a data
// change, not a deploy. Public: it only exposes what /p/<token> already does.
export const GET: APIRoute = async () => {
  const pointer = await getAdminDoc('directory', 'whatsnew').catch(() => null)
  if (!pointer?.dbName || !pointer?.token) {
    return new Response(JSON.stringify({ whatsNew: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const latest = (await getPublicEntries(pointer.dbName).catch(() => []))[0]
  const snippet = latest ? stripHtmlTags(latest.content).replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim().slice(0, 120) : ''
  return new Response(
    JSON.stringify({ whatsNew: { url: `/p/${pointer.token}`, latestAt: latest?.createdAt ?? 0, snippet } }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } }
  )
}
