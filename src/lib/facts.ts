/**
 * The generic entity loader + fact accessor.
 *
 * This is the ONE way pages read from `src/data/{models,builds,parts,companies,harnesses}/`.
 * There are no typed `Model`/`Gpu`/… interfaces; pages read facts via
 * `fact(entity, 'benchmark.mmlu')`.
 *
 * Design invariants:
 *   - The schema in `factSchemas.ts` is the source of truth. This loader
 *     never assumes a fact exists — it returns null for missing keys.
 *   - Loaders are pure reads of JSON on disk. No caching layer, no network.
 *     Astro batches these at build time.
 *   - Entity JSON shape is `{ name, slug, facts, references }`. Canonical
 *     URLs live in `snapshot.*` facts — read them via `snapshotUrl()`.
 *   - `my_take` lives at `facts.my_take` so it participates in the
 *     verified_by/verified_at sign-off flow like any other fact.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { FactEntry } from '../types/fact';
import type { Reference } from '../types/reference';
import type { EntityType } from '../data/schemas/factSchemas';
import { ENTITY_DIR } from './entityTypes';

export { ENTITY_DIR };

export interface Entity {
  /** Slug (matches filename without .json) */
  slug: string;
  /** Entity type */
  type: EntityType;
  /** Display name (from JSON `name` field) */
  name: string;
  /** Fact provenance objects keyed by schema key */
  facts: Record<string, FactEntry>;
  /** Human-facing citations rendered on the entity page */
  references: Reference[];
  /** Optional hand-authored markdown; renders as "My take" section */
  my_take: string | null;
  /** Optional logo asset override */
  logo?: string;
}

interface RawEntityJson {
  name: string;
  slug?: string;
  facts?: Record<string, FactEntry>;
  references?: Reference[];
  logo?: string;
  [k: string]: unknown;
}

function toEntity(type: EntityType, filename: string, raw: RawEntityJson): Entity {
  const slug = raw.slug || filename.replace(/\.json$/, '');
  const facts = raw.facts || {};
  const takeVal = facts.my_take?.value;
  const my_take = typeof takeVal === 'string' && takeVal.trim() !== '' ? takeVal : null;
  return {
    slug,
    type,
    name: raw.name,
    facts,
    references: raw.references || [],
    my_take,
    logo: raw.logo,
  };
}

/** Load every entity of a type, sorted by name. */
// `hidden: true` keeps an entity's data on disk but takes it off every public
// page: the loaders below never return it, so no page, chart or link can
// reach it. The admin dashboard reads the files directly and still sees it.
function isHidden(raw: RawEntityJson): boolean {
  return raw.facts?.hidden?.value === true;
}

function readRaw(type: EntityType, slug: string): RawEntityJson | null {
  const path = join(process.cwd(), 'src/data', ENTITY_DIR[type], `${slug}.json`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RawEntityJson;
  } catch {
    return null;
  }
}

/** Load every public entity of a type, sorted by name. */
export function loadEntities(type: EntityType): Entity[] {
  const dir = join(process.cwd(), 'src/data', ENTITY_DIR[type]);
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ f, raw: JSON.parse(readFileSync(join(dir, f), 'utf8')) as RawEntityJson }))
    .filter(({ raw }) => !isHidden(raw))
    .map(({ f, raw }) => toEntity(type, f, raw))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Load a single public entity by slug. Returns null if not found or hidden. */
export function loadEntity(type: EntityType, slug: string): Entity | null {
  const raw = readRaw(type, slug);
  return raw && !isHidden(raw) ? toEntity(type, `${slug}.json`, raw) : null;
}

/** An entity's display name, hidden or not, or null if it doesn't exist.
 *  For labels only: a hidden entity still has a name, but no page to link. */
export function entityName(type: EntityType, slug: string): string | null {
  return readRaw(type, slug)?.name ?? null;
}

/** Is this entity hidden from the site? False if it doesn't exist. */
export function isHiddenEntity(type: EntityType, slug: string): boolean {
  const raw = readRaw(type, slug);
  return raw !== null && isHidden(raw);
}

/**
 * Read a fact's full provenance object. Returns null if the entity
 * doesn't have this key (missing from JSON — the schema may still
 * expect it, but the file doesn't have it yet).
 */
export function fact(entity: Entity, key: string): FactEntry | null {
  return entity.facts[key] ?? null;
}

/**
 * Read a fact's value directly. Returns null if the key is missing,
 * if the fact's value is null, OR if the fact is marked N/A. Use `fact()`
 * when you need to disambiguate (or when you need source/verified_by).
 *
 * N/A → null is deliberate: entity pages already conditionally render
 * based on null values, so N/A facts drop out of the UI with zero
 * per-page changes.
 */
export function factValue<T = unknown>(entity: Entity, key: string): T | null {
  const f = entity.facts[key];
  if (!f) return null;
  if (f.na) return null;
  return (f.value as T) ?? null;
}

/** Convenience: get a string fact value. */
export function factStr(entity: Entity, key: string): string | null {
  const v = factValue(entity, key);
  return typeof v === 'string' ? v : null;
}

/** Convenience: get a numeric fact value. */
export function factNum(entity: Entity, key: string): number | null {
  const v = factValue(entity, key);
  return typeof v === 'number' ? v : null;
}

/** Convenience: get a boolean fact value. */
export function factBool(entity: Entity, key: string): boolean | null {
  const v = factValue(entity, key);
  return typeof v === 'boolean' ? v : null;
}

/**
 * Is this fact verified? (either verified_by is set in the file, or
 * a future dashboard-driven check confirms it). For now, file-level only.
 */
export function isVerified(entity: Entity, key: string): boolean {
  return entity.facts[key]?.verified_by != null;
}

/** Is this fact marked N/A for this entity? */
export function isNA(entity: Entity, key: string): boolean {
  return entity.facts[key]?.na === true;
}

/**
 * Resolve a related entity across types (e.g. model → company).
 * Returns null if the fact is missing or the target entity doesn't exist.
 */
export function relatedEntity(
  entity: Entity,
  factKey: string,
  targetType: EntityType,
): Entity | null {
  const slug = factStr(entity, factKey);
  if (!slug) return null;
  return loadEntity(targetType, slug);
}

/**
 * URL captured by a snapshot fact — thin convenience for pages that
 * need to render a link to the canonical HuggingFace page, GitHub repo,
 * datasheet PDF, etc. Returns null if the snapshot fact is missing or
 * N/A. Equivalent to `factStr(entity, snapshotKey)`; the named helper
 * exists so calling sites document *what* URL they're reading.
 *
 * Example: `snapshotUrl(model, 'snapshot.huggingface_card')`.
 */
export function snapshotUrl(entity: Entity, snapshotKey: string): string | null {
  return factStr(entity, snapshotKey);
}
