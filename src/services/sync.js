import { getDrainDb } from './db.js';
import { patchSyncState, syncStateOf } from '../stores/sync';
import { getAuthCredential } from './authSession';
import { isConstrained } from './perf';

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

// One-shot push of anything still local, used when a drain stops syncing
// live, so nothing written there is left only on this device.
function flushDrain(dbName) {
  const credential = getAuthCredential();
  if (!REMOTE_HOST || !credential) return;
  getDrainDb(dbName)
    .replicate.to(`${REMOTE_HOST}/${dbName}`, { auth: { username: credential.email, password: credential.password } })
    .catch((err) => console.warn('final push failed', dbName, err));
}

export function startDrainSync(dbName) {
  if (handlers.has(dbName)) return handlers.get(dbName);
  // Only the drain on screen syncs live. Every drain visited used to keep a
  // live replication (long-poll connection + change feeds) for the whole
  // session; now the previous one is stopped after a final push.
  for (const [other, handler] of handlers) {
    handler.cancel();
    handlers.delete(other);
    flushDrain(other);
  }
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
      // Constrained devices/connections: check in less often and back off
      // further after failures, instead of hammering a slow link.
      ...(isConstrained()
        ? { heartbeat: 30000, back_off_function: (delay) => (delay === 0 ? 3000 : Math.min(delay * 2, 120000)) }
        : {}),
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
