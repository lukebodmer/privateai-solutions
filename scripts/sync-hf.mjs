#!/usr/bin/env node
/**
 * HuggingFace sync — deterministic auto-fill for model facts.
 *
 * Sibling of sync-aa.mjs. For every model that has `snapshot.huggingface_card`
 * set (from an onboarding run), we pull four HF resources:
 *
 *   1. GET /api/models/<repo>?blobs=1        → weight sizes (native_size_gb),
 *                                              file listing for quant probes
 *   2. GET /<repo>/raw/main/config.json      → architecture params
 *   3. GET /api/models/unsloth/<name>-GGUF?blobs=1  → Unsloth quants list
 *   4. GET /api/models/bartowski/<name>-GGUF?blobs=1 → bartowski quants list
 *
 * Facts auto-filled:
 *   native_size_gb           (from #1, safetensors sum)
 *   architecture.type        (from #2, "moe" if the config names experts, else "dense")
 *   architecture.experts     (from #2, num_local_experts / num_experts / n_routed_experts)
 *   context_length           (from #2, max_position_embeddings / context_length)
 *   kv_cache_bytes_per_token (from #2, see kvCacheBytesPerToken)
 *   snapshot.unsloth_gguf    (from #3, the repo the search settled on)
 *   quantizations_unsloth    (from #3, [{name, size_gb}])
 *   snapshot.bartowski_gguf  (from #4)
 *   quantizations_bartowski  (from #4)
 *
 * A multimodal repo nests the language model's config under `text_config`
 * (Kimi K3.1 Pro: top-level `model_type` is `kimi_k31`, 896 experts one
 * level down), so the architecture fields read through to it.
 *
 * Every fact gets `verified_by: "auto"`, source URL = the HF page, and a
 * `snapshot_hash` pointing at the archived response.
 *
 * Fail-soft: any single fetch failure logs a warning and moves on. Missing
 * unsloth/bartowski repos = `value: []` (confirmed-absent). All-or-nothing
 * only for the config.json fetch since three facts derive from it — if
 * that fails, the model's architecture facts stay untouched.
 *
 * Freshness gate: the whole sync skips if it ran < 24h ago (.sync-state.json),
 * unless --force is passed or a single model slug is named.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { ingestBytes } from './ingest-snapshots.mjs';
import { DATA_DIR, markSynced, syncIsFresh, today, writeFact, writeEntity } from './lib/facts.mjs';

const MODELS_DIR = join(DATA_DIR, 'models');

// Auxiliary artifacts in GGUF repos that aren't quantizations of the base
// model — mmproj (multimodal projection), imatrix (importance matrix used
// during quantization), MTP (multi-token prediction heads), etc.
const EXCLUDE_QUANT_KEYS = ['mmproj', 'imatrix', 'mtp', 'dspark'];

const log = msg => console.log(`[hf-sync] ${msg}`);
const warn = msg => console.warn(`[hf-sync] ${msg}`);

/** Pull the `<owner>/<repo>` slug out of a huggingface.co URL. */
function hfRepoFromUrl(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(/huggingface\.co\/([^/?#]+\/[^/?#]+)/);
  return m ? m[1] : null;
}

/** Fetch JSON with a shared error surface. Returns { body, buf } — buf is
 *  the raw response bytes for the archive. Throws on non-2xx. */
async function fetchJson(url) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const body = JSON.parse(buf.toString('utf8'));
  return { body, buf };
}

/** Ingest a captured response into the content-addressed archive. Returns
 *  the sha or null if the archive isn't configured. */
async function archive(buf, meta) {
  try {
    const r = await ingestBytes(buf, 'json', { via: 'sync-hf', ...meta });
    return r?.sha ?? null;
  } catch (err) {
    warn(`archive failed: ${err.message}`);
    return null;
  }
}

/** Sum .safetensors sizes from an HF `/api/models/<repo>?blobs=1` response.
 *  Falls back to .bin if no safetensors present. Returns GB rounded to
 *  one decimal, or null if the repo has no weight files. */
function nativeSizeFromApi(body) {
  const siblings = Array.isArray(body?.siblings) ? body.siblings : [];
  const safetensors = siblings.filter(s => s.rfilename?.endsWith('.safetensors'));
  const bins = siblings.filter(s => s.rfilename?.endsWith('.bin'));
  const files = safetensors.length > 0 ? safetensors : bins;
  if (files.length === 0) return null;
  const bytes = files.reduce((a, s) => a + (s.size ?? 0), 0);
  if (bytes === 0) return null;
  return Math.round((bytes / 1e9) * 10) / 10;
}

/** Extract architecture facts from a config.json body. Returns an object
 *  keyed by fact name; keys with `null` values mean "field wasn't present
 *  in the config" — we skip writing those. */
function architectureFromConfig(cfg) {
  const text = cfg.text_config && typeof cfg.text_config === 'object' ? cfg.text_config : cfg;
  const experts = text.num_local_experts ?? text.num_experts ?? text.n_routed_experts
    ?? cfg.num_local_experts ?? cfg.num_experts ?? cfg.n_routed_experts ?? null;
  const type = experts && experts > 1 ? 'moe' : 'dense';
  const context = text.max_position_embeddings ?? text.context_length
    ?? cfg.max_position_embeddings ?? cfg.context_length ?? null;
  return {
    'architecture.type': type,
    'architecture.experts': type === 'moe' ? experts : null,
    'context_length': typeof context === 'number' ? context : null,
    'kv_cache_bytes_per_token': kvCacheBytesPerToken(text),
  };
}

/** KV cache per token of context, in bytes at 16-bit, for the layers whose
 *  cache grows with context. The formulas and their sources are in
 *  src/data/sizing.json:
 *   - standard and grouped-query attention, NVIDIA: 2 × num_layers ×
 *     (num_heads × dim_head) × precision_in_bytes, with the KV heads;
 *   - latent attention, DeepSeek-V2 Table 1: (d_c + d_h^R) × l elements,
 *     i.e. (kv_lora_rank + qk_rope_head_dim) per layer.
 *  Only full-attention layers count: a linear-attention layer keeps a fixed
 *  state per session instead (layer_types, linear_attn_config, or
 *  full_attention_interval say which layers are which). A sparse-attention
 *  indexer also keeps a key per token; neither formula covers it, so it is
 *  added conservatively: index_head_dim (× index heads where the config
 *  gives them) on every full-attention layer, at 16-bit.
 *  Null when the config compresses or shares the cache across layers
 *  (DeepSeek V4.1's compress_ratios, kv_source_layer_ids): no estimate. */
export function kvCacheBytesPerToken(text) {
  if (text.compress_ratios || text.kv_source_layer_ids) return null;
  const layers = text.num_hidden_layers;
  if (!Number.isInteger(layers) || layers <= 0) return null;

  let full = layers;
  if (Array.isArray(text.layer_types)) full = text.layer_types.filter(t => !/linear/i.test(String(t))).length;
  else if (Array.isArray(text.linear_attn_config?.full_attn_layers)) full = text.linear_attn_config.full_attn_layers.length;
  else if (Number.isInteger(text.full_attention_interval) && text.full_attention_interval > 0) full = Math.floor(layers / text.full_attention_interval);

  let perLayer;
  if (Number.isInteger(text.kv_lora_rank)) {
    perLayer = text.kv_lora_rank + (text.qk_rope_head_dim ?? 0);
  } else {
    const kvHeads = text.num_key_value_heads ?? text.num_attention_heads;
    const headDim = text.head_dim || (text.hidden_size && text.num_attention_heads ? text.hidden_size / text.num_attention_heads : null);
    if (!kvHeads || !headDim) return null;
    perLayer = 2 * kvHeads * headDim;
  }

  const sparse = text.sparse_attention_config;
  const indexer = Number.isInteger(text.index_head_dim) ? text.index_head_dim
    : sparse?.use_sparse_attention && Number.isInteger(sparse.sparse_index_dim) ? sparse.sparse_index_dim * (sparse.sparse_num_index_heads ?? 1)
    : 0;

  return full * (perLayer + indexer) * 2;
}

/** Group a GGUF repo's siblings into quantization rows. Two layouts:
 *   1. subdir-per-quant: "Q4_K_M/model-00001-of-00004.gguf" → key "Q4_K_M"
 *   2. flat: "Model-Q4_0.gguf" → key "Q4_0" (base name stripped)
 *  Multi-shard files sum. Aux artifacts (mmproj etc.) are skipped. */
/** Strip whatever "<base>-" prefix a quant key carries. Handles both the
 *  plain-file layout (`Qwen3.8-27B-Q4_0` in a `Qwen3.8-27B-GGUF` repo →
 *  `Q4_0`) and bartowski's subdir layout with owner-prefixed names
 *  (`zai-org_GLM-5.3-Q4_K_M.gguf` in a `zai-org_GLM-5.3-GGUF` repo →
 *  `Q4_0`). Tries the repo's own basename first, then any prefix
 *  ending in the quant marker letter (Q/I/T/F/M...).
 */
function stripBasePrefix(key, base) {
  if (!key) return key;
  if (base && key.startsWith(base + '-')) return key.slice(base.length + 1);
  // Case-insensitive fallback.
  if (base && key.toLowerCase().startsWith(base.toLowerCase() + '-')) {
    return key.slice(base.length + 1);
  }
  return key;
}

function quantsFromApi(body, repoSlug) {
  const siblings = Array.isArray(body?.siblings) ? body.siblings : [];
  const repoName = repoSlug.split('/')[1] ?? '';
  const base = repoName.replace(/-GGUF$/i, '');
  const groups = new Map();
  for (const s of siblings) {
    const path = s.rfilename;
    if (typeof path !== 'string' || !path.endsWith('.gguf')) continue;
    const parts = path.split('/');
    let key;
    if (parts.length > 1) {
      // Subdir-per-quant: dir name is the quant, possibly prefixed with base.
      key = stripBasePrefix(parts[0], base);
    } else {
      // Flat layout: <base>-<quant>.gguf.
      key = stripBasePrefix(parts[0].replace(/\.gguf$/i, ''), base);
    }
    if (EXCLUDE_QUANT_KEYS.some(x => key.toLowerCase().startsWith(x))) continue;
    groups.set(key, (groups.get(key) ?? 0) + (s.size ?? 0));
  }
  return [...groups.entries()]
    .map(([name, bytes]) => ({ name, size_gb: Math.round((bytes / 1e9) * 10) / 10 }))
    .sort((a, b) => a.size_gb - b.size_gb);
}

// Repo-name tokens that mean "this isn't the plain quant of the base model"
// — bartowski publishes many variants (experimental MXFP4, uncensored
// finetunes, heretic branches). We only want the vanilla `<basename>-GGUF`
// or `<orig_owner>_<basename>-GGUF`.
const VARIANT_TOKENS = ['experimental', 'uncensored', 'heretic', 'finetune', 'abliterated', 'lora', 'draft'];

/** Score a candidate repo id for how likely it is to be the "canonical"
 *  publisher quant of `baseName`. Higher = better. Negative = disqualify. */
function scoreRepoCandidate(repoId, baseName) {
  const name = repoId.split('/')[1] ?? '';
  const lower = name.toLowerCase();
  if (VARIANT_TOKENS.some(t => lower.includes(t))) return -1;
  // Exact `<basename>-GGUF` match wins outright.
  if (name === `${baseName}-GGUF`) return 100;
  // Prefixed `<orig_owner>_<basename>-GGUF` is bartowski's convention for
  // some quants — accept but rank below the plain form.
  if (name.endsWith(`_${baseName}-GGUF`)) return 80;
  // Case-insensitive fallbacks.
  if (lower === `${baseName.toLowerCase()}-gguf`) return 60;
  if (lower.endsWith(`_${baseName.toLowerCase()}-gguf`)) return 40;
  return 0;
}

/** Find the canonical publisher-quant repo for a base model via HF search.
 *  Search is universally 200 (no auth-gating), so it's the reliable primary
 *  lookup. Returns the best-matching repo id or null. */
async function searchPublisherRepo(publisher, baseName) {
  const url = `https://huggingface.co/api/models?search=${encodeURIComponent(baseName)}&author=${publisher}&limit=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`search HTTP ${res.status}`);
  const results = await res.json();
  if (!Array.isArray(results) || results.length === 0) return null;
  const scored = results
    .map(r => ({ id: r.id, score: scoreRepoCandidate(r.id, baseName) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.id ?? null;
}

/** Find and fetch a GGUF publisher's quant repo for a model. Search-first:
 *  the search API is 200 for every author. Once we know the repo exists,
 *  hit `?blobs=1` for file sizes. Returns { rows, sourceUrl, repoUrl,
 *  snapshotHash }, or `{ rows: [], repoUrl: null, ... }` for confirmed-absent. */
async function fetchQuantRepo(publisher, baseName) {
  let repo;
  try {
    repo = await searchPublisherRepo(publisher, baseName);
  } catch (err) {
    warn(`${publisher} search failed for ${baseName}: ${err.message}`);
    return null;
  }
  if (!repo) {
    // Search returned nothing that fits — confirmed absent for this publisher.
    const sourceUrl = `https://huggingface.co/${publisher}`;
    return { rows: [], sourceUrl, repoUrl: null, snapshotHash: null };
  }

  const blobUrl = `https://huggingface.co/api/models/${repo}?blobs=1`;
  const sourceUrl = `https://huggingface.co/${repo}`;
  try {
    const res = await fetch(blobUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw new Error(`blobs HTTP ${res.status}`);
    const body = JSON.parse(buf.toString('utf8'));
    const rows = quantsFromApi(body, repo);
    const sha = await archive(buf, { source_url: blobUrl, source_kind: `hf_${publisher}_quants` });
    return { rows, sourceUrl, repoUrl: sourceUrl, snapshotHash: sha };
  } catch (err) {
    warn(`${publisher} blob fetch failed for ${repo}: ${err.message}`);
    return null;
  }
}

/** Write one auto-fact to the model data. Returns 1 if written, 0 if
 *  unchanged or blocked by N/A. */
function writeAutoFact(data, slug, key, value, sourceUrl, snapshotHash) {
  const nowIso = today();
  const entry = {
    value,
    source: sourceUrl,
    fetched: nowIso,
    verified_by: 'auto',
    verified_at: nowIso,
  };
  if (snapshotHash) {
    entry.snapshot_hash = snapshotHash;
    entry.snapshot_ext = 'json';
  }
  return writeFact(data, { type: 'model', slug }, key, entry);
}

async function processModel(filePath, slug) {
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!data.facts) data.facts = {};

  const hfUrl = data.facts['snapshot.huggingface_card']?.value;
  const repo = hfRepoFromUrl(hfUrl);
  if (!repo) return { skipped: 'no-hf-snapshot' };

  // Skip if the model's distribution says HF-facts don't apply here. The
  // schema declares snapshot.huggingface_card with applies_when:
  // {distribution: ['open','gated']}, so we use that fact as the gate.
  const dist = data.facts.distribution?.value;
  if (dist && dist !== 'open' && dist !== 'gated') {
    return { skipped: 'distribution-not-open' };
  }

  let written = 0;
  const errors = [];

  // 1. Weight sizing — GET /api/models/<repo>?blobs=1
  try {
    const url = `https://huggingface.co/api/models/${repo}?blobs=1`;
    const { body, buf } = await fetchJson(url);
    const sha = await archive(buf, { source_url: url, source_kind: 'hf_model_api' });
    const sizeGb = nativeSizeFromApi(body);
    if (sizeGb !== null) {
      written += writeAutoFact(data, slug, 'native_size_gb', sizeGb, hfUrl, sha);
    }
  } catch (err) {
    errors.push(`model api: ${err.message}`);
  }

  // 2. config.json → architecture + context_length
  try {
    const configUrl = `https://huggingface.co/${repo}/raw/main/config.json`;
    const { body, buf } = await fetchJson(configUrl);
    const sha = await archive(buf, { source_url: configUrl, source_kind: 'hf_config' });
    const facts = architectureFromConfig(body);
    for (const [key, value] of Object.entries(facts)) {
      if (value === null || value === undefined) continue;
      written += writeAutoFact(data, slug, key, value, configUrl, sha);
    }
  } catch (err) {
    errors.push(`config.json: ${err.message}`);
  }

  // 3+4. Quant probes — unsloth and bartowski. HF repo naming is
  // "<publisher>/<basename>-GGUF" where <basename> matches the source
  // repo's model name (case-insensitive but we keep it as-is).
  const baseName = repo.split('/')[1];
  for (const publisher of ['unsloth', 'bartowski']) {
    const result = await fetchQuantRepo(publisher, baseName);
    if (!result) continue; // fetch error already warned
    if (result.repoUrl) {
      written += writeAutoFact(data, slug, `snapshot.${publisher}_gguf`, result.repoUrl, result.repoUrl, result.snapshotHash);
    }
    written += writeAutoFact(data, slug, `quantizations_${publisher}`, result.rows, result.sourceUrl, result.snapshotHash);
  }

  if (written > 0) writeEntity('model', slug, data);
  return { written, errors };
}

async function main() {
  const force = process.argv.includes('--force');
  const slugArg = process.argv.find(a => !a.startsWith('-') && !a.endsWith('.mjs') && !a.endsWith('node'));
  if (!force && !slugArg && syncIsFresh('hf')) {
    log('ran < 24h ago — skipping (pass --force to run anyway).');
    return;
  }

  const files = readdirSync(MODELS_DIR)
    .filter(f => f.endsWith('.json'))
    .filter(f => !slugArg || f === `${slugArg}.json`);

  let touched = 0, factsWritten = 0, skipped = 0;
  for (const f of files) {
    const filePath = join(MODELS_DIR, f);
    const slug = f.replace(/\.json$/, '');
    try {
      const result = await processModel(filePath, slug);
      if (result.skipped) {
        skipped++;
        continue;
      }
      if (result.written > 0) {
        touched++;
        factsWritten += result.written;
        log(`✓ ${slug}: ${result.written} fact(s) updated`);
      }
      for (const err of result.errors) warn(`  ${slug}: ${err}`);
    } catch (err) {
      warn(`${slug}: ${err.message}`);
    }
  }

  if (!slugArg) markSynced('hf');
  log(`done: ${touched} file(s) touched, ${factsWritten} fact(s), ${skipped} skipped (closed/no-hf)`);
}

main().catch(err => {
  console.error('[hf-sync] fatal:', err);
  process.exit(1);
});
