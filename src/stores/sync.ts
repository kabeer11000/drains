import { map } from 'nanostores'

// Per-drain sync state (keyed by dbName) — several drains can sync at once,
// and one drain's error must never show up on another drain's page.
//
// status:   connecting -> syncing <-> synced, or offline / error
// problem:  why it's an error — 'no-access' is the server refusing this
//           drain outright (401/403/404: not a member, or it doesn't exist),
//           which retrying will never fix.
// rejected: individual changes the server refused (validate_doc_update,
//           e.g. editing someone else's entry). Sync keeps going, but those
//           edits only exist on this device.
export interface SyncState {
  status: 'connecting' | 'syncing' | 'synced' | 'offline' | 'error'
  problem?: 'no-access' | 'unknown'
  rejected: number
  lastRejectReason?: string
  updatedAt: number
}

export const $sync = map<Record<string, SyncState>>({})

export function syncStateOf(dbName: string): SyncState {
  return $sync.get()[dbName] ?? { status: 'connecting', rejected: 0, updatedAt: Date.now() }
}

export function patchSyncState(dbName: string, patch: Partial<SyncState>) {
  $sync.setKey(dbName, { ...syncStateOf(dbName), ...patch, updatedAt: Date.now() })
}
