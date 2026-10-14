import type { DirectoryDrainEntry } from '@/lib/couchdb-admin'
import { authHeader, parseErrorOr } from './apiAuth'

export async function fetchDrains(): Promise<DirectoryDrainEntry[]> {
  const res = await fetch('/api/drains', { headers: { Authorization: authHeader() } })
  const data = await parseErrorOr<{ drains: DirectoryDrainEntry[] }>(res, 'Failed to load drains')
  return data.drains
}

export async function fetchTrashedDrains(): Promise<DirectoryDrainEntry[]> {
  const res = await fetch('/api/drains?trashed=true', { headers: { Authorization: authHeader() } })
  const data = await parseErrorOr<{ drains: DirectoryDrainEntry[] }>(res, 'Failed to load trash')
  return data.drains
}

export async function createDrain(
  title: string,
  visibility: 'private' | 'shared',
  description?: string,
  tags?: string[]
): Promise<{ dbName: string }> {
  const res = await fetch('/api/drains', {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, visibility, description, tags }),
  })
  return parseErrorOr(res, 'Failed to create drain')
}

// Soft-delete — see couchdb-admin.ts's trashDrain. Moves it to trash,
// doesn't touch the underlying data at all.
export async function deleteDrainApi(dbName: string): Promise<void> {
  const res = await fetch(`/api/drains/${dbName}`, {
    method: 'DELETE',
    headers: { Authorization: authHeader() },
  })
  await parseErrorOr(res, 'Failed to delete drain')
}

export async function restoreDrainApi(dbName: string): Promise<void> {
  const res = await fetch(`/api/drains/${dbName}/restore`, {
    method: 'POST',
    headers: { Authorization: authHeader() },
  })
  await parseErrorOr(res, 'Failed to restore drain')
}

// The explicit "delete forever, right now" action — only works on a drain
// already in trash.
export async function purgeDrainApi(dbName: string): Promise<void> {
  const res = await fetch(`/api/drains/${dbName}/purge`, {
    method: 'DELETE',
    headers: { Authorization: authHeader() },
  })
  await parseErrorOr(res, 'Failed to permanently delete drain')
}

export async function updateDrainApi(
  dbName: string,
  meta: { title?: string; description?: string; tags?: string[] }
): Promise<void> {
  const res = await fetch(`/api/drains/${dbName}`, {
    method: 'PATCH',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  })
  await parseErrorOr(res, 'Failed to update drain')
}

export async function inviteToDrain(dbName: string, email: string): Promise<void> {
  membersCache.delete(dbName)
  const res = await fetch(`/api/drains/${dbName}/invite`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  await parseErrorOr(res, 'Failed to invite')
}

// Every sidebar card and the title chip asked for their drain's members on
// each navigation (islands remount), one request per shared drain. Shared
// for a minute; invite/remove clear the drain's entry.
const MEMBERS_TTL_MS = 60_000
const membersCache = new Map<string, { at: number; members: Promise<string[]> }>()

export function listDrainMembers(dbName: string): Promise<string[]> {
  const hit = membersCache.get(dbName)
  if (hit && Date.now() - hit.at < MEMBERS_TTL_MS) return hit.members
  const members = fetch(`/api/drains/${dbName}/members`, { headers: { Authorization: authHeader() } })
    .then((res) => parseErrorOr<{ members: string[] }>(res, 'Failed to load members'))
    .then((data) => data.members)
  membersCache.set(dbName, { at: Date.now(), members })
  members.catch(() => membersCache.delete(dbName))
  return members
}

export async function removeDrainMemberApi(dbName: string, email: string): Promise<void> {
  membersCache.delete(dbName)
  const res = await fetch(`/api/drains/${dbName}/members`, {
    method: 'DELETE',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  await parseErrorOr(res, 'Failed to remove member')
}

export async function getPublishStatus(dbName: string): Promise<{ token: string | null }> {
  const res = await fetch(`/api/drains/${dbName}/publish`, { headers: { Authorization: authHeader() } })
  return parseErrorOr(res, 'Failed to load publish status')
}

export async function publishDrain(dbName: string): Promise<{ token: string }> {
  const res = await fetch(`/api/drains/${dbName}/publish`, {
    method: 'POST',
    headers: { Authorization: authHeader() },
  })
  return parseErrorOr(res, 'Failed to publish drain')
}

export async function unpublishDrain(dbName: string): Promise<void> {
  const res = await fetch(`/api/drains/${dbName}/publish`, {
    method: 'DELETE',
    headers: { Authorization: authHeader() },
  })
  await parseErrorOr(res, 'Failed to unpublish drain')
}

export async function getIngestionStatus(dbName: string): Promise<{ token: string; lastIngestedAt: number | null }> {
  const res = await fetch(`/api/drains/${dbName}/ingestion`, { headers: { Authorization: authHeader() } })
  return parseErrorOr(res, 'Failed to load integration status')
}

export async function regenerateIngestionToken(dbName: string): Promise<{ token: string }> {
  const res = await fetch(`/api/drains/${dbName}/ingestion`, {
    method: 'POST',
    headers: { Authorization: authHeader() },
  })
  return parseErrorOr(res, 'Failed to regenerate ingestion token')
}

export interface ActivityItem {
  dbName: string
  drainTitle: string
  entryId: string
  snippet: string
  timestamp: number
  authorName: string
  byMe: boolean
  mentionsMe: boolean
}

export async function fetchActivity(): Promise<ActivityItem[]> {
  const res = await fetch('/api/activity', { headers: { Authorization: authHeader() } })
  const data = await parseErrorOr<{ items: ActivityItem[] }>(res, 'Failed to load activity')
  return data.items
}
