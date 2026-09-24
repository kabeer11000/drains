import type { APIRoute } from 'astro'
import { requireAuth } from '@/lib/requireAuth'
import { getDirectoryDrains, getRecentEntryChanges } from '@/lib/couchdb-admin'
import { stripHtmlTags } from '@/lib/htmlEscape'
import type { ActivityItem } from '@/services/drainsApi'

export const prerender = false

const PER_DRAIN_LIMIT = 8
const SHOWN = 8

// Sidebar "Recent Activity" — read server-side from each drain's CouchDB
// changes feed rather than the browser's local PouchDB copies, because the
// client only live-syncs the drain currently open (SyncIndicator), so local
// copies of every other drain are frozen at the last visit. The changes feed
// is also ordered by last modification, so an edit to an old entry counts as
// recent activity (sorting the newest-created entries by updatedAt missed it).
export const GET: APIRoute = async ({ request }) => {
  const caller = await requireAuth(request)
  if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const me = caller.email.toLowerCase()
  const drains = (await getDirectoryDrains(caller.email)).filter((d) => !d.trashedAt)

  const groups = await Promise.all(
    drains.map(async (drain) => {
      // One unreachable drain shouldn't blank the whole list.
      const docs = await getRecentEntryChanges(drain.dbName, PER_DRAIN_LIMIT).catch(() => [])
      return docs.map((doc: any): ActivityItem => ({
        dbName: drain.dbName,
        drainTitle: drain.title || 'Untitled',
        entryId: doc._id.slice('entry:'.length),
        snippet: stripHtmlTags(doc.content ?? '').slice(0, 100),
        timestamp: doc.updatedAt || doc.createdAt || 0,
        authorName: doc.updatedByName || doc.createdByName || '',
        byMe: (doc.updatedByEmail || doc.createdByEmail || '').toLowerCase() === me,
        mentionsMe: (doc.content ?? '').toLowerCase().includes(`data-id="${me}"`),
      }))
    })
  )

  const items = groups
    .flat()
    .filter((item) => item.snippet)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, SHOWN)

  return new Response(JSON.stringify({ items }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
