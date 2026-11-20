#!/usr/bin/env node
/**
 * Admin write-back server for the dashboard.
 *
 * Runs alongside `astro dev` (via scripts/dev.mjs) or standalone.
 *
 * Endpoints:
 *   POST /apply-patch               — write Luke's fact edits (value/source/verify/N/A)
 *   POST /onboard-{model,company,part,harness}
 *                                   — create the entity from its seed and queue the run that fills it
 *   POST /create-build              — create an empty build ({name, slug}); Luke fills it in the dashboard
 *   POST /delete-entity             — remove an entity's file and its logo, dropping its queued requests
 *   GET  /runs                      — every run and the queue
 *   GET  /runs/<id>                 — one run: Neuman's record, brief, report, claims, result
 *   POST /queue                     — queue a refresh ({type, slug})
 *   POST /runs/<id>/check           — re-run the checker on a run's claims
 *   POST /runs/<id>/review          — accept or reject one review item ({index, action})
 *   POST /runs/<id>/delete          — remove a run's directory
 *   POST /dequeue                   — drop a queued request ({id})
 *   GET  /news                      — the news feed
 *   POST /news/{add,update,delete}  — add a link ({url, title?}), correct an item, remove one
 *   GET  /snapshot/<sha>.<ext>      — serve an archived blob
 *
 * Nothing here starts Neuman: the task API takes a browser session, not a
 * script (NEUMAN_FEEDBACK.md). What the dashboard asks for is queued
 * (scripts/lib/queue.mjs), and Run now on the task in Neuman takes it.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, createReadStream } from 'fs';
import { join } from 'path';
import { createServer } from 'http';
import { createGunzip } from 'zlib';
import { ingestBytes, researchRoot } from './ingest-snapshots.mjs';
import { ROOT, ENTITY_DIR, deleteEntity, entityPath, isValidSlug, readEntity, recordChange, today, writeEntity } from './lib/facts.mjs';
import { deleteRun, listRuns, readBrief, readClaims, readNeuman, readReport, readResult, readRun } from './lib/runs.mjs';
import { dequeue, enqueue, listQueue } from './lib/queue.mjs';
import { addNews, deleteNews, listNews, updateNews } from './lib/news.mjs';
import { checkRun, decide } from './check-run.mjs';

/** `src/data/<dir>/<slug>.json` → [type, slug], or null. Whitelisting
 *  enforces "no writes outside the four entity directories". */
