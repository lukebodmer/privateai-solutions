/**
 * Run briefs — what Neuman is asked to do, composed from the schema.
 *
 * Templates live in src/data/prompts/: one per run kind (onboard,
 * refresh, sweep), a note per entity type, and the claims protocol every
 * brief ends with. The tables are computed here from the schema and the
 * entity files, so a brief can only offer Neuman the facts the checker
 * will accept from it.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { FACT_SCHEMAS, evidenceOf, factApplies } from '../../src/data/schemas/factSchemas.ts';
import { DATA_DIR, ENTITY_DIR, ROOT, lastSynced, readEntity, today } from './facts.mjs';
import { AA_CATALOG_URL } from './aa.mjs';
import { ARENA_DATASET_URL } from './arena.mjs';
import { OPENROUTER_MODELS_URL, isBaseId } from './openrouter.mjs';
import { runDir } from './runs.mjs';

const PROMPTS_DIR = join(ROOT, 'src/data/prompts');
/** Upper bound on facts in one sweep's re-check list, so a backlog after
 *  a long gap is worked off over several weeks, not one enormous run. */
const DUE_LIMIT = 40;

const template = name => readFileSync(join(PROMPTS_DIR, name), 'utf8');

function fill(text, vars) {
  return text.replace(/{{\s*([a-z_]+)\s*}}/g, (m, k) => (k in vars ? vars[k] : m));
}

function loadAll(type) {
  const dir = join(DATA_DIR, ENTITY_DIR[type]);
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const slug = f.replace(/\.json$/, '');
      return { slug, ...readEntity(type, slug) };
    });
}

const cell = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function show(value) {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return `${value.length} rows`;
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

/** The facts Neuman may claim on one entity, with where each stands. */
function claimableTable(type, entity) {
  const rows = FACT_SCHEMAS[type]
    .filter(e => e.writer === 'agent' && factApplies(e, entity) && entity.facts[e.key]?.na !== true)
    .map(e => {
      const f = entity.facts[e.key];
      const signed = f?.verified_by ? `${f.verified_by} ${f.verified_at ?? ''}`.trim() : '—';
      return `| \`${e.key}\` | ${e.type} | ${evidenceOf(e)} | ${cell(show(f?.value))} | ${signed} | ${cell(e.description)} |`;
    });
  return [
    `Entity: \`${type}/${entity.slug}\` — ${entity.name}`,
    '',
    '| Key | Type | Evidence | Current value | Signed | What it is |',
    '|-----|------|----------|---------------|--------|------------|',
    ...rows,
  ].join('\n');
}

function snapshotTable(type) {
  const snaps = FACT_SCHEMAS[type].filter(s => s.type === 'snapshot');
  return [
    '| Snapshot fact | Canonical? | URL hint | Preferred for |',
    '|---------------|------------|----------|---------------|',
    ...snaps.map(s => {
      const canonical = s.optional ? 'optional' : '**canonical**';
      const preferred = s.preferred_for?.length ? s.preferred_for.map(k => `\`${k}\``).join(', ') : '(cross-check only)';
      return `| \`${s.key}\` | ${canonical} | ${cell(s.url_hint || '—')} | ${preferred} |`;
    }),
  ].join('\n');
}

/* ── Prior sources ────────────────────────────────────────────────────
 * Neuman's biggest cost is "where do I look?" — so each brief carries a
 * per-type table of how similar entities have been sourced before,
 * derived from every entity's `snapshot.*` facts and per-fact `source`
 * URLs. Computed per brief; no committed cache to keep fresh.
 */

/** Collapse subdomains for common publishers so related URLs group. */
function publisherOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (const p of ['huggingface.co', 'github.com', 'techpowerup.com', 'wikipedia.org', 'artificialanalysis.ai']) {
      if (host.endsWith(p)) return p;
    }
    return host;
  } catch {
    return 'unknown';
  }
}

/** Distill an entity URL into a `{slug}`-templated pattern. */
function patternOf(url, slug, name) {
  let out = url.split(slug).join('{slug}');
  if (name && name !== slug) out = out.split(encodeURIComponent(name)).join('{name_url}').split(name).join('{name}');
  return out;
}

