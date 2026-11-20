#!/usr/bin/env node
/**
 * OpenRouter sync.
 *
 * Joins each local model to an OpenRouter model — an open model by its
 * Hugging Face repo (`snapshot.huggingface_card`, which OpenRouter lists
 * as `hugging_face_id`), a closed one by `openrouter_id` — reads every
 * provider OpenRouter routes it to (scripts/lib/openrouter.mjs), and writes
 * `pricing.*` and `providers` with `verified_by: "auto"`.
 *
 * Fail-soft: if a fetch fails, we log a warning and exit 0 — the last
 * snapshot on disk keeps serving the site. Only a hard write error is
 * fatal.
 *
 * Freshness gate: skips the fetch if src/data/openrouter-snapshot.json was
 * fetched less than 24h ago, unless --force is passed. A model joined since
 * (a newly accepted `openrouter_id`) has its providers fetched regardless.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { ingestBytes } from './ingest-snapshots.mjs';
import {
  OPENROUTER_ATTRIBUTION, OPENROUTER_MODELS_URL, endpointsUrl, fetchCatalog, fetchEndpoints, isBaseId, modelPageUrl,
} from './lib/openrouter.mjs';
import { DATA_DIR, today, writeFact, writeEntity } from './lib/facts.mjs';

const MODELS_DIR = join(DATA_DIR, 'models');
const SNAPSHOT_PATH = join(DATA_DIR, 'openrouter-snapshot.json');
const STALE_MS = 24 * 60 * 60 * 1000;

function log(msg) { console.log(`[openrouter-sync] ${msg}`); }
function warn(msg) { console.warn(`[openrouter-sync] ${msg}`); }

function readSnapshot() {
  if (!existsSync(SNAPSHOT_PATH)) return null;
  try { return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')); }
  catch { return null; }
}

function writeSnapshot(snapshot) {
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
}

function isFresh(snapshot) {
  const then = Date.parse(snapshot?.fetched ?? '');
  return Array.isArray(snapshot?.catalog) && !Number.isNaN(then) && Date.now() - then < STALE_MS;
}

/** Archive the bytes as a receipt. Fail-soft: with RESEARCH_ROOT unset,
 *  facts are written without snapshot_hash. */
async function receipt(bytes, sourceUrl) {
  try {
    const ingested = await ingestBytes(bytes, 'json', { source_url: sourceUrl, source_kind: 'openrouter', via: 'sync-openrouter' });
    return ingested?.sha ?? null;
  } catch (err) {
    warn(`snapshot ingest failed for ${sourceUrl}: ${err.message} — continuing without snapshot_hash`);
    return null;
  }
}

/** The OpenRouter id a local model joins to: `null` when it has none (or
 *  is confirmed absent), `undefined` when its join is not settled yet. */