const DIR_TYPE = { models: 'model', builds: 'build', parts: 'part', companies: 'company', harnesses: 'harness' };
function entityFromPath(relPath) {
  const match = typeof relPath === 'string' && relPath.match(/^src\/data\/([^/]+)\/([^/]+)\.json$/);
  if (!match || !DIR_TYPE[match[1]] || !isValidSlug(match[2])) return null;
  return [DIR_TYPE[match[1]], match[2]];
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

/** Fetch a URL and archive it via the content-addressed ingest. Returns
 *  { sha, ext } or throws. `kind` labels the manifest entry. */
async function captureUrl(url, kind, via) {
  const res = await fetch(url, {
    headers: { 'User-Agent': `privateai-solutions/${via}` },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') || 'text/html';
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = contentType.includes('json') ? 'json'
             : contentType.includes('pdf') ? 'pdf'
             : 'html';
  const result = await ingestBytes(buf, ext, { source_url: url, source_kind: kind, via });
  return { sha: result?.sha ?? null, ext };
}

/* ─────────────────────────── /apply-patch ─────────────────────────── */

/** For a fact being verified by Luke, capture its source URL to the
 *  archive if we don't already have a snapshot. Best-effort: fetch
 *  failure logs a warning and leaves snapshot_hash unset. The verify
 *  itself still lands — we never block sign-off on network flakiness.
 *  For snapshot.* facts the URL is `fact.value`; for data facts it's
 *  `fact.source`. */
async function snapshotOnVerify(fact, factKey) {
  if (fact.snapshot_hash) return false;
  const url = factKey.startsWith('snapshot.') ? fact.value : fact.source;
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return false;
  try {
    const capture = await captureUrl(url, `verify:${factKey}`, 'apply-patch');
    if (!capture.sha) return false;
    fact.snapshot_hash = capture.sha;
    fact.snapshot_ext = capture.ext;
    return true;
  } catch (err) {
    console.warn(`[admin] snapshot on verify failed for ${factKey} (${url}): ${err.message}`);
    return false;
  }
}

async function applyPatch(body) {
  const results = [];
  const nowIso = today();

  for (const [relPath, updates] of Object.entries(body)) {
    const ref = entityFromPath(relPath);
    const data = ref && readEntity(...ref);
    if (!data) {
      results.push({ file: relPath, status: 'not found', updated: 0 });
      continue;
    }
    const [type, slug] = ref;
    let updated = 0;
    const factsToSnapshot = [];

    for (const u of updates) {
      let fact = data.facts[u.fact_key];
      if (!fact) {
        // A bare Verify click on a missing fact has nothing to persist.
        if (!('value' in u) && !('source' in u) && !('na' in u)) continue;
        fact = { value: null, source: null, fetched: nowIso, verified_by: null, verified_at: null };
        data.facts[u.fact_key] = fact;
      }
      const previous = fact.value;

      const becomingVerified = u.verified_by === 'luke' && fact.verified_by !== 'luke';
      const editedContent = 'value' in u || 'source' in u;

      fact.verified_by = u.verified_by;
      fact.verified_at = u.verified_by === null ? null : nowIso;
      if ('value' in u) { fact.value = u.value; fact.fetched = nowIso; }
      if ('source' in u) fact.source = u.source;
      if ('na' in u) {
        if (u.na === true) fact.na = true;
        else delete fact.na;
      }
      // An edited value no longer matches the quote or the receipt that
      // backed the old one.
      if (editedContent) {
        delete fact.quote;
        delete fact.snapshot_hash;
        delete fact.snapshot_ext;
      }
      if ('value' in u) recordChange({ type, slug }, u.fact_key, previous, fact);
      if (u.verified_by === 'luke' && (becomingVerified || editedContent)) factsToSnapshot.push(u.fact_key);
      updated++;
    }

    const snapshotted = (await Promise.all(factsToSnapshot.map(k => snapshotOnVerify(data.facts[k], k)))).filter(Boolean).length;
    writeEntity(type, slug, data);
    results.push({ file: relPath, status: 'ok', updated, snapshotted });
  }

  return results;
}

/* ─────────────────────────── onboarding ─────────────────────────── */

const isUrl = s => typeof s === 'string' && /^https?:\/\//.test(s);

/** Fetch an image URL and write it to public/logos/<dir>/<slug>.<ext>.
 *  Extension is chosen from Content-Type. Overwrites an existing file
 *  (onboarding a new entity → new asset). */
async function saveImage(url, dir, slug) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'privateai-solutions/onboard' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`fetch image: HTTP ${res.status}`);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const ext = ct.includes('svg') ? 'svg'
            : ct.includes('png') ? 'png'
            : ct.includes('webp') ? 'webp'
            : ct.includes('jpeg') || ct.includes('jpg') ? 'jpg'
            : null;
  if (!ext) throw new Error(`unsupported image content-type: ${ct || '(none)'}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('image was empty');
  const targetDir = join(ROOT, 'public', 'logos', dir);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, `${slug}.${ext}`), buf);
  return `public/logos/${dir}/${slug}.${ext}`;
}

/** Validate what every onboarding shares and return the trimmed name. */
function checkSeed(type, { name, slug, disambiguation }, { requireDisambiguation = true } = {}) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('name required');
  if (!isValidSlug(slug)) throw new Error('slug must match [a-z0-9][a-z0-9._-]{0,63}');
  const text = typeof disambiguation === 'string' ? disambiguation.trim() : '';
  if (text && text.length < 5) throw new Error('disambiguation must be at least 5 characters if provided');
  if (requireDisambiguation && !text) throw new Error('disambiguation must be a non-trivial string (min 5 chars)');
  if (existsSync(entityPath(type, slug))) throw new Error(`${type} already exists: ${slug}`);
  return name.trim();
}

/** A seed fact: what Luke typed into the onboarding form. Unverified —
 *  it is his input, not something anyone checked — and the run's first
 *  job is to confirm it. */
const seedFact = (value, source) => ({ value, source, fetched: today(), verified_by: null, verified_at: null });

/** Write the seeded entity and queue the run that fills it. */
function seedAndQueue(type, slug, name, facts, disambiguation, seed) {
  const text = typeof disambiguation === 'string' ? disambiguation.trim() : '';
  writeEntity(type, slug, { name, slug, facts, references: [] });
  return enqueue({
    kind: 'onboard',
    entity: `${type}/${slug}`,
    title: `Onboard ${name}`,
    onboarding: { ...(text ? { disambiguation: text } : {}), seed },
  });
}

const DISTRIBUTIONS = new Set(['open', 'closed', 'gated']);
/** Part class → its image directory under public/logos/ (partLogoDir in factSchemas.ts). */
const PART_CLASSES = { gpu: 'gpus', system: 'systems' };

async function onboardModel(body) {
  const name = checkSeed('model', body);
  const { slug, announcement_url, distribution, disambiguation } = body;
  if (!isUrl(announcement_url)) throw new Error('announcement_url must be an http(s) URL');
  if (!DISTRIBUTIONS.has(distribution)) throw new Error(`distribution must be one of: ${[...DISTRIBUTIONS].join(', ')}`);
  return seedAndQueue('model', slug, name, {
    distribution: seedFact(distribution, announcement_url),
    'snapshot.official_announcement': seedFact(announcement_url, announcement_url),
  }, disambiguation, [['Official announcement', announcement_url]]);
}

async function onboardPart(body) {
  const name = checkSeed('part', body);
  const { slug, cls, maker_url, product_image_url, disambiguation } = body;
  if (!(cls in PART_CLASSES)) throw new Error(`class must be one of: ${Object.keys(PART_CLASSES).join(', ')}`);
  if (!isUrl(maker_url)) throw new Error('maker_url must be an http(s) URL');
  if (product_image_url && !isUrl(product_image_url)) throw new Error('product_image_url must be an http(s) URL if provided');
  // The image is part of the seed; fetch it first so a failure leaves no
  // half-created entity on disk.
  if (product_image_url) await saveImage(product_image_url, PART_CLASSES[cls], slug);
  return seedAndQueue('part', slug, name, {
    class: seedFact(cls, maker_url),
    'snapshot.maker': seedFact(maker_url, maker_url),
  }, disambiguation, [['Maker page', maker_url], ['Class', cls]]);
}

async function onboardHarness(body) {
  const name = checkSeed('harness', body);
  const { slug, github_url, logo_image_url, disambiguation } = body;
  if (typeof github_url !== 'string' || !/^https?:\/\/github\.com\//.test(github_url)) throw new Error('github_url must be a github.com URL');
  if (logo_image_url && !isUrl(logo_image_url)) throw new Error('logo_image_url must be an http(s) URL if provided');
  if (logo_image_url) await saveImage(logo_image_url, 'harnesses', slug);
  return seedAndQueue('harness', slug, name, {
    'snapshot.github': seedFact(github_url, github_url),
  }, disambiguation, [['GitHub', github_url]]);
}

async function onboardCompany(body) {
  const name = checkSeed('company', body, { requireDisambiguation: false });
  const { slug, official_url, wikipedia_url, huggingface_org_url, disambiguation } = body;
  if (!isUrl(official_url)) throw new Error('official_url must be an http(s) URL');
  if (!isUrl(wikipedia_url)) throw new Error('wikipedia_url must be an http(s) URL');
  if (huggingface_org_url && !isUrl(huggingface_org_url)) throw new Error('huggingface_org_url must be an http(s) URL if provided');
  const facts = {
    'snapshot.official': seedFact(official_url, official_url),
    'snapshot.wikipedia': seedFact(wikipedia_url, wikipedia_url),
  };
  const seed = [['Official site', official_url], ['Wikipedia', wikipedia_url]];
  if (huggingface_org_url) {
    facts['snapshot.huggingface_org'] = seedFact(huggingface_org_url, huggingface_org_url);
    seed.push(['Hugging Face org', huggingface_org_url]);
  }
  return seedAndQueue('company', slug, name, facts, disambiguation, seed);
}

/** A build is Luke's, not researched: it starts empty, with no run. */
function createBuild(body) {
  const { name, slug } = body;
  if (typeof name !== 'string' || !name.trim()) throw new Error('name required');
  if (!isValidSlug(slug)) throw new Error('slug must match [a-z0-9][a-z0-9._-]{0,63}');
  if (existsSync(entityPath('build', slug))) throw new Error(`build already exists: ${slug}`);
  writeEntity('build', slug, { name: name.trim(), slug, facts: {}, references: [] });
  return { entity: `build/${slug}`, title: `Created build ${name.trim()}` };
}

const ONBOARD = {
  '/onboard-model': onboardModel,
  '/onboard-part': onboardPart,
  '/create-build': createBuild,
  '/onboard-harness': onboardHarness,
  '/onboard-company': onboardCompany,
};

/* ─────────────────────────── deleting ─────────────────────────── */

/** Every entity of a type, with its parsed JSON. */
function entitiesOf(type) {
  const dir = join(ROOT, 'src/data', ENTITY_DIR[type]);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => ({ slug: name.slice(0, -'.json'.length), data: JSON.parse(readFileSync(join(dir, name), 'utf8')) }));
}

/** The logo directory an entity's artwork lives in: parts split by
 *  class, the other types use their plural. */
const LOGO_DIR = { model: 'models', build: 'builds', company: 'companies', harness: 'harnesses' };
function logoDir(type, data) {
  if (type === 'part') return PART_CLASSES[data.facts?.class?.value] ?? null;
  return LOGO_DIR[type] ?? null;
}

/** Remove `public/logos/<dir>/<slug>.<ext>` for whatever extensions exist. */
function deleteLogos(type, slug, data) {
  const dir = logoDir(type, data);
  if (!dir) return [];
  const abs = join(ROOT, 'public', 'logos', dir);
  if (!existsSync(abs)) return [];
  const removed = [];
  for (const name of readdirSync(abs)) {
    if (name.replace(/\.[^.]+$/, '') !== slug) continue;
    rmSync(join(abs, name), { force: true });
    removed.push(`public/logos/${dir}/${name}`);
  }
  return removed;
}

/** Entities that name this one and would be left pointing at nothing: a
 *  company named by a model's or harness's `company_slug`, a part or a
 *  model named in a build's `parts` or `models` list. */
function referencesTo(type, slug) {
  if (type === 'company') {
    return ['model', 'harness'].flatMap(t => entitiesOf(t)
      .filter(e => e.data.facts?.company_slug?.value === slug)
      .map(e => `${t}/${e.slug}`));
  }
  const list = { part: ['parts', 'part'], model: ['models', 'model'] }[type];
  if (!list) return [];
  const [key, column] = list;
  return entitiesOf('build')
    .filter(e => (e.data.facts?.[key]?.value ?? []).some(row => row?.[column] === slug))
    .map(e => `build/${e.slug}`);
}

/** Delete an entity's file and logo, and drop the requests queued for it.
 *  An entity another still names is refused (see referencesTo): the pages
 *  that name it would lose it with nothing on them to say why. */
function deleteEntityFromRequest(body) {
  const { type, slug } = body;
  if (!ENTITY_DIR[type]) throw new Error(`type must be one of: ${Object.keys(ENTITY_DIR).join(', ')}`);
  if (!isValidSlug(slug)) throw new Error('slug must match [a-z0-9][a-z0-9._-]{0,63}');
  const data = readEntity(type, slug);
  if (!data) throw new Error(`no ${type}/${slug}`);
  const blocking = referencesTo(type, slug);
  if (blocking.length) throw new Error(`still named by ${blocking.join(', ')} — re-point or delete those first`);
  const dropped = listQueue().filter(r => r.entity === `${type}/${slug}`);
  for (const r of dropped) dequeue(r.id);
  const logos = deleteLogos(type, slug, data);
  const file = deleteEntity(type, slug).replace(`${ROOT}/`, '');
  return { entity: `${type}/${slug}`, file, logos, dropped: dropped.map(r => r.id) };
}

/* ─────────────────────────── runs ─────────────────────────── */

function queueFromRequest(body) {
  const { type, slug } = body;
  const entity = readEntity(type, slug);
  if (!entity) throw new Error(`no ${type}/${slug}`);
  return enqueue({ kind: 'refresh', entity: `${type}/${slug}`, title: `Refresh ${entity.name}` });
}

function runDetail(id) {
  const run = readRun(id);
  const neuman = readNeuman(id);
  if (!run && !neuman) throw new Error(`no run ${id}`);
  let claims = null, claimsError = null;
  try { claims = readClaims(id); } catch (err) { claimsError = err.message; }
  return {
    run,
    neuman,
    brief: readBrief(id),
    report: readReport(id),
    claims,
    claims_error: claimsError,
    result: readResult(id),
  };
}

/* ─────────────────────────── GET /snapshot/... ─────────────────────────── */

// Extension → content-type. Everything else refuses. Whitelist prevents
// serving arbitrary files with attacker-controlled types.
const SNAPSHOT_CONTENT_TYPES = {
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
};
// Match `ingest-snapshots.mjs`. Anything not in this set is stored raw
// (no .gz), matching what the ingester did on write.
const NO_GZIP_EXT = new Set(['gz', 'zip', 'br', 'zst', 'png', 'jpg', 'jpeg', 'webp', 'pdf', 'mp4', 'mkv']);

/** Serve a snapshot blob from the content-addressed archive. Path shape:
 *  `/snapshot/<sha>.<ext>`. Reads `$RESEARCH_ROOT/blobs/<sha[:2]>/<sha>.<ext>[.gz]`,
 *  gunzips on the fly if the file is stored compressed. */
function serveSnapshot(req, res) {
  const match = (req.url || '').match(/^\/snapshot\/([a-f0-9]{64})\.([a-z0-9]{1,8})$/);
  const fail = (code, msg) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'text/plain');
    res.end(msg);
  };
  if (!match) return fail(400, 'bad snapshot path — expected /snapshot/<sha>.<ext>');
  const [, sha, ext] = match;
  const contentType = SNAPSHOT_CONTENT_TYPES[ext];
  if (!contentType) return fail(415, `unsupported extension: ${ext}`);
  const root = researchRoot();
  if (!root) return fail(503, 'RESEARCH_ROOT unset — no snapshot archive');
  const compressed = !NO_GZIP_EXT.has(ext);
  const blobPath = join(root, 'blobs', sha.slice(0, 2), `${sha}.${ext}${compressed ? '.gz' : ''}`);
  if (!existsSync(blobPath)) return fail(404, `snapshot not found: ${sha}.${ext}`);
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  // Inline so browsers render HTML/PDF in place rather than downloading.
  res.setHeader('Content-Disposition', 'inline');
  const stream = createReadStream(blobPath);
  if (compressed) stream.pipe(createGunzip()).pipe(res);
  else stream.pipe(res);
}

/* ─────────────────────────── HTTP server ─────────────────────────── */

export function startAdminServer(port = 4322) {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:4321');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    if (req.method === 'GET' && req.url?.startsWith('/snapshot/')) { serveSnapshot(req, res); return; }

    res.setHeader('Content-Type', 'application/json');
    const reply = (body, code = 200) => { res.statusCode = code; res.end(JSON.stringify(body)); };
    const runMatch = (req.url || '').match(/^\/runs\/([a-z0-9][a-z0-9._-]*)(?:\/(check|review|delete))?$/);

    try {
      if (req.method === 'GET' && req.url === '/runs') return reply({ ok: true, runs: listRuns(), queue: listQueue() });
      if (req.method === 'GET' && runMatch && !runMatch[2]) return reply({ ok: true, ...runDetail(runMatch[1]) });
      if (req.method === 'GET' && req.url === '/news') return reply({ ok: true, items: listNews() });
      if (req.method !== 'POST') return reply({ ok: false, error: 'method not allowed' }, 405);

      if (req.url === '/apply-patch') {
        const results = await applyPatch(await readBody(req));
        const n = results.filter(r => r.updated > 0).length;
        const shots = results.reduce((a, r) => a + (r.snapshotted || 0), 0);
        if (n > 0) console.log(`[admin] wrote patch to ${n} file(s)${shots ? ` — ${shots} snapshot(s) taken on verify` : ''}`);
        return reply({ ok: true, results });
      }

      if (ONBOARD[req.url]) {
        const request = await ONBOARD[req.url](await readBody(req));
        console.log(`[admin] ${request.title}`);
        return reply({ ok: true, request });
      }

      if (req.url === '/delete-entity') {
        const result = deleteEntityFromRequest(await readBody(req));
        console.log(`[admin] deleted ${result.entity}${result.logos.length ? ` (+${result.logos.length} logo)` : ''}`);
        return reply({ ok: true, ...result });
      }

      if (req.url === '/queue') {
        const request = queueFromRequest(await readBody(req));
        console.log(`[admin] queued ${request.title}`);
        return reply({ ok: true, request });
      }

      if (req.url === '/dequeue') {
        const { id } = await readBody(req);
        dequeue(id);
        console.log(`[admin] dropped queued request ${id}`);
        return reply({ ok: true });
      }

      if (req.url === '/news/add') {
        const { url, title } = await readBody(req);
        const item = await addNews(url, title);
        console.log(`[admin] news: ${item.title} (${item.source}, ${item.date})`);
        return reply({ ok: true, item });
      }

      if (req.url === '/news/update') return reply({ ok: true, item: updateNews(await readBody(req)) });

      if (req.url === '/news/delete') {
        deleteNews((await readBody(req)).url);
        return reply({ ok: true });
      }

      if (runMatch?.[2] === 'delete') {
        deleteRun(runMatch[1]);
        console.log(`[admin] deleted run ${runMatch[1]}`);
        return reply({ ok: true });
      }

      if (runMatch?.[2] === 'check') {
        const result = await checkRun(runMatch[1]);
        console.log(`[admin] checked run ${runMatch[1]}`);
        return reply({ ok: true, result });
      }

      if (runMatch?.[2] === 'review') {
        const { index, action } = await readBody(req);
        const row = decide(runMatch[1], index, action);
        console.log(`[admin] ${action}ed claim ${index} of run ${runMatch[1]}`);
        return reply({ ok: true, row });
      }

      reply({ ok: false, error: 'not found' }, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin] error:', msg);
      reply({ ok: false, error: msg }, 400);
    }
  });

  server.listen(port, () => {
    console.log(`[admin] write-back server on http://localhost:${port}`);
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startAdminServer(parseInt(process.env.ADMIN_PORT || '4322', 10));
}
