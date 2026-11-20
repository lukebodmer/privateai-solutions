#!/usr/bin/env node
/**
 * The checker — the only path from an agent's claim to the site.
 *
 *   node scripts/check-run.mjs <run-id> [--dry-run]
 *
 * Neuman's word is never the evidence. For every claim in
 * the run's claims.json the checker fetches the cited page itself,
 * archives the bytes it got (the receipt), and asks what the schema says
 * this fact needs:
 *
 *   - `quote` evidence: the quote is on the page as the checker saw it,
 *     and the claimed value is in the quote. Passes publish as
 *     `verified_by: "neuman"`; a value matching one Luke signed off keeps
 *     his signer and is re-confirmed.
 *   - `judgment` evidence: identity and classification, which no string
 *     match can settle. A value equal to the one on file, from the same
 *     source, is re-confirmed; anything new, changed or newly sourced
 *     waits for review.
 *
 * And, whatever the evidence:
 *   - a claim on a key whose writer is not `agent` is rejected;
 *   - a value that contradicts one Luke signed off waits for review,
 *     unless the fact is `volatile` (prices move; his sign-off was of
 *     the last checked number);
 *   - a numeric jump bigger than the fact's `max_change` waits for review.
 *
 * The verdicts, and later Luke's decisions on the review queue, live in
 * the run's result.json. Re-checking a run keeps decisions already made.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { ingestBytes } from './ingest-snapshots.mjs';
import { DATA_DIR, markSynced, readEntity, writeEntity, writeFact, today, valuesEqual } from './lib/facts.mjs';
import { currentRunId, readClaims, readResult, readRun, writeResult } from './lib/runs.mjs';
import { AA_CATALOG_URL } from './lib/aa.mjs';
import { ARENA_DATASET_URL } from './lib/arena.mjs';
import { OPENROUTER_MODELS_URL, isBaseId } from './lib/openrouter.mjs';
import { FACT_SCHEMAS, evidenceOf, factApplies } from '../src/data/schemas/factSchemas.ts';

const MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_CHANGE = 0.5;
const USER_AGENT = 'privateai-solutions-checker/1.0 (+https://privateai.solutions)';

/* ── Text ─────────────────────────────────────────────────────────── */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '-', mdash: '-', hellip: '...', times: 'x' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** What a reader of the page sees: markup, scripts and styles removed. */
export function visibleText(html) {
  return decodeEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' '));
}

/**
 * Reduce text to its words and numbers. Punctuation, markup remnants and
 * whitespace all become one space, so "Memory Size: 24 GB" matches a
 * table cell rendered as "Memory Size 24 GB" — but the words themselves,
 * in order, must be on the page. A point survives only inside a number.
 */
export function normalize(s) {
  return s.normalize('NFKC').toLowerCase()
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/[^\p{L}\p{N}.$%]+/gu, ' ')
    .trim();
}

const NUMBER_RE = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g;

