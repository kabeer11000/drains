import type { APIRoute } from 'astro'
import { ulid } from 'ulid'
import { requireAuth } from '@/lib/requireAuth'
import {
  provisionDrainDatabase,
  addDirectoryDrain,
  getDirectoryDrains,
  putAdminDoc,
  purgeExpiredTrash,
} from '@/lib/couchdb-admin'

export const prerender = false

// ?trashed=true returns only this caller's own trashed drains (the
// "Recently deleted" view) instead of the normal list. Piggybacks a lazy
// trash sweep onto whichever call happens first — no dedicated background
// job, see couchdb-admin.ts's purgeExpiredTrash.
export const GET: APIRoute = async ({ request, url }) => {
  const caller = await requireAuth(request)
  if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  await purgeExpiredTrash(caller.email).catch(() => {})

  const all = await getDirectoryDrains(caller.email)
  const wantTrashed = url.searchParams.get('trashed') === 'true'
  const drains = all.filter((d) => wantTrashed ? !!d.trashedAt : !d.trashedAt)

  return new Response(JSON.stringify({ drains }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

export const POST: APIRoute = async ({ request }) => {
  const caller = await requireAuth(request)
  if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const body = await request.json().catch(() => ({}))
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Untitled'
  // Always private at creation: a drain becomes shared when someone is
  // invited (syncDrainVisibility), so a requested 'shared' is ignored.
  const visibility = 'private'
  const description = typeof body.description === 'string' ? body.description.trim() || undefined : undefined
  const tags = Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === 'string') : undefined

  const dbName = `drain-${ulid().toLowerCase()}`
  await provisionDrainDatabase(dbName, caller.email)
  await putAdminDoc(dbName, {
    _id: 'notebook',
    type: 'notebook',
    title,
    description,
    tags,
    visibility,
    createdBy: caller.email,
    createdAt: Date.now(),
    createdByTokenName: caller.tokenName,
  })
  await addDirectoryDrain(caller.email, {
    dbName,
    title,
    description,
    tags,
    visibility,
    role: 'owner',
    joinedAt: Date.now(),
    createdByTokenName: caller.tokenName,
  })

  return new Response(JSON.stringify({ dbName }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
