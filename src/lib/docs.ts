/**
 * Where each of Neuman's docs sits in the sidebar. The docs themselves are
 * fetched from Neuman's main branch (scripts/fetch-docs.mjs); a doc this
 * list does not name still publishes, under "More", so a new doc on main is
 * never silently dropped — it just waits here for a place.
 *
 * Neuman's decision log and failure log are not on this site (NOT_PUBLISHED
 * in the fetch), so no group here names them.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getCollection, type CollectionEntry } from 'astro:content';

const GROUPS: { label: string; slugs: string[] }[] = [
  { label: 'Start here', slugs: ['philosophy', 'manifesto'] },
  { label: 'How it works', slugs: ['security-model', 'tools', 'tasks', 'context', 'harness', 'networking', 'database', 'platforms'] },
  { label: 'Running it', slugs: ['setup', 'administration'] },
];

export type Doc = CollectionEntry<'docs'>;
export interface DocGroup { label: string; docs: Doc[] }

/** Every published doc, grouped and in sidebar order. */
export async function docGroups(): Promise<DocGroup[]> {
  const all = await getCollection('docs');
  // Keyed by string: the collection's slug type is whatever main held at the
  // last fetch, and GROUPS may name a doc main has since dropped.
  const bySlug = new Map<string, Doc>(all.map(d => [d.slug, d]));
  const placed = new Set(GROUPS.flatMap(g => g.slugs));
  const groups = GROUPS.map(g => ({
    label: g.label,
    docs: g.slugs.map(s => bySlug.get(s)).filter((d): d is Doc => d !== undefined),
  }));
  const more = all.filter(d => !placed.has(d.slug)).sort((a, b) => a.data.title.localeCompare(b.data.title));
  if (more.length) groups.push({ label: 'More', docs: more });
  return groups.filter(g => g.docs.length > 0);
}

export interface DocsSource {
  source: 'github' | 'local';
  repo?: string;
  branch?: string;
  sha?: string;
  committed?: string;
  dir?: string;
  fetched: string;
}

/** What the last fetch read: the commit on main, or a local directory. */
export function docsSource(): DocsSource | null {
  const path = join(process.cwd(), 'src/data/neuman-docs.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}
