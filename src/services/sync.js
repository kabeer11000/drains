import { getDrainDb } from './db.js';
import { patchSyncState, syncStateOf } from '../stores/sync';
import { getAuthCredential } from './authSession';

// VITE_COUCHDB_URL is a build-time value baked into this client bundle —
// deliberately no fallback here. A silent default to localhost would mean
// sync just quietly points at a database that doesn't exist in production,
// with no error to explain why nothing's syncing.
const REMOTE_HOST = import.meta.env.VITE_COUCHDB_URL
  ? import.meta.env.VITE_COUCHDB_URL.replace(/\/[^/]*$/, '')
  : null;

// One live sync handler per currently-open drain database, keyed by dbName.
// Each drain's state lives under its own key in $sync (stores/sync.ts).
const handlers = new Map();

// 401/403/404 on the database itself: not a member, or no such drain.
// Retrying never fixes these, so they're reported as a hard error rather
// than "offline". No status at all means the request never got an answer.
function classify(err) {
  const status = err && (err.status || (err.result && err.result.status));
  if (status === 401 || status === 403 || status === 404) return { status: 'error', problem: 'no-access' };
  if (!status || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { status: 'offline', problem: undefined };
  return { status: 'error', problem: 'unknown' };
}

export function startDrainSync(dbName) {
  if (handlers.has(dbName)) return handlers.get(dbName);
  if (!REMOTE_HOST) {
    console.error('VITE_COUCHDB_URL is not set — this client bundle has no sync target.');
    patchSyncState(dbName, { status: 'error', problem: 'unknown' });
    return null;
  }
  const credential = getAuthCredential();
  if (!credential) return null;

  const handler = getDrainDb(dbName)
    .sync(`${REMOTE_HOST}/${dbName}`, {
      live: true,
      retry: true,
      auth: { username: credential.email, password: credential.password },
    })
    // 'paused' without an error means caught up and waiting for changes.
    .on('paused', (err) => {
      if (err) console.warn('sync paused with error', dbName, err);
      patchSyncState(dbName, err ? classify(err) : { status: 'synced', problem: undefined });
    })
    .on('active', () => patchSyncState(dbName, { status: 'syncing', problem: undefined }))
    // A single change the server refused (validate_doc_update). Sync keeps
    // going; the change just never leaves this device.
    .on('denied', (err) => {
      console.warn('sync denied a change', dbName, err);
      patchSyncState(dbName, {
        rejected: syncStateOf(dbName).rejected + 1,
        lastRejectReason: (err && (err.reason || err.message)) || undefined,
      });
    })
    .on('error', (err) => {
      console.error('sync error', dbName, err);
      patchSyncState(dbName, classify(err));
    });
  handlers.set(dbName, handler);
  return handler;
}

export function stopDrainSync(dbName) {
  const handler = handlers.get(dbName);
  if (handler) {
    handler.cancel();
    handlers.delete(dbName);
  }
}

export function stopAllSync() {
  handlers.forEach((h) => h.cancel());
  handlers.clear();
}
