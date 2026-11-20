#!/usr/bin/env node
/**
 * GitHub sync — deterministic auto-fill for harness facts.
 *
 * Sibling of sync-aa.mjs / sync-hf.mjs. For every harness with
 * `snapshot.github` set, we pull two endpoints:
 *
 *   1. GET /repos/<owner>/<repo>            → license, description, stars
 *   2. GET /repos/<owner>/<repo>/languages  → bytes-per-language map
 *
 * Facts auto-filled:
 *   license                  (from #1, .license.spdx_id — MIT, Apache-2.0, ...)
 *   language                 (from #2, list of {name, percent} sorted desc)
 *
 * Auth: reads GITHUB_TOKEN from env. Without a token GitHub allows 60
 * requests/hour by IP — enough for a full sync of ~5 harnesses but not
 * much headroom. With a token we get 5000/hour.
 *
 * Freshness gate: the whole sync skips if it ran < 24h ago (.sync-state.json),
 * unless --force is passed or a single harness slug is named.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { ingestBytes } from './ingest-snapshots.mjs';
import { DATA_DIR, markSynced, syncIsFresh, today, writeFact, writeEntity } from './lib/facts.mjs';

const HARNESSES_DIR = join(DATA_DIR, 'harnesses');

// If a language weighs under this fraction of the repo, roll it into "Other".
// GitHub reports every language it detects — most repos have a long tail of
// 0.1% shell scripts and CI configs that add noise.
const SMALL_LANG_THRESHOLD = 0.02;

const log = msg => console.log(`[gh-sync] ${msg}`);
const warn = msg => console.warn(`[gh-sync] ${msg}`);

function ghRepoFromUrl(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(/github\.com\/([^/?#]+\/[^/?#]+)/);
  if (!m) return null;
  return m[1].replace(/\.git$/, '');
}

async function fetchJson(url, token) {
  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'privateai-solutions/sync-github' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return { body: JSON.parse(buf.toString('utf8')), buf };
}

async function archive(buf, meta) {
  try {
    const r = await ingestBytes(buf, 'json', { via: 'sync-github', ...meta });
    return r?.sha ?? null;
  } catch (err) {
    warn(`archive failed: ${err.message}`);
    return null;
  }
}

/** Convert GitHub's bytes-per-language map into our list-fact shape:
 *  [{name, percent}] sorted descending, small languages folded into
 *  "Other". Rounded to 1dp. */
function languagesFromBytes(byteMap) {
  const total = Object.values(byteMap).reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  const rows = Object.entries(byteMap)
    .map(([name, bytes]) => ({ name, fraction: bytes / total }))
    .sort((a, b) => b.fraction - a.fraction);
  const big = rows.filter(r => r.fraction >= SMALL_LANG_THRESHOLD);
  const small = rows.filter(r => r.fraction < SMALL_LANG_THRESHOLD);
  const out = big.map(r => ({ name: r.name, percent: Math.round(r.fraction * 1000) / 10 }));
  if (small.length > 0) {
    const otherPct = small.reduce((a, r) => a + r.fraction, 0);
    out.push({ name: 'Other', percent: Math.round(otherPct * 1000) / 10 });
  }
  return out;
}

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
  return writeFact(data, { type: 'harness', slug }, key, entry);
}

async function processHarness(filePath, slug, token) {
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!data.facts) data.facts = {};

  const ghUrl = data.facts['snapshot.github']?.value;
  const repo = ghRepoFromUrl(ghUrl);
  if (!repo) return { skipped: 'no-github-snapshot' };

  let written = 0;
  const errors = [];

  // 1. Repo metadata → license
  try {
    const url = `https://api.github.com/repos/${repo}`;
    const { body, buf } = await fetchJson(url, token);
    const sha = await archive(buf, { source_url: url, source_kind: 'gh_repo' });
    const spdx = body?.license?.spdx_id;
    if (typeof spdx === 'string' && spdx !== 'NOASSERTION') {
      written += writeAutoFact(data, slug, 'license', spdx, ghUrl, sha);
    }
  } catch (err) {
    errors.push(`repo: ${err.message}`);
  }

  // 2. Languages
  try {
    const url = `https://api.github.com/repos/${repo}/languages`;
    const { body, buf } = await fetchJson(url, token);
    const sha = await archive(buf, { source_url: url, source_kind: 'gh_languages' });
    const rows = languagesFromBytes(body);
    written += writeAutoFact(data, slug, 'language', rows, ghUrl, sha);
  } catch (err) {
    errors.push(`languages: ${err.message}`);
  }

  if (written > 0) writeEntity('harness', slug, data);
  return { written, errors };
}

async function main() {
  const force = process.argv.includes('--force');
  const slugArg = process.argv.find(a => !a.startsWith('-') && !a.endsWith('.mjs') && !a.endsWith('node'));
  if (!force && !slugArg && syncIsFresh('github')) {
    log('ran < 24h ago — skipping (pass --force to run anyway).');
    return;
  }
  const token = process.env.GITHUB_TOKEN || null;
  if (!token) warn('GITHUB_TOKEN not set — using unauthenticated 60/hr limit.');

  const files = readdirSync(HARNESSES_DIR)
    .filter(f => f.endsWith('.json'))
    .filter(f => !slugArg || f === `${slugArg}.json`);

  let touched = 0, factsWritten = 0, skipped = 0;
  for (const f of files) {
    const filePath = join(HARNESSES_DIR, f);
    const slug = f.replace(/\.json$/, '');
    try {
      const result = await processHarness(filePath, slug, token);
      if (result.skipped) { skipped++; continue; }
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

  if (!slugArg) markSynced('github');
  log(`done: ${touched} file(s) touched, ${factsWritten} fact(s), ${skipped} skipped`);
}

main().catch(err => {
  console.error('[gh-sync] fatal:', err);
  process.exit(1);
});
