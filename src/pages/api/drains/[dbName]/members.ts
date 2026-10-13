import type { APIRoute } from 'astro'
import { requireAuth } from '@/lib/requireAuth'
import {
  getDirectoryDrains,
  getDrainMembers,
  removeDrainMember,
  removeDirectoryDrain,
  syncDrainVisibility,
} from '@/lib/couchdb-admin'

export const prerender = false

export const GET: APIRoute = async ({ request, params }) => {
  const caller = await requireAuth(request)
  if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const dbName = params.dbName!

  const drains = await getDirectoryDrains(caller.email)
  if (!drains.some((d) => d.dbName === dbName)) {
    return new Response(JSON.stringify({ error: 'Not a member of this drain' }), { status: 403 })
  }

  const members = await getDrainMembers(dbName)
  return new Response(JSON.stringify({ members }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

export const DELETE: APIRoute = async ({ request, params }) => {
  const caller = await requireAuth(request)
  if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const dbName = params.dbName!

  const drains = await getDirectoryDrains(caller.email)
  const mine = drains.find((d) => d.dbName === dbName)
  if (!mine || mine.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'Only the owner can remove members' }), { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email) return new Response(JSON.stringify({ error: 'Email is required' }), { status: 400 })
  if (email === caller.email) {
    return new Response(JSON.stringify({ error: "The owner can't remove themselves — delete the drain instead" }), {
      status: 400,
    })
  }

  await removeDrainMember(dbName, email)
  await removeDirectoryDrain(email, dbName)
  // Removing the last other person turns it back into a private drain.
  await syncDrainVisibility(dbName)

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
