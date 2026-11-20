/**
 * Arena (formerly LMArena) — the leaderboard dataset it publishes on
 * Hugging Face, CC-BY-4.0.
 *
 * One board: Text, style-controlled (Arena's default view). Its `latest`
 * split is the most recent published leaderboard, served as a single
 * Parquet file. No key.
 *
 * Attribution: CC-BY — every surface rendering these ratings credits Arena
 * and links to https://arena.ai/.
 */

import { parquetReadObjects } from 'hyparquet';

export const ARENA_DATASET_URL = 'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset';
export const ARENA_ATTRIBUTION = 'https://arena.ai/';
export const ARENA_CONFIG = 'text_style_control';
export const ARENA_PARQUET_URL = `https://huggingface.co/api/datasets/lmarena-ai/leaderboard-dataset/parquet/${ARENA_CONFIG}/latest/0.parquet`;

/** The categories the site shows, and the fact each one is written to. */
export const ARENA_CATEGORIES = {
  coding: 'benchmark.arena_text_coding',
  industry_legal_and_government: 'benchmark.arena_text_legal',
  industry_life_and_physical_and_social_science: 'benchmark.arena_text_science',
};

/** Fetch the latest leaderboard. Returns `{ bytes, rows }`: the Parquet
 *  file as received (the receipt) and one row per model on the `overall`
 *  board, with its rating in each of ARENA_CATEGORIES that ranks it.
 *  Throws on any non-200: the caller decides whether that is fatal. */
export async function fetchLeaderboard() {
  const res = await fetch(ARENA_PARQUET_URL);
  if (!res.ok) throw new Error(`Hugging Face returned ${res.status} for ${ARENA_PARQUET_URL}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const all = await parquetReadObjects({ file: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

  const ratings = new Map();
  for (const r of all) {
    if (!(r.category in ARENA_CATEGORIES)) continue;
    if (!ratings.has(r.model_name)) ratings.set(r.model_name, {});
    ratings.get(r.model_name)[r.category] = r.rating;
  }
  const rows = all
    .filter(r => r.category === 'overall')
    .map(r => ({
      model_name: r.model_name,
      organization: r.organization,
      license: r.license,
      vote_count: Number(r.vote_count),
      rank: Number(r.rank),
      ratings: ratings.get(r.model_name) ?? {},
      leaderboard_publish_date: r.leaderboard_publish_date,
    }))
    .sort((a, b) => a.rank - b.rank);
  if (rows.length === 0) throw new Error(`no \`overall\` rows in ${ARENA_CONFIG}/latest`);
  return { bytes, rows };
}
