#!/usr/bin/env node
/**
 * Arena sync.
 *
 * Reads Arena's latest Text leaderboard (scripts/lib/arena.mjs), joins each
 * row by `arena_name` onto the local model JSONs, and writes one
 * `benchmark.arena_text_*` fact per category in ARENA_CATEGORIES, with
 * `verified_by: "auto"`.
 *
 * Fail-soft: if the download or parse fails, we log a warning and exit 0 —
 * the last snapshot on disk keeps serving the site. Only a hard write
 * error is fatal.
 *
 * Freshness gate: skips the fetch if src/data/arena-snapshot.json was
 * fetched less than 24h ago, unless --force is passed.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { ingestBytes } from './ingest-snapshots.mjs';
import {
  ARENA_ATTRIBUTION, ARENA_CATEGORIES, ARENA_CONFIG, ARENA_DATASET_URL, ARENA_PARQUET_URL, fetchLeaderboard,
} from './lib/arena.mjs';
import { DATA_DIR, today, writeFact, writeEntity } from './lib/facts.mjs';

const MODELS_DIR = join(DATA_DIR, 'models');
const SNAPSHOT_PATH = join(DATA_DIR, 'arena-snapshot.json');
const STALE_MS = 24 * 60 * 60 * 1000;

function log(msg) { console.log(`[arena-sync] ${msg}`); }
function warn(msg) { console.warn(`[arena-sync] ${msg}`); }

function readSnapshot() {
  if (!existsSync(SNAPSHOT_PATH)) return null;
  try { return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')); }
  catch { return null; }
}

function isFresh(snapshot) {
  const then = Date.parse(snapshot?.fetched ?? '');
  return Array.isArray(snapshot?.data) && !Number.isNaN(then) && Date.now() - then < STALE_MS;
}

/** The fetched leaderboard on disk, and its receipt in the archive.
 *  Fail-soft on the archive: with RESEARCH_ROOT unset, facts are written
 *  without snapshot_hash. */
async function refresh() {
  const { bytes, rows } = await fetchLeaderboard();
  let snapshotHash = null;
  try {
    const ingested = await ingestBytes(bytes, 'parquet', {
      source_url: ARENA_PARQUET_URL,
      source_kind: 'arena_leaderboard',
      via: 'sync-arena',
    });
    if (ingested) {
      snapshotHash = ingested.sha;
      log(`snapshot ingested: ${ingested.sha.slice(0, 12)}… (${ingested.wasNew ? 'new' : 'dedup'})`);
    }
  } catch (err) {
    warn(`snapshot ingest failed: ${err.message} — continuing without snapshot_hash`);
  }
  const snapshot = {
    fetched: new Date().toISOString(),
    attribution: ARENA_ATTRIBUTION,
    source_url: ARENA_PARQUET_URL,
    config: ARENA_CONFIG,
    categories: Object.keys(ARENA_CATEGORIES),
    leaderboard_publish_date: rows[0].leaderboard_publish_date,
    snapshot_hash: snapshotHash,
    data: rows,
  };
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  return snapshot;
}

async function main() {
  const force = process.argv.includes('--force');
  let snapshot = readSnapshot();

  // Freshness only gates the network fetch. We still reconcile model
  // files against whatever snapshot we have on disk, so a newly accepted
  // `arena_name` gets its rating without waiting a day.
  if (force || !isFresh(snapshot)) {
    try {
      log(`fetching ${ARENA_PARQUET_URL} ...`);
      snapshot = await refresh();
      log(`snapshot written: ${snapshot.data.length} models, leaderboard of ${snapshot.leaderboard_publish_date}`);
    } catch (err) {
      warn(`fetch failed: ${err.message} — using last snapshot on disk if any.`);
    }
  } else {
    log('snapshot is fresh (< 24h), reusing on-disk data.');
  }

  if (!Array.isArray(snapshot?.data)) {
    warn('no Arena data on disk — nothing to reconcile.');
    return;
  }

  const byName = new Map(snapshot.data.map(r => [r.model_name, r]));
  let factsWritten = 0;
  const unmatched = [];

  for (const f of readdirSync(MODELS_DIR).filter(f => f.endsWith('.json'))) {
    const slug = f.replace(/\.json$/, '');
    const data = JSON.parse(readFileSync(join(MODELS_DIR, f), 'utf8'));
    if (!data.facts) data.facts = {};
    const name = data.facts.arena_name?.value;
    if (typeof name !== 'string' || !name) continue;

    // A model Arena stops listing, or stops ranking in a category, keeps
    // its rating: a transient absence should not wipe it.
    const row = byName.get(name);
    if (!row) { unmatched.push(`${f} (arena_name=${name})`); continue; }

    let n = 0;
    for (const [category, key] of Object.entries(ARENA_CATEGORIES)) {
      const rating = row.ratings[category];
      if (typeof rating !== 'number') continue;
      const entry = {
        value: Math.round(rating),
        source: ARENA_DATASET_URL,
        fetched: today(),
        verified_by: 'auto',
        verified_at: today(),
      };
      if (snapshot.snapshot_hash) {
        entry.snapshot_hash = snapshot.snapshot_hash;
        entry.snapshot_ext = 'parquet';
      }
      n += writeFact(data, { type: 'model', slug }, key, entry);
    }
    if (n > 0) {
      writeEntity('model', slug, data);
      factsWritten += n;
    }
  }

  log(`${factsWritten} fact(s) written`);
  if (unmatched.length > 0) {
    warn(`${unmatched.length} model(s) have arena_name set but the leaderboard doesn't list them:`);
    for (const m of unmatched) warn(`  - ${m}`);
  }
}

main().catch(err => {
  console.error('[arena-sync] fatal:', err);
  process.exit(1);
});
