#!/usr/bin/env node
/**
 * Content-addressed snapshot archive — a pure library.
 *
 * `ingestBytes(buf, ext, meta)` writes bytes to a sha256-addressed store
 * under `$RESEARCH_ROOT`, appends an observation line to `manifest.jsonl`,
 * and returns `{ sha, wasNew, blobPath }`.
 *
 * Layout on disk (all relative to $RESEARCH_ROOT):
 *
 *   blobs/<sha[:2]>/<sha>.<ext>[.gz]  — deduplicated archive; forever
 *   manifest.jsonl                    — append-only observation log
 *
 * Callers today: `sync-aa.mjs`, `sync-hf.mjs`, `sync-github.mjs` (during
 * auto-verified syncs), and `admin-server.mjs` (during snapshot-on-verify).
 * The archive is a **human-vouched vault**: only auto-signed sync data and
 * facts luke has personally verified end up here. Neuman never writes to
 * the archive — it only writes URLs into fact.source, and the archive gets
 * populated when those facts are verified.
 *
 * Config: reads `RESEARCH_ROOT` env var. Unset → fail-soft (returns null,
 * logs a warning). Keeps the repo portable — someone cloning without a
 * `/data` drive can still `pnpm dev`, they just don't get snapshots.
 *
 * The manifest metadata (`source_url`, `source_kind`, `via`) is the caller's
 * "why did I fetch this" record — grep-able, replayable, immutable.
 */

import { createHash } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync, writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';

/** Extensions we don't re-gzip — already compressed or non-textual. */
const NO_GZIP_EXT = new Set(['gz', 'zip', 'br', 'zst', 'png', 'jpg', 'jpeg', 'webp', 'pdf', 'mp4', 'mkv']);

/** Returns the configured research root, or null if unset. All callers
 *  should handle null gracefully — snapshots are optional. */
export function researchRoot() {
  return process.env.RESEARCH_ROOT || null;
}

function warn(msg) { console.warn(`[snap] ${msg}`); }

/** Ensure the RESEARCH_ROOT directory tree exists. Idempotent. */
function ensureRoot(root) {
  mkdirSync(join(root, 'blobs'), { recursive: true });
}

/** Where should the blob for `sha` with `ext` (no leading dot) live?
 *  Sharded by first 2 hex chars to keep directory sizes sane. */
function blobPathFor(root, sha, ext, compressed) {
  const shard = sha.slice(0, 2);
  const suffix = compressed ? `${ext}.gz` : ext;
  return join(root, 'blobs', shard, `${sha}.${suffix}`);
}

/** Append one observation line to manifest.jsonl. Best-effort — a failed
 *  write shouldn't crash the caller. */
function appendManifest(root, entry) {
  try {
    appendFileSync(join(root, 'manifest.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    warn(`manifest append failed: ${err.message}`);
  }
}

/** Text formats gzip; anything already compressed stores raw. */
function shouldGzip(ext) {
  return !NO_GZIP_EXT.has(ext.toLowerCase());
}

/** Write bytes to the archive with content addressing. Returns
 *  { sha, wasNew, blobPath }. wasNew=false means the blob already
 *  existed — same content, no rewrite. */
async function writeBlob(root, buf, ext) {
  const sha = createHash('sha256').update(buf).digest('hex');
  const gzip = shouldGzip(ext);
  const path = blobPathFor(root, sha, ext, gzip);

  if (existsSync(path)) return { sha, wasNew: false, blobPath: path };

  mkdirSync(dirname(path), { recursive: true });

  if (gzip) {
    // Stream-gzip to disk. Faster + lower memory than in-process
    // compression for large blobs (rendered HF pages can hit multi-MB).
    const tmpPath = path + '.tmp';
    await pipeline(
      (async function* () { yield buf; })(),
      createGzip(),
      createWriteStream(tmpPath),
    );
    renameSync(tmpPath, path);
  } else {
    writeFileSync(path, buf);
  }

  return { sha, wasNew: true, blobPath: path };
}

/** Ingest raw bytes into the archive. Fails soft when RESEARCH_ROOT is
 *  unset (returns null; caller writes the fact without a snapshot_hash). */
export async function ingestBytes(buf, ext, meta = {}) {
  const root = researchRoot();
  if (!root) {
    warn('RESEARCH_ROOT unset — skipping snapshot');
    return null;
  }
  ensureRoot(root);
  const result = await writeBlob(root, buf, ext.replace(/^\./, ''));
  appendManifest(root, {
    fetched_at: new Date().toISOString(),
    sha: result.sha,
    was_new: result.wasNew,
    size_bytes: buf.length,
    ext,
    ...meta,
  });
  return result;
}
