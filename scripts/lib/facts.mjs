/**
 * The one way scripts write facts.
 *
 * Every writer — the API syncs, the checker, and the dashboard's
 * /apply-patch — goes through `writeFact`, so two things hold everywhere:
 *
 *   - `fetched` means "when the value last changed". Re-confirming a value
 *     refreshes its signer, source and snapshot, never its date, so the
 *     site can say how long a number has been true.
 *   - A changed value is appended to `src/data/changes.jsonl`, the record
 *     of every value change. The log is written here and only
 *     here, so it cannot miss a writer.
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = join(ROOT, 'src/data');
const CHANGES_PATH = join(DATA_DIR, 'changes.jsonl');

/** Mirror of src/lib/entityTypes.ts. */
export const ENTITY_DIR = {
  model: 'models',
  build: 'builds',
  part: 'parts',
  company: 'companies',
  harness: 'harnesses',
};

export const today = () => new Date().toISOString().slice(0, 10);

export function isValidSlug(s) {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(s);
}

export function entityPath(type, slug) {
  if (!ENTITY_DIR[type] || !isValidSlug(slug)) return null;
  return join(DATA_DIR, ENTITY_DIR[type], `${slug}.json`);
}

export function readEntity(type, slug) {
  const path = entityPath(type, slug);
  if (!path || !existsSync(path)) return null;
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data.facts) data.facts = {};
  return data;
}

export function writeEntity(type, slug, data) {
  writeFileSync(entityPath(type, slug), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** Remove an entity's file. Returns the path removed, or null when there
 *  was nothing there. The change log records values, not entity lifecycles,
 *  so a deletion leaves no entry in it. */
export function deleteEntity(type, slug) {
  const path = entityPath(type, slug);
  if (!path || !existsSync(path)) return null;
  unlinkSync(path);
  return path;
}

/** Deep equality for the values facts hold: primitives, and arrays of
 *  flat records. */
export function valuesEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((row, i) => {
      const other = b[i];
      if (row && typeof row === 'object' && other && typeof other === 'object') {
        const keys = Object.keys(row);
        return keys.length === Object.keys(other).length && keys.every(k => row[k] === other[k]);
      }
      return row === other;
    });
  }
  return false;
}

/* ── Sync freshness ──────────────────────────────────────────────────
 * When each sync last ran, in a gitignored file. Not derivable from the
 * facts: `fetched` moves only when a value changes and `verified_at`
 * only when a fact is rewritten, so an unchanged API looks "never synced".
 * The sweep keeps its own entry here too (`last-sweep`): the start of
 * the last one that got through research, so the next looks for news since
 * then whatever runs have been deleted.
 */
const SYNC_STATE_PATH = join(ROOT, '.sync-state.json');
const SYNC_STALE_MS = 24 * 60 * 60 * 1000;

function readSyncState() {
  try { return JSON.parse(readFileSync(SYNC_STATE_PATH, 'utf8')); }
  catch { return {}; }
}

/** True if sync `name` ran less than 24h ago. */
export function syncIsFresh(name) {
  const then = Date.parse(readSyncState()[name] ?? '');
  return !Number.isNaN(then) && Date.now() - then < SYNC_STALE_MS;
}

/** When `name` last ran, as an ISO string, or null. */
export function lastSynced(name) {
  return readSyncState()[name] ?? null;
}

export function markSynced(name, at = new Date().toISOString()) {
  const state = readSyncState();
  state[name] = at;
  writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/** A list value is logged by size, not content: a quant table changing is
 *  news, its forty rows are not. */
function loggable(value) {
  return Array.isArray(value) ? `${value.length} rows` : value ?? null;
}

/**
 * Write `entry` as fact `key` on an entity's in-memory data.
 *
 * `ctx` is `{ type, slug }`, used for the change log. Returns 1 if the
 * stored fact changed, 0 if it was already identical or the fact is N/A
 * (a fact Luke marked N/A is never written by a script).
 *
 * `reconfirm` also counts a new `verified_at` as a change. The checker
 * sets it, because "checked again today" is what a price is worth; the
 * syncs do not, because re-reading an unchanged API response is not news
 * and would churn every file daily.
 *
 * `minChange` ignores a numeric move smaller than that fraction. A sync
 * uses it where the API's own measurement is noisier than the change a
 * reader would care about; the old value and date are kept.
 */
export function writeFact(data, ctx, key, entry, { reconfirm = false, minChange = 0 } = {}) {
  const current = data.facts[key];
  if (current?.na === true) return 0;

  if (current && minChange > 0
      && !valuesEqual(current.value, entry.value)
      && typeof current.value === 'number' && typeof entry.value === 'number'
      && current.value !== 0
      && Math.abs(entry.value - current.value) / Math.abs(current.value) < minChange) {
    return 0;
  }

  const sameValue = current && valuesEqual(current.value, entry.value);
  const next = { ...entry };
  if (sameValue && current.fetched) next.fetched = current.fetched;
  // A sync re-reading an unchanged value keeps the receipt it already has.
  // API responses carry counters (stars, downloads) that change every
  // read, so a fresh receipt would rewrite every fact every day while
  // proving nothing new.
  if (sameValue && !reconfirm && current.snapshot_hash) {
    next.snapshot_hash = current.snapshot_hash;
    next.snapshot_ext = current.snapshot_ext;
    next.verified_at = current.verified_at;
  }

  if (current && sameValue
      && current.source === next.source
      && current.verified_by === next.verified_by
      && (!reconfirm || current.verified_at === next.verified_at)
      && current.quote === next.quote
      && (!next.snapshot_hash || current.snapshot_hash === next.snapshot_hash)
      && (!next.snapshot_hash || current.snapshot_ext === next.snapshot_ext)) {
    return 0;
  }

  recordChange(ctx, key, current?.value, next);
  data.facts[key] = next;
  return 1;
}

/** Append a value change to the change log. A no-op when the value did
 *  not change — including a fact created empty, which is not a change
 *  anyone could read about. Exported for /apply-patch, whose edits are
 *  not whole-fact writes. */
export function recordChange(ctx, key, previous, next) {
  if (valuesEqual(previous ?? null, next.value)) return;
  appendFileSync(CHANGES_PATH, JSON.stringify({
    date: today(),
    entity: `${ctx.type}/${ctx.slug}`,
    key,
    from: loggable(previous),
    to: loggable(next.value),
    by: next.verified_by ?? null,
    source: next.source ?? null,
  }) + '\n', 'utf8');
}