function priorSourcesTable(type) {
  const all = Object.fromEntries(Object.keys(ENTITY_DIR).map(t => [t, loadAll(t)]));
  const templates = new Map();
  const urlToTemplate = new Map();

  for (const [t, entities] of Object.entries(all)) {
    for (const e of entities) {
      for (const [key, fact] of Object.entries(e.facts)) {
        if (!key.startsWith('snapshot.') || fact?.na === true || typeof fact?.value !== 'string' || !fact.value) continue;
        const role = key.slice('snapshot.'.length);
        const publisher = publisherOf(fact.value);
        const id = `${role}::${publisher}`;
        if (!templates.has(id)) templates.set(id, { role, publisher, types: new Set(), patterns: new Map(), facts: new Map(), signed: 0, total: 0 });
        const tpl = templates.get(id);
        tpl.types.add(t);
        tpl.total++;
        if (fact.verified_by) tpl.signed++;
        const pat = patternOf(fact.value, e.slug, e.name);
        tpl.patterns.set(pat, (tpl.patterns.get(pat) ?? 0) + 1);
        urlToTemplate.set(fact.value, tpl);
      }
    }
  }
  for (const [t, entities] of Object.entries(all)) {
    for (const e of entities) {
      for (const [key, fact] of Object.entries(e.facts)) {
        if (key.startsWith('snapshot.') || typeof fact?.source !== 'string') continue;
        let tpl = urlToTemplate.get(fact.source);
        if (!tpl) {
          const candidates = [...templates.values()].filter(x => x.publisher === publisherOf(fact.source) && x.types.has(t));
          if (candidates.length !== 1) continue;
          tpl = candidates[0];
        }
        tpl.facts.set(key, (tpl.facts.get(key) ?? 0) + 1);
      }
    }
  }

  const relevant = [...templates.values()].filter(t => t.types.has(type)).sort((a, b) => b.signed - a.signed || b.total - a.total);
  if (relevant.length === 0) return '_(No prior sources indexed yet.)_';
  return [
    '| Role | Publisher | URL pattern | Signed / Total | Used for |',
    '|------|-----------|-------------|----------------|----------|',
    ...relevant.map(t => {
      const best = [...t.patterns.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
      const used = [...t.facts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `\`${k}\` (${n})`).join(', ') || '—';
      return `| \`${t.role}\` | ${t.publisher} | \`${cell(best)}\` | ${t.signed}/${t.total} | ${used} |`;
    }),
  ].join('\n');
}

/* ── Join-key candidates (models) ─────────────────────────────────── */

/** Rows of a snapshot sync keeps on disk (under `field`) whose text shares
 *  a word with the model's name. Whole catalogs are hundreds of rows — far
 *  more context than one match needs. */
function candidates(file, name, text, field = 'data') {
  let rows;
  try { rows = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'))[field] ?? []; }
  catch { rows = []; }
  const words = name.toLowerCase().split(/[^a-z0-9.]+/).filter(w => w.length >= 2);
  return rows.filter(r => words.some(w => text(r).toLowerCase().includes(w))).slice(0, 40);
}

function aaCandidates(name) {
  const hits = candidates('aa-snapshot.json', name, m => `${m.name} ${m.slug}`);
  const table = hits.length === 0
    ? '_No AA catalog entry shares a word with this name. Claim `aa_id` as `null`._'
    : ['| aa_id | AA name | AA slug | creator |', '|-------|---------|---------|---------|',
       ...hits.map(m => `| \`${m.id}\` | ${cell(m.name)} | ${m.slug} | ${cell(m.model_creator?.name ?? '—')} |`)].join('\n');
  return `## Artificial Analysis id

\`aa_id\` joins this model to Artificial Analysis's benchmarks. Match it from
the candidates below: the name must clearly be this model, the creator must
be this model's developer, and among variants (\`-thinking\`, \`-preview\`,
reasoning/non-reasoning) pick the exact release. A wrong id silently
attaches another model's benchmarks — when in doubt, claim \`null\`. Cite
\`${AA_CATALOG_URL}\` as the source and the matching row's name as the quote;
the checker looks the id up in the catalog.

${table}`;
}

function arenaCandidates(name) {
  const hits = candidates('arena-snapshot.json', name, r => `${r.model_name} ${r.organization}`);
  const table = hits.length === 0
    ? '_No Arena leaderboard row shares a word with this name. Claim `arena_name` as `null`._'
    : ['| arena_name | organization | license | votes |', '|------------|--------------|---------|-------|',
       ...hits.map(r => `| \`${cell(r.model_name)}\` | ${cell(r.organization)} | ${cell(r.license)} | ${r.vote_count} |`)].join('\n');
  return `## Arena name

\`arena_name\` joins this model to its Arena rating. Arena has no ids: the
value is the \`model_name\` exactly as written below. The same rules as
\`aa_id\` apply: the exact release, the developer's organization, and for
reasoning-effort variants (\`(High)\`, \`(Max)\`) the one \`aa_id\` names,
or the highest listed. A preview row is not the release, and a dated row is
only the release of that date. When in doubt, claim \`null\`. Cite \`${ARENA_DATASET_URL}\` as the source and the
name as the quote; the checker looks the name up in the leaderboard.

${table}`;
}

function openrouterCandidates(name) {
  const hits = candidates('openrouter-snapshot.json', name, m => `${m.id} ${m.name}`, 'catalog').filter(m => isBaseId(m.id));
  const table = hits.length === 0
    ? '_No OpenRouter model shares a word with this name. Claim `openrouter_id` as `null`._'
    : ['| openrouter_id | name |', '|---------------|------|',
       ...hits.map(m => `| \`${m.id}\` | ${cell(m.name)} |`)].join('\n');
  return `## OpenRouter id

A closed model has no Hugging Face repo to join on, so \`openrouter_id\` joins
it to the providers and prices OpenRouter lists. Pick the exact release, by
the developer, and never a \`:batch\`-style variant (they are not listed
below). When in doubt, claim \`null\`. Cite \`${OPENROUTER_MODELS_URL}\` as
the source and the id as the quote; the checker looks the id up in the catalog.

${table}`;
}

/** The join-key sections a model's brief carries: all that apply when
 *  onboarding, only the unset ones on a refresh. An open model joins
 *  OpenRouter by its Hugging Face repo, so only a closed one gets that
 *  section; an onboarding brief does not know yet, so it carries it. */
function joinKeySections(entity, { onlyUnset }) {
  const unset = k => !onlyUnset || entity.facts?.[k] === undefined;
  const distribution = entity.facts?.distribution?.value;
  return [
    unset('aa_id') ? aaCandidates(entity.name) : '',
    unset('arena_name') ? arenaCandidates(entity.name) : '',
    unset('openrouter_id') && (distribution === 'closed' || !onlyUnset) ? openrouterCandidates(entity.name) : '',
  ].filter(Boolean).join('\n\n');
}

/* ── Briefs ───────────────────────────────────────────────────────── */

function common(runId) {
  const vars = { run_id: runId, run_dir: runDir(runId) };
  return { ...vars, today: today(), protocol: fill(template('protocol.md'), vars) };
}

/** `runId` is not known until the run directory exists, so each builder
 *  returns a function of it. */
export function onboardBrief({ type, slug, disambiguation, seed }) {
  const entity = readEntity(type, slug);
  if (!entity) throw new Error(`no ${type}/${slug}`);
  const described = typeof disambiguation === 'string' ? disambiguation.trim() : '';
  const identity = described
    ? `Luke described exactly which one he means:\n\n${described.split('\n').map(line => `> ${line}`).join('\n')}`
    : 'Luke gave no disambiguation; the seed below is the identity.';
  return runId => fill(template('onboard.md'), {
    ...common(runId),
    entity_type: type,
    entity_name: entity.name,
    identity,
    seed: seed.map(([label, url]) => `- ${label}: ${url}`).join('\n'),
    claimable_table: claimableTable(type, { slug, ...entity }),
    type_notes: template(`types/${type}.md`),
    extra: type === 'model' ? joinKeySections(entity, { onlyUnset: false }) : '',
    sources_table: snapshotTable(type),
    prior_sources_table: priorSourcesTable(type),
  });
}

/** The pages Luke has put on record for an entity (its `references`) —
 *  for a system part, the product page of the exact machine. Search can
 *  fail; these are where a refresh starts. */
function referencesList(entity) {
  const refs = (entity.references ?? []).filter(r => r?.url);
  if (!refs.length) return 'None on record.';
  return refs.map(r => `- ${r.title ? `${r.title}: ` : ''}<${r.url}>`).join('\n');
}

export function refreshBrief({ type, slug }) {
  const entity = readEntity(type, slug);
  if (!entity) throw new Error(`no ${type}/${slug}`);
  return runId => fill(template('refresh.md'), {
    ...common(runId),
    entity_type: type,
    entity_name: entity.name,
    entity_ref: `${type}/${slug}`,
    references: referencesList(entity),
    claimable_table: claimableTable(type, { slug, ...entity }),
    type_notes: template(`types/${type}.md`),
    extra: type === 'model' ? joinKeySections(entity, { onlyUnset: true }) : '',
    sources_table: snapshotTable(type),
    prior_sources_table: priorSourcesTable(type),
  });
}

function daysSince(iso) {
  const then = Date.parse(iso ?? '');
  return Number.isNaN(then) ? Infinity : (Date.now() - then) / 86400000;
}

export function sweepBrief() {
  const parts = loadAll('part');
  // A part whose price has no listing the checker can read is marked
  // `price.swept: false`; it is not re-asked every week. An N/A price is
  // Luke's choice and is left out too.
  const pricedParts = parts.filter(p => p.facts['price.new_usd']?.na !== true);
  const sweptParts = pricedParts.filter(p => p.facts['price.swept']?.value !== false);
  const skippedParts = pricedParts.filter(p => p.facts['price.swept']?.value === false);
  const priceRows = sweptParts.map(p => {
    const f = p.facts['price.new_usd'];
    const now = f ? `${show(f.value)} (${f.verified_by ?? 'unverified'}, ${f.verified_at ?? f.fetched ?? '—'})` : '—';
    // The listing the price came from: a system is one product from one
    // seller, so its price is re-read there rather than searched for anew.
    const listing = f?.source ? `<${f.source}>` : '—';
    return `| \`part/${p.slug}\` | ${cell(p.name)} | ${now} | ${listing} |`;
  });
  const priceTable = sweptParts.length === 0 ? '_No parts are marked swept._' : [
    '| Entity | Name | New now | Listing |',
    '|--------|------|---------|---------|',
    ...priceRows,
  ].join('\n');
  const notSwept = skippedParts.length === 0
    ? ''
    : `Not swept (no listing the checker can read): ${skippedParts.map(p => `\`part/${p.slug}\``).join(', ')}.`;

  const due = [];
  for (const type of Object.keys(ENTITY_DIR)) {
    for (const e of loadAll(type)) {
      for (const entry of FACT_SCHEMAS[type]) {
        if (entry.writer !== 'agent' || !entry.review_days || entry.volatile) continue;
        if (!factApplies(entry, e)) continue;
        const f = e.facts[entry.key];
        if (!f || f.na === true || f.value === null || !f.verified_at) continue;
        const overdue = daysSince(f.verified_at) - entry.review_days;
        if (overdue < 0) continue;
        due.push({ ref: `${type}/${e.slug}`, entry, f, overdue });
      }
    }
  }
  due.sort((a, b) => b.overdue - a.overdue);
  const dueTable = due.length === 0 ? '_Nothing is due._' : [
    '| Entity | Key | Evidence | Current value | Source | Last checked | Review every |',
    '|--------|-----|----------|---------------|--------|--------------|--------------|',
    ...due.slice(0, DUE_LIMIT).map(d => `| \`${d.ref}\` | \`${d.entry.key}\` | ${evidenceOf(d.entry)} | ${cell(show(d.f.value))} | ${cell(d.f.source ?? '—')} | ${d.f.verified_at ?? 'never'} | ${d.entry.review_days} days |`),
    ...(due.length > DUE_LIMIT ? ['', `_${due.length - DUE_LIMIT} more are due; they come up in later sweeps._`] : []),
  ].join('\n');

  const since = lastSynced('last-sweep')?.slice(0, 10) ?? 'the last two weeks';

  return runId => fill(template('sweep.md'), {
    ...common(runId),
    price_table: priceTable,
    not_swept: notSwept,
    due_table: dueTable,
    since,
  });
}
