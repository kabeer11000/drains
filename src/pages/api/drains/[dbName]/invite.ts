import type { APIRoute } from 'astro'
import { requireAuth } from '@/lib/requireAuth'
import { getDirectoryDrains, addDrainMember, addDirectoryDrain, getAdminDoc, syncDrainVisibility } from '@/lib/couchdb-admin'

export const prerender = false

export const POST: APIRoute = async ({ request, params }) => {
  const caller = await requireAuth(request)
  if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const dbName = params.dbName!

  const drains = await getDirectoryDrains(caller.email)
  const mine = drains.find((d) => d.dbName === dbName)
  if (!mine || mine.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'Only the owner can invite people to this drain' }), { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'Enter a valid email address' }), { status: 400 })
  }
  if (email === caller.email) {
    return new Response(JSON.stringify({ error: "You're already the owner" }), { status: 400 })
  }

  const inviteeDrains = await getDirectoryDrains(email)
  if (inviteeDrains.some((d) => d.dbName === dbName)) {
    return new Response(JSON.stringify({ error: 'Already invited' }), { status: 409 })
  }

  const notebook = await getAdminDoc(dbName, 'notebook')
  await addDrainMember(dbName, email)
  await addDirectoryDrain(email, {
    dbName,
    title: notebook?.title ?? 'Untitled',
    visibility: 'shared',
    role: 'member',
    joinedAt: Date.now(),
  })
  // A private drain becomes shared the moment someone else is in it.
  await syncDrainVisibility(dbName)

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
