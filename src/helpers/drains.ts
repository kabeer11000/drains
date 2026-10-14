import { atom } from 'nanostores'
import { ulid } from 'ulid'
import { getDrainDb } from '@/services/db'
import { startDrainSync } from '@/services/sync'
import { createEntry, type EntryIdentity } from '@/services/entries'
import { fetchDrains, createDrain, deleteDrainApi, updateDrainApi } from '@/services/drainsApi'

export const $drains = atom<any[]>([])

// Real-time cross-device updates to the drain list aren't wired up (the
// list now comes from the server-side directory, not a synced database —
// see services/drainsApi.ts) — a plain refetch on mount is good enough for
// now; the drain grid isn't something that needs to update live in the
// background the way an open feed does.
//
// AppSidebar remounts on every navigation (no transition:persist) and calls
// this on mount, so an outgoing page's still-in-flight call can resolve
// after an incoming page's fresher one — a sequence counter, not just
// "await and set", so a stale response can never overwrite a newer one
// regardless of which resolves last.
let populateDrainsSeq = 0
export const populateDrains = async () => {
    const seq = ++populateDrainsSeq
    const drains = await fetchDrains()
    if (seq === populateDrainsSeq) $drains.set(drains)
}

export async function deleteDrain(dbName: string) {
    await deleteDrainApi(dbName)
    $drains.set($drains.get().filter((d: any) => d.dbName !== dbName))
}

export async function updateDrainMeta(dbName: string, title: string, description?: string, tags?: string[]) {
    await updateDrainApi(dbName, { title, description, tags })
    $drains.set($drains.get().map((d: any) => (d.dbName === dbName ? { ...d, title, description, tags } : d)))
}

// Top-to-bottom reading order. The feed shows newest first, so these are
// written in reverse below to land in this order.
const GETTING_STARTED_LINES = [
    '<p>Welcome to Drains — this is your own private drain, just for you.</p>',
    '<p>Click anywhere below and start typing. Every line is its own entry and <strong>autosaves</strong> as you go — no save button.</p>',
    '<p>Type <strong>#</strong> to file an entry into a <strong>stream</strong>, a topic inside this drain. Pick one, or type a new name and choose Create.</p>',
    '<p>Open a stream from the left sidebar (on a phone, from the chips at the top). New entries you write there are filed into it automatically.</p>',
    '<p>Press <strong>Ctrl/⌘ K</strong> to search. Narrow it with <strong>#stream</strong>, <strong>@person</strong> or <strong>is:done</strong>.</p>',
    '<p>Select some text and a "Comment" button will appear — leave a note on it, like Google Docs. The <strong>⋯</strong> on any entry shows its details and comments.</p>',
    '<p>This drain is private: only you can read or write it. Open its settings (the ✎ next to its name) to invite people, or to publish a read-only link.</p>',
]

// Called once at signup (see Onboarding.tsx) so a brand-new account isn't
// just an empty sidebar.
export async function createGettingStartedDrain(identity: EntryIdentity) {
    const { dbName } = await createDrain('Getting started', 'private')

    const localDb = getDrainDb(dbName)
    for (const html of [...GETTING_STARTED_LINES].reverse()) {
        await createEntry(localDb, html, identity, ulid())
    }
    startDrainSync(dbName)

    return dbName
}