function joinId(facts, catalog) {
  if (facts.distribution?.value === 'closed') return facts.openrouter_id?.value;
  const card = facts['snapshot.huggingface_card']?.value;
  const repo = typeof card === 'string' ? card.match(/huggingface\.co\/([^/]+\/[^/?#]+)/)?.[1]?.toLowerCase() : null;
  if (!repo) return undefined;
  const hits = catalog.filter(m => isBaseId(m.id) && m.hugging_face_id?.toLowerCase() === repo);
  if (hits.length > 1) {
    warn(`${repo} is listed under ${hits.map(h => h.id).join(', ')} — not joining`);
    return undefined;
  }
  return hits.length === 1 ? hits[0].id : null;
}

/* ── Provider rows → facts ────────────────────────────────────────── */

/** OpenRouter prices are USD per token, as strings. */
const perM = s => (s === null || s === undefined || s === '' ? null : Math.round(Number(s) * 1e6 * 1e4) / 1e4);
const blended = r => (3 * r.input + r.output) / 4;
const round4 = n => (n === null ? null : Math.round(n * 1e4) / 1e4);

function median(values) {
  const v = values.filter(n => typeof n === 'number').sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** The stable part of each endpoint, cheapest first. A provider listing
 *  the model for nothing is a promotion, not a price, and is left out. */
function providerRows(endpoints) {
  return endpoints
    .map(e => ({
      provider: e.provider_name,
      quantization: e.quantization ?? 'unknown',
      input: perM(e.pricing?.prompt),
      output: perM(e.pricing?.completion),
      cached_input: perM(e.pricing?.input_cache_read),
      context_length: e.context_length ?? null,
    }))
    .filter(r => typeof r.input === 'number' && typeof r.output === 'number' && r.input + r.output > 0)
    .sort((a, b) => blended(a) - blended(b) || a.provider.localeCompare(b.provider));
}

function factsFrom(rows) {
  const blends = rows.map(blended);
  return {
    'pricing.input_per_m_usd': round4(median(rows.map(r => r.input))),
    'pricing.output_per_m_usd': round4(median(rows.map(r => r.output))),
    'pricing.cached_input_per_m_usd': round4(median(rows.map(r => r.cached_input))),
    'pricing.blended_per_m_usd': round4(median(blends)),
    'pricing.blended_min_per_m_usd': round4(blends.length ? Math.min(...blends) : null),
    providers: rows,
  };
}

/* ── Main ─────────────────────────────────────────────────────────── */

function loadModels() {
  return readdirSync(MODELS_DIR).filter(f => f.endsWith('.json')).map(f => {
    const data = JSON.parse(readFileSync(join(MODELS_DIR, f), 'utf8'));
    if (!data.facts) data.facts = {};
    return { slug: f.replace(/\.json$/, ''), data };
  });
}

/** Fetch providers for every id not in the snapshot yet. Returns how many. */
async function fetchMissing(snapshot, ids, apiKey) {
  let n = 0;
  for (const id of ids) {
    if (snapshot.models[id]) continue;
    try {
      const { bytes, endpoints } = await fetchEndpoints(id, apiKey);
      // The receipt keeps the whole response; the snapshot keeps what the
      // facts are made from.
      snapshot.models[id] = {
        snapshot_hash: await receipt(bytes, endpointsUrl(id)),
        endpoints: endpoints.map(e => ({
          provider_name: e.provider_name, quantization: e.quantization, pricing: e.pricing, context_length: e.context_length,
        })),
      };
      n++;
    } catch (err) {
      warn(`providers for ${id}: ${err.message}`);
    }
  }
  return n;
}

async function main() {
  const force = process.argv.includes('--force');
  const apiKey = process.env.OPENROUTER_API_KEY || null;
  if (!apiKey) warn('OPENROUTER_API_KEY not set — fetching without it.');
  const models = loadModels();
  let snapshot = readSnapshot();

  if (force || !isFresh(snapshot)) {
    try {
      log(`fetching ${OPENROUTER_MODELS_URL} ...`);
      const { bytes, models: catalog } = await fetchCatalog(apiKey);
      snapshot = {
        fetched: new Date().toISOString(),
        attribution: OPENROUTER_ATTRIBUTION,
        source_url: OPENROUTER_MODELS_URL,
        catalog_snapshot_hash: await receipt(bytes, OPENROUTER_MODELS_URL),
        catalog: catalog.map(m => ({ id: m.id, name: m.name, hugging_face_id: m.hugging_face_id || null, created: m.created })),
        models: {},
      };
    } catch (err) {
      warn(`fetch failed: ${err.message} — using last snapshot on disk if any.`);
    }
  } else {
    log('snapshot is fresh (< 24h), reusing on-disk data.');
  }

  if (!Array.isArray(snapshot?.catalog)) {
    warn('no OpenRouter data on disk — nothing to reconcile.');
    return;
  }

  const joins = models.map(m => ({ ...m, id: joinId(m.data.facts, snapshot.catalog) }));
  const ids = [...new Set(joins.map(j => j.id).filter(id => typeof id === 'string'))];
  const fetched = await fetchMissing(snapshot, ids, apiKey);
  writeSnapshot(snapshot);
  if (fetched > 0) log(`providers fetched for ${fetched} model(s), ${snapshot.catalog.length} in the catalog`);

  let factsWritten = 0;
  const unjoined = [];
  for (const { slug, data, id } of joins) {
    if (id === undefined) { unjoined.push(slug); continue; }
    // A model with no providers on disk keeps its values: a transient
    // absence should not wipe prices.
    const entry = id === null ? null : snapshot.models[id];
    if (id !== null && !entry) continue;

    const values = entry ? factsFrom(providerRows(entry.endpoints)) : factsFrom([]);
    let n = 0;
    for (const [key, value] of Object.entries(values)) {
      const fact = {
        value: id === null ? (key === 'providers' ? [] : null) : value,
        source: id === null ? OPENROUTER_MODELS_URL : modelPageUrl(id),
        fetched: today(),
        verified_by: 'auto',
        verified_at: today(),
      };
      const hash = id === null ? snapshot.catalog_snapshot_hash : entry.snapshot_hash;
      if (hash) {
        fact.snapshot_hash = hash;
        fact.snapshot_ext = 'json';
      }
      n += writeFact(data, { type: 'model', slug }, key, fact);
    }
    if (n > 0) {
      writeEntity('model', slug, data);
      factsWritten += n;
    }
  }

  log(`${factsWritten} fact(s) written`);
  if (unjoined.length > 0) {
    warn(`${unjoined.length} model(s) have no join yet (open: snapshot.huggingface_card; closed: openrouter_id):`);
    for (const s of unjoined) warn(`  - ${s}`);
  }
}

main().catch(err => {
  console.error('[openrouter-sync] fatal:', err);
  process.exit(1);
});