function numbersIn(s) {
  return (s.match(NUMBER_RE) ?? []).map(n => parseFloat(n.replace(/,/g, '')));
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const pad = n => String(n).padStart(2, '0');
const monthOf = name => MONTHS.findIndex(m => m.startsWith(name.slice(0, 3).toLowerCase())) + 1;

/** Every date written in the quote, as YYYY-MM-DD or YYYY-MM. */
function datesIn(s) {
  const out = [];
  for (const m of s.matchAll(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/g)) out.push(`${m[1]}-${pad(m[2])}-${pad(m[3])}`);
  for (const m of s.matchAll(new RegExp(`${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, 'gi'))) out.push(`${m[3]}-${pad(monthOf(m[1]))}-${pad(m[2])}`);
  for (const m of s.matchAll(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE},?\\s+(\\d{4})`, 'gi'))) out.push(`${m[3]}-${pad(monthOf(m[2]))}-${pad(m[1])}`);
  for (const m of s.matchAll(new RegExp(`${MONTH_RE},?\\s+(\\d{4})`, 'gi'))) out.push(`${m[2]}-${pad(monthOf(m[1]))}`);
  return out;
}

/** Is the claimed value written in the quote? */
function valueInQuote(type, value, quote) {
  if (type === 'number') return numbersIn(quote).some(n => Math.abs(n - value) < 1e-9);
  if (type === 'date') {
    const found = datesIn(quote);
    return found.some(d => d === value || (value.length === 7 && d.startsWith(value)));
  }
  if (type === 'string') return ` ${normalize(quote)} `.includes(` ${normalize(value)} `);
  return false;
}

function typeMatches(entry, value) {
  if (value === null) return true;
  switch (entry.type) {
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'date': return typeof value === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value);
    case 'list': return Array.isArray(value) && value.every(r => r && typeof r === 'object'
      && entry.shape.columns.every(c => r[c.name] === null || typeof r[c.name] === c.type));
    case 'snapshot': return typeof value === 'string' && /^https?:\/\//.test(value);
    default: return typeof value === 'string';
  }
}

/* ── Sources ──────────────────────────────────────────────────────── */

function extFor(contentType) {
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('pdf')) return 'pdf';
  if (contentType.includes('xml')) return 'xml';
  if (contentType.includes('text/plain')) return 'txt';
  return 'html';
}

/** Fetch and archive one URL. Cached per run: ten claims citing one page
 *  are one request and one receipt. */
async function fetchSource(url, runId, cache, dryRun) {
  if (cache.has(url)) return cache.get(url);
  const promise = (async () => {
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    } catch (err) {
      return { error: `fetch failed: ${err.message}` };
    }
    if (!res.ok) return { error: `the source answered HTTP ${res.status} to the checker` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return { error: `source is ${buf.length} bytes, over the checker's limit` };
    const ext = extFor(res.headers.get('content-type') || 'text/html');
    let sha = null;
    if (!dryRun) {
      const ingested = await ingestBytes(buf, ext, { source_url: url, source_kind: 'claim', via: 'check-run', run: runId });
      sha = ingested?.sha ?? null;
    }
    if (ext === 'pdf') return { ext, sha, error: 'the source is a PDF, which the checker cannot read' };
    const raw = buf.toString('utf8');
    const visible = ext === 'html' ? visibleText(raw) : raw;
    return { ext, sha, raw: normalize(raw), visible: normalize(visible) };
  })();
  cache.set(url, promise);
  return promise;
}

/** `aa_id` is checked against the AA catalog sync-aa archived, not a page:
 *  AA's public model pages do not print the UUID. */
function checkAaId(value) {
  const snapshot = JSON.parse(readFileSync(join(DATA_DIR, 'aa-snapshot.json'), 'utf8'));
  const hit = snapshot.data?.find(m => m.id === value);
  return hit ? { note: `AA lists this id as "${hit.name}" by ${hit.model_creator?.name ?? '?'}` } : { error: 'not an id in the AA catalog' };
}

/** `arena_name` likewise, against the leaderboard sync-arena keeps on disk. */
function checkArenaName(value) {
  const snapshot = JSON.parse(readFileSync(join(DATA_DIR, 'arena-snapshot.json'), 'utf8'));
  const hit = snapshot.data?.find(r => r.model_name === value);
  return hit
    ? { note: `Arena ranks "${hit.model_name}" by ${hit.organization} at #${hit.rank} overall, ${hit.vote_count} votes` }
    : { error: 'not a model_name on the Arena leaderboard' };
}

/** `openrouter_id` likewise, against the catalog sync-openrouter keeps on disk. */
function checkOpenrouterId(value) {
  if (!isBaseId(value)) return { error: 'a routing variant or alias, not a model id' };
  const snapshot = JSON.parse(readFileSync(join(DATA_DIR, 'openrouter-snapshot.json'), 'utf8'));
  const hit = snapshot.catalog?.find(m => m.id === value);
  return hit ? { note: `OpenRouter lists this id as "${hit.name}"` } : { error: 'not an id in the OpenRouter catalog' };
}

