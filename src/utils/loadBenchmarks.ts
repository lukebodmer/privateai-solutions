/**
 * Load the benchmark tiles for the models grid.
 *
 * Each `src/data/benchmarks/*.yaml` declares one tile:
 *   - `key`: the fact key on the model (e.g. `benchmark.aa_intelligence_index`)
 *   - `title` / `short_title` / `description`
 *   - `scale_min` / `scale_max`: the range a bar fills. `scale_min` defaults
 *     to 0; a rating scale (Arena's Elo) sets it near the field's floor so
 *     the differences are visible.
 *   - `source_url`: where a reader can see the numbers
 *   - `order`: grid position (row-major)
 *
 * Scores come from the fact system — synced from AA and Arena (see
 * `scripts/sync-aa.mjs`, `scripts/sync-arena.mjs`). The loader is pure:
 * read yaml, walk models, emit tiles. Astro batches these at build time.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { loadEntities, factNum, factStr } from '../lib/facts';

export interface BenchmarkTileRow {
  model_slug: string;
  model_name: string;
  short_label: string;
  company_slug: string | null;
  is_open: boolean;
  score: number;
}

export interface BenchmarkTile {
  key: string;                  // fact key on the model
  title: string;
  short_title: string;
  description: string;
  scale_min: number;
  scale_max: number;
  source_url: string;
  order: number;
  rows: BenchmarkTileRow[];     // sorted score descending
}

interface BenchmarkMeta {
  key: string;
  title: string;
  short_title: string;
  description: string;
  scale_min?: number;
  scale_max: number;
  source_url: string;
  order: number;
}

/** How full a bar is, 0–100, for a score on this tile. */
export function barPct(tile: BenchmarkTile, score: number): number {
  return Math.max(0, Math.min(100, ((score - tile.scale_min) / (tile.scale_max - tile.scale_min)) * 100));
}

export function loadBenchmarks(): BenchmarkTile[] {
  const dir = join(process.cwd(), 'src/data/benchmarks');
  const models = loadEntities('model');

  return readdirSync(dir)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const meta = yaml.load(readFileSync(join(dir, f), 'utf8')) as BenchmarkMeta;

      const rows: BenchmarkTileRow[] = models
        .map(m => {
          const score = factNum(m, meta.key);
          if (score === null) return null;
          return {
            model_slug: m.slug,
            model_name: m.name,
            short_label: factStr(m, 'family') || m.name,
            company_slug: factStr(m, 'company_slug'),
            is_open: factStr(m, 'distribution') === 'open',
            score,
          } satisfies BenchmarkTileRow;
        })
        .filter((r): r is BenchmarkTileRow => r !== null)
        .sort((a, b) => b.score - a.score);

      return {
        key: meta.key,
        title: meta.title,
        short_title: meta.short_title,
        description: meta.description,
        scale_min: meta.scale_min ?? 0,
        scale_max: meta.scale_max,
        source_url: meta.source_url,
        order: meta.order,
        rows,
      };
    })
    .sort((a, b) => a.order - b.order);
}
