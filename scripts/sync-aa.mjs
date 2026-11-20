#!/usr/bin/env node
/**
 * Artificial Analysis sync.
 *
 * Pages through AA's Free language-models catalog (scripts/lib/aa.mjs),
 * joins each entry by `aa_id` onto the local model JSONs, and rewrites the
 * Intelligence Index and speed facts with `verified_by: "auto"`. Prices
 * come from OpenRouter (sync-openrouter.mjs), which lists every provider.
 *
 * Fail-soft: if AA_API_KEY is missing, the network fails, or AA returns
 * an error, we log a warning and exit 0 — the last snapshot on disk keeps
 * serving the site. Only a hard write error is fatal.
 *
 * Speed medians move by a few percent between reads. A change under 5% is
 * treated as measurement noise and not written, so the site does not churn
 * a fact every day for no reader-visible difference.
 *
 * Freshness gate: skips the fetch if src/data/aa-snapshot.json was fetched
 * less than 24h ago, unless --force is passed.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { ingestBytes } from './ingest-snapshots.mjs';
import { AA_ATTRIBUTION, AA_CATALOG_URL, fetchCatalog } from './lib/aa.mjs';
import { DATA_DIR, today, writeFact, writeEntity } from './lib/facts.mjs';

const MODELS_DIR = join(DATA_DIR, 'models');
const SNAPSHOT_PATH = join(DATA_DIR, 'aa-snapshot.json');
const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Fact keys filled from an AA catalog record.
 *
 * Getters return `null` when the value is missing — that becomes an
 * auto-verified confirmed-absent fact, which is the right state: AA does
 * not publish a value for that model, and we checked. Every key here is a
 * `writer: 'sync'` entry in MODEL_FACT_SCHEMA.
 */
const AA_FACT_MAP = [
  { key: 'benchmark.aa_intelligence_index', get: m => m.evaluations?.artificial_analysis_intelligence_index },
  { key: 'speed.output_tokens_per_second',      get: m => m.performance?.median_output_tokens_per_second, minChange: 0.05 },
  { key: 'speed.time_to_first_token_seconds',   get: m => m.performance?.median_time_to_first_token_seconds, minChange: 0.05 },
];

function log(msg) { console.log(`[aa-sync] ${msg}`); }
function warn(msg) { console.warn(`[aa-sync] ${msg}`); }

function readSnapshot() {
  if (!existsSync(SNAPSHOT_PATH)) return null;
  try { return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')); }
  catch { return null; }
}

function isFresh(snapshot) {
  if (!snapshot?.fetched || !Array.isArray(snapshot.data)) return false;
  const then = Date.parse(snapshot.fetched);
  if (Number.isNaN(then)) return false;
  return Date.now() - then < STALE_MS;
}

function writeSnapshot({ meta, data }) {
  const snapshot = {
    fetched: new Date().toISOString(),
    attribution: AA_ATTRIBUTION,
    source_url: AA_CATALOG_URL,
    ...meta,
    data,
  };
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  return snapshot;
}

/**
 * Update one model with the AA record for it. `aaEntry` undefined = AA
 * did not return this model; existing values are left alone, because a
 * transient absence should not wipe benchmarks.
 */
function updateModel(data, slug, aaEntry, snapshotHash) {
  if (!aaEntry) return 0;
  const nowIso = today();
  const source = `https://artificialanalysis.ai/models/${aaEntry.slug}`;
  let changed = 0;
  for (const { key, get, minChange } of AA_FACT_MAP) {
    const entry = {
      value: get(aaEntry) ?? null,
      source,
      fetched: nowIso,
      verified_by: 'auto',
      verified_at: nowIso,
    };
    if (snapshotHash) {
      entry.snapshot_hash = snapshotHash;
      entry.snapshot_ext = 'json';
    }
    changed += writeFact(data, { type: 'model', slug }, key, entry, { minChange });
  }
  return changed;
}

async function main() {
  const force = process.argv.includes('--force');
  const existing = readSnapshot();

  // Freshness only gates the network fetch. We still reconcile model
  // files against whatever snapshot we have on disk — otherwise a newly
  // set `aa_id` would wait for the next 24h boundary before its
  // benchmarks landed.
  let snapshot = existing;
  if (force || !isFresh(existing)) {
    const apiKey = process.env.AA_API_KEY;
    if (!apiKey) {
      warn('AA_API_KEY not set — using last snapshot on disk if any.');
    } else {
      try {
        log(`fetching ${AA_CATALOG_URL} ...`);
        snapshot = writeSnapshot(await fetchCatalog(apiKey));
        log(`snapshot written: ${snapshot.data.length} models, intelligence index v${snapshot.intelligence_index_version} @ ${snapshot.fetched}`);
      } catch (err) {
        warn(`fetch failed: ${err.message} — using last snapshot on disk if any.`);
      }
    }
  } else {
    log('snapshot is fresh (< 24h), reusing on-disk data.');
  }

  if (!Array.isArray(snapshot?.data)) {
    warn('no AA data in the current format on disk — nothing to reconcile.');
    return;
  }

  // Archive the catalog into the content-addressed store, so every fact we
  // write can point at the exact bytes that produced it. Fail-soft: with
  // RESEARCH_ROOT unset, facts are written without snapshot_hash.
  let snapshotHash = null;
  try {
    const ingested = await ingestBytes(Buffer.from(JSON.stringify(snapshot.data), 'utf8'), 'json', {
      source_url: AA_CATALOG_URL,
      source_kind: 'aa_language_models_free',
      via: 'sync-aa',
    });
    if (ingested) {
      snapshotHash = ingested.sha;
      log(`snapshot ingested: ${ingested.sha.slice(0, 12)}… (${ingested.wasNew ? 'new' : 'dedup'})`);
    }
  } catch (err) {
    warn(`snapshot ingest failed: ${err.message} — continuing without snapshot_hash`);
  }

  const byId = new Map(snapshot.data.map(m => [m.id, m]));
  let filesTouched = 0;
  let factsWritten = 0;
  const unmatched = [];

  for (const f of readdirSync(MODELS_DIR).filter(f => f.endsWith('.json'))) {
    const slug = f.replace(/\.json$/, '');
    const data = JSON.parse(readFileSync(join(MODELS_DIR, f), 'utf8'));
    if (!data.facts) data.facts = {};
    const aaId = data.facts.aa_id?.value;
    if (typeof aaId !== 'string' || !aaId) continue;

    const entry = byId.get(aaId);
    if (!entry) unmatched.push(`${f} (aa_id=${aaId})`);

    const n = updateModel(data, slug, entry, snapshotHash);
    if (n > 0) {
      writeEntity('model', slug, data);
      filesTouched++;
      factsWritten += n;
    }
  }

  log(`updated ${filesTouched} file(s), ${factsWritten} fact(s) written`);
  if (unmatched.length > 0) {
    warn(`${unmatched.length} model(s) have aa_id set but AA didn't return them:`);
    for (const m of unmatched) warn(`  - ${m}`);
  }
}

main().catch(err => {
  console.error('[aa-sync] fatal:', err);
  process.exit(1);
});
