#!/usr/bin/env node
/**
 * Fetch, check and archive the documents the sizing method cites.
 *
 * For every source in src/data/sizing.json: fetch the URL, confirm each of
 * its quotes is on the page (with the checker's own text rules), archive the
 * bytes (`ingestBytes`), and stamp `fetched`, `snapshot_hash` and
 * `snapshot_ext`. A source whose quote is missing is reported and left
 * unstamped, so a rule never looks sourced when its document has changed.
 *
 *   pnpm sizing:sources
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ingestBytes } from './ingest-snapshots.mjs';
import { DATA_DIR, today } from './lib/facts.mjs';
import { normalize, visibleText } from './check-run.mjs';

const PATH = join(DATA_DIR, 'sizing.json');
const USER_AGENT = 'privateai-solutions-sizing/1.0 (+https://privateai.solutions)';

const sizing = JSON.parse(readFileSync(PATH, 'utf8'));
const pages = new Map();
let failed = 0;

async function fetchPage(url) {
  if (!pages.has(url)) {
    pages.set(url, (async () => {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const html = (res.headers.get('content-type') || '').includes('html');
      const text = buf.toString('utf8');
      return { buf, ext: html ? 'html' : 'txt', raw: normalize(text), visible: normalize(html ? visibleText(text) : text) };
    })());
  }
  return pages.get(url);
}

for (const source of sizing.sources) {
  try {
    const page = await fetchPage(source.url);
    const missing = source.quotes.filter(q => {
      const n = normalize(q);
      return !page.visible.includes(n) && !page.raw.includes(n);
    });
    if (missing.length) {
      failed++;
      console.error(`✗ ${source.id}: not on the page: ${missing.map(q => JSON.stringify(q)).join(', ')}`);
      continue;
    }
    const ingested = await ingestBytes(page.buf, page.ext, { source_url: source.url, source_kind: 'sizing', via: 'sizing-sources' });
    if (!ingested) {
      failed++;
      console.error(`✗ ${source.id}: quotes found, but not archived (RESEARCH_ROOT unset)`);
      continue;
    }
    if (source.snapshot_hash !== ingested.sha) source.fetched = today();
    source.snapshot_hash = ingested.sha;
    source.snapshot_ext = page.ext;
    console.log(`✓ ${source.id}: ${source.quotes.length} quote(s) found, archived ${ingested.sha.slice(0, 12)}`);
  } catch (err) {
    failed++;
    console.error(`✗ ${source.id}: ${err.message}`);
  }
}

writeFileSync(PATH, JSON.stringify(sizing, null, 2) + '\n', 'utf8');
if (failed) {
  console.error(`[sizing] ${failed} source(s) not confirmed`);
  process.exit(1);
}
console.log(`[sizing] ${sizing.sources.length} sources confirmed and archived`);
