import PouchDB from 'pouchdb';

// One local PouchDB per drain database (drain-<ulid>), instead of a single
// shared 'main' instance — each drain now lives in its own CouchDB database
// for real per-drain access control (see lib/couchdb-admin.ts). The registry
// just avoids creating duplicate PouchDB instances for the same dbName.
const registry = new Map<string, PouchDB.Database>();

export function getDrainDb(dbName: string): PouchDB.Database {
  let instance = registry.get(dbName);
  if (!instance) {
    instance = new PouchDB(dbName);
    // Four live feeds watch an open drain (entries, comments, streams,
    // sync). Every write wakes each of them, and each briefly adds a
    // 'destroyed' listener while it catches up, so a sync burst of a few
    // docs passes Node's default of 10 and logs a bogus "memory leak"
    // warning. They're all released when the catch-up finishes.
    (instance as unknown as { setMaxListeners(n: number): void }).setMaxListeners(50);
    registry.set(dbName, instance);
  }
  return instance;
}