/* ── Verdicts ─────────────────────────────────────────────────────── */

const verdict = (outcome, reason, extra = {}) => ({ outcome, reason, ...extra });

/** Judge one claim. Pure apart from fetching and archiving the source. */
async function judge(claim, runId, cache, dryRun) {
  if (!claim || typeof claim !== 'object') return verdict('rejected', 'not an object');
  const [type, slug] = String(claim.entity ?? '').split('/');
  const entry = FACT_SCHEMAS[type]?.find(s => s.key === claim.key);
  if (!entry) return verdict('rejected', `no fact \`${claim.key}\` on entity type \`${type}\``);
  const data = readEntity(type, slug);
  if (!data) return verdict('rejected', `no entity ${claim.entity}`);
  if (entry.writer !== 'agent') return verdict('rejected', `\`${claim.key}\` is written by ${entry.writer === 'sync' ? 'a sync script' : 'Luke'}, not an agent`);
  if (!factApplies(entry, data)) return verdict('rejected', `\`${claim.key}\` does not apply to this entity`);
  const current = data.facts[claim.key];
  if (current?.na === true) return verdict('rejected', `\`${claim.key}\` is marked N/A`);
  const ctx = { type, slug, entry, current };

  if (claim.na === true) return verdict('review', 'proposes marking this fact N/A', ctx);
  if (typeof claim.source !== 'string' || !/^https?:\/\//.test(claim.source)) return verdict('rejected', 'no http(s) source', ctx);
  if (!('value' in claim)) return verdict('rejected', 'no value', ctx);
  if (!typeMatches(entry, claim.value)) return verdict('rejected', `value is not a ${entry.type}`, ctx);
  if (entry.type === 'snapshot' && claim.source !== claim.value) return verdict('rejected', 'a snapshot claim cites its own URL as source', ctx);

  if (claim.key === 'aa_id') {
    if (claim.source !== AA_CATALOG_URL) return verdict('rejected', `aa_id cites ${AA_CATALOG_URL}`, ctx);
    const aa = claim.value === null ? { note: 'proposes that AA does not track this model' } : checkAaId(claim.value);
    if (aa.error) return verdict('rejected', aa.error, ctx);
    return settleJudgment(ctx, claim, aa.note);
  }

  if (claim.key === 'openrouter_id') {
    if (claim.source !== OPENROUTER_MODELS_URL) return verdict('rejected', `openrouter_id cites ${OPENROUTER_MODELS_URL}`, ctx);
    const or = claim.value === null ? { note: 'proposes that OpenRouter does not serve this model' } : checkOpenrouterId(claim.value);
    if (or.error) return verdict('rejected', or.error, ctx);
    return settleJudgment(ctx, claim, or.note);
  }

  if (claim.key === 'arena_name') {
    if (claim.source !== ARENA_DATASET_URL) return verdict('rejected', `arena_name cites ${ARENA_DATASET_URL}`, ctx);
    const arena = claim.value === null ? { note: 'proposes that Arena does not rank this model' } : checkArenaName(claim.value);
    if (arena.error) return verdict('rejected', arena.error, ctx);
    return settleJudgment(ctx, claim, arena.note);
  }

  const page = await fetchSource(claim.source, runId, cache, dryRun);
  const receipt = page.sha ? { snapshot_hash: page.sha, snapshot_ext: page.ext } : {};
  if (page.error) return verdict('review', page.error, { ...ctx, ...receipt });

  const quote = typeof claim.quote === 'string' ? claim.quote : null;
  let quoteOnPage = false;
  if (quote !== null) {
    const q = normalize(quote);
    if (q.length < 6 || quote.length > 600) return verdict('review', 'quote is too short or too long to check', { ...ctx, ...receipt });
    quoteOnPage = page.visible.includes(q) || page.raw.includes(q);
    if (!quoteOnPage) {
      // Bot walls answer 200 with a challenge page, so "quote not found"
      // would blame Neuman for the site refusing the checker.
      const walled = /bot check|captcha|checking your browser|enable javascript|just a moment|access denied/.test(page.visible);
      return verdict('review', walled
        ? 'the source served the checker a bot challenge instead of the page'
        : 'the quote is not on the page the checker fetched', { ...ctx, ...receipt });
    }
  }

  if (claim.value === null) return verdict('review', 'proposes that the source does not publish this value', { ...ctx, ...receipt });

  if (evidenceOf(entry) === 'judgment') return settleJudgment({ ...ctx, ...receipt }, claim, null);

  if (!quoteOnPage) return verdict('review', 'no quote to check the value against', { ...ctx, ...receipt });
  if (!valueInQuote(entry.type, claim.value, quote)) return verdict('review', `the quote does not contain ${JSON.stringify(claim.value)}`, { ...ctx, ...receipt });

  const signedOff = current?.verified_by === 'luke';
  const same = current && valuesEqual(current.value, claim.value);
  if (signedOff && !same && !entry.volatile) return verdict('review', `contradicts the value Luke signed off (${JSON.stringify(current.value)})`, { ...ctx, ...receipt });

  if (entry.type === 'number' && typeof current?.value === 'number' && current.value !== 0) {
    const change = Math.abs(claim.value - current.value) / Math.abs(current.value);
    const limit = entry.max_change ?? DEFAULT_MAX_CHANGE;
    if (change > limit) return verdict('review', `moves ${Math.round(change * 100)}% from ${current.value}, more than the ${Math.round(limit * 100)}% the checker publishes alone`, { ...ctx, ...receipt });
  }
  // A matching value keeps the signer it already has, so a re-confirmation
  // never quietly turns Luke's sign-off into Neuman's.
  const signer = same && current?.verified_by === 'luke' ? 'luke' : 'neuman';
  const reason = same
    ? (signer === 'luke' ? 'matches the value Luke signed off; re-confirmed' : 'quote and value found on the page (re-confirmed)')
    : 'quote and value found on the page';
  return verdict('applied', reason, { ...ctx, ...receipt, signer });
}

function settleJudgment(ctx, claim, note) {
  const { current } = ctx;
  const extra = note ? { ...ctx, note } : ctx;
  const sameValue = current?.verified_by && valuesEqual(current.value, claim.value);
  if (sameValue && current.source === claim.source) {
    const signer = current.verified_by === 'luke' ? 'luke' : 'neuman';
    const whose = signer === 'luke' ? 'the value Luke signed off' : 'the value on file';
    return verdict('applied', `matches ${whose}; re-confirmed`, { ...extra, signer });
  }
  return verdict('review', 'a judgment fact — new or changed values are reviewed', extra);
}

/** The fact a claim becomes, signed by `signer`. */
function factFromClaim(claim, signer, receipt) {
  const entry = {
    value: claim.value,
    source: claim.source,
    fetched: today(),
    verified_by: signer,
    verified_at: today(),
  };
  if (typeof claim.quote === 'string') entry.quote = claim.quote;
  if (receipt.snapshot_hash) {
    entry.snapshot_hash = receipt.snapshot_hash;
    entry.snapshot_ext = receipt.snapshot_ext;
  }
  return entry;
}

/* ── Entry points ─────────────────────────────────────────────────── */

/** Check every claim in a run. Applies passing claims unless `dryRun`,
 *  and writes the run's result.json. Returns the result. */
export async function checkRun(id, { dryRun = false } = {}) {
  if (!readRun(id)) throw new Error(`no run ${id}`);
  const claims = readClaims(id);
  if (!claims) throw new Error(`${id}/claims.json does not exist — the research step wrote no claims`);
  const previous = readResult(id);
  const cache = new Map();
  const rows = [];

  for (const [index, claim] of claims.entries()) {
    // A decision Luke already made on this exact claim stands.
    const prior = previous?.claims?.[index];
    if (prior?.decision && JSON.stringify(prior.claim) === JSON.stringify(claim)) {
      rows.push(prior);
      continue;
    }
    const v = await judge(claim, id, cache, dryRun);
    const row = { index, claim, outcome: v.outcome, reason: v.reason };
    if (v.note) row.note = v.note;
    if (v.signer) row.signer = v.signer;
    if (v.current) row.current = { value: v.current.value, verified_by: v.current.verified_by };
    if (v.snapshot_hash) Object.assign(row, { snapshot_hash: v.snapshot_hash, snapshot_ext: v.snapshot_ext });

    if (v.outcome === 'applied' && !dryRun) {
      const data = readEntity(v.type, v.slug);
      writeFact(data, { type: v.type, slug: v.slug }, claim.key, factFromClaim(claim, v.signer ?? 'neuman', v), { reconfirm: true });
      writeEntity(v.type, v.slug, data);
    }
    rows.push(row);
  }

  const result = { run: id, checked: new Date().toISOString(), claims: rows };
  if (!dryRun) writeResult(id, result);
  return result;
}

/** Luke's decision on one review item: `accept` applies the claim as his
 *  own sign-off (or marks the fact N/A), `reject` records the refusal. */
export function decide(id, index, action) {
  if (action !== 'accept' && action !== 'reject') throw new Error('action must be accept or reject');
  const result = readResult(id);
  const row = result?.claims?.[index];
  if (!row) throw new Error(`no claim ${index} in run ${id}`);
  if (row.outcome !== 'review') throw new Error(`claim ${index} is ${row.outcome}, not awaiting review`);
  if (row.decision) throw new Error(`claim ${index} was already ${row.decision.action}ed`);

  if (action === 'accept') {
    const { claim } = row;
    const [type, slug] = claim.entity.split('/');
    const data = readEntity(type, slug);
    if (claim.na === true) {
      data.facts[claim.key] = { ...(data.facts[claim.key] ?? { value: null, source: null, fetched: null, verified_by: null, verified_at: null }), na: true };
    } else {
      writeFact(data, { type, slug }, claim.key, factFromClaim(claim, 'luke', row));
    }
    writeEntity(type, slug, data);
  }
  row.decision = { action, at: new Date().toISOString() };
  writeResult(id, result);
  return row;
}

function summarize(result) {
  const count = o => result.claims.filter(c => c.outcome === o).length;
  return `applied ${count('applied')}, review ${count('review')}, rejected ${count('rejected')}`;
}

// `pnpm check` with no run id is the Neuman task's last step, and checks
// the run it is part of; for a sweep, it then records the run's start as
// the date the next one looks for news since. With an id, it re-checks any
// run by hand.
if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes('--dry-run');
  let id = process.argv.slice(2).find(arg => !arg.startsWith('--'));
  const asTaskStep = !id;
  try { id ??= currentRunId(); }
  catch (err) {
    console.error(`usage: node scripts/check-run.mjs [<run-id>] [--dry-run] — ${err.message}`);
    process.exit(2);
  }
  checkRun(id, { dryRun })
    .then(result => {
      for (const c of result.claims) {
        console.log(`${c.outcome.padEnd(9)} ${c.claim?.entity ?? '?'} ${c.claim?.key ?? '?'} = ${JSON.stringify(c.claim?.value)} — ${c.reason}`);
      }
      console.log(`[check] ${id}${dryRun ? ' (dry run)' : ''}: ${summarize(result)}`);
      const run = readRun(id);
      if (asTaskStep && !dryRun && run?.kind === 'sweep') markSynced('last-sweep', run.created);
    })
    .catch(err => {
      console.error(`[check] ${err.message}`);
      process.exit(1);
    });
}
