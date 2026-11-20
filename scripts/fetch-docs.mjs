#!/usr/bin/env node
/**
 * Neuman's docs, from the head of its main branch, into src/content/docs/.
 *
 * Neuman's repository owns the content; this site owns presentation. Every
 * top-level docs/*.md on main is published, so a doc added there appears
 * here on the next build without a change to this repository; its place in
 * the sidebar comes from src/lib/docs.ts. docs/plans/ is working material and
 * is not published.
 *
 * Each file is rewritten for the site: frontmatter (title from its H1,
 * description from its first paragraph), the H1 stripped because the layout
 * renders it, and links between docs — `[x](guarantee.md)` and the
 * `docs/guarantee.md` the docs cite in code spans — pointed at /docs/<slug>.
 *
 * The repository is public, so no token is needed: GITHUB_TOKEN, when set, only
 * raises the API's unauthenticated rate limit (60 requests an hour per address,
 * against one commit, one listing and one request per doc).
 * NEUMAN_DOCS_DIR=../neuman/docs reads a local checkout instead, to preview a
 * doc before it is pushed; `pnpm dev` then re-runs this on every save there
 * (scripts/dev.mjs). It is a development override, not a build input — a build
 * reads main.
 *
 * What was fetched (commit, date) goes to src/data/neuman-docs.json for the
 * docs pages to show. A fetch that fails keeps the copy already on disk and
 * fails only when there is none, so a build without network still builds.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { ROOT } from './lib/facts.mjs';

const REPO = 'lukebodmer/neuman';
const BRANCH = 'main';
const DEST = join(ROOT, 'src/content/docs');
const META = join(ROOT, 'src/data/neuman-docs.json');

async function github(path, accept = 'application/vnd.github+json') {
  // Public repository: the token is optional, and exists only to lift the
  // unauthenticated rate limit on CI.
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    headers: {
      Accept: accept,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'User-Agent': 'privateai-solutions/fetch-docs',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status}`);
  return accept.endsWith('raw') ? res.text() : res.json();
}

async function fromGithub() {
  const head = await github(`commits/${BRANCH}`);
  const listing = await github(`contents/docs?ref=${head.sha}`);
  const files = await Promise.all(listing
    .filter(e => e.type === 'file' && e.name.endsWith('.md'))
    .map(async e => ({ name: e.name, body: await github(`contents/docs/${e.name}?ref=${head.sha}`, 'application/vnd.github.raw') })));
  return {
    files,
    meta: { source: 'github', repo: REPO, branch: BRANCH, sha: head.sha, committed: head.commit.committer.date },
  };
}

function fromLocal(dir) {
  const files = readdirSync(dir)
    .filter(name => name.endsWith('.md'))
    .map(name => ({ name, body: readFileSync(join(dir, name), 'utf8') }));
  return { files, meta: { source: 'local', dir } };
}

/* ─────────────────────────── rewriting ─────────────────────────── */

/** "Neuman — what it guarantees" → "What it guarantees": inside Neuman's
 *  docs the product name is noise. */
function cleanTitle(h1) {
  const t = h1.replace(/^Neuman\s*[—:-]\s*/i, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The first prose paragraph, flattened to plain text for the index. */
function firstParagraph(md) {
  const para = [];
  let fenced = false;
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) { fenced = !fenced; continue; }
    if (fenced) continue;
    const t = line.trim();
    if (!t) { if (para.length) break; continue; }
    if (/^(#|>|\||[-*] |\d+\. |<)/.test(t)) { if (para.length) break; continue; }
    para.push(t);
  }
  const text = para.join(' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '');
  return text.length > 220 ? `${text.slice(0, 217).replace(/\s+\S*$/, '')}…` : text;
}

/** Point links between docs at their pages. Code fences are left alone. */
function linkDocs(md, published) {
  return md.split(/(^```[\s\S]*?^```)/m).map((chunk, i) => {
    if (i % 2 === 1) return chunk;
    return chunk
      .replace(/\]\(([a-z0-9-]+)\.md(#[^)]*)?\)/g, (m, slug, hash = '') =>
        published.has(slug) ? `](/docs/${slug}${hash})` : m)
      .replace(/(?<!\[)`docs\/([a-z0-9-]+)\.md`(?!\])/g, (m, slug) =>
        published.has(slug) ? `[${m}](/docs/${slug})` : m);
  }).join('');
}

function rewrite({ name, body }, published) {
  const h1 = body.match(/^# (.+)$/m)?.[1] ?? name.replace(/\.md$/, '');
  const rest = body.replace(/^# .+\n+/m, '');
  const description = firstParagraph(rest);
  const front = ['---', `title: ${JSON.stringify(cleanTitle(h1))}`,
    ...(description ? [`description: ${JSON.stringify(description)}`] : []), '---', ''].join('\n');
  return front + linkDocs(rest, published);
}

/* ─────────────────────────── main ─────────────────────────── */

const local = process.env.NEUMAN_DOCS_DIR;
let fetched;
try {
  fetched = local ? fromLocal(resolve(ROOT, local)) : await fromGithub();
} catch (err) {
  const have = existsSync(DEST) && readdirSync(DEST).some(f => f.endsWith('.md'));
  console.warn(`[docs] ${err.message}${have ? ' — keeping the docs already fetched' : ''}`);
  process.exit(have ? 0 : 1);
}

// Write only what changed and remove only what is gone, so a dev server
// watching src/content/docs reloads the one doc that was edited.
const published = new Set(fetched.files.map(f => f.name.replace(/\.md$/, '')));
mkdirSync(DEST, { recursive: true });
for (const name of readdirSync(DEST)) {
  if (!fetched.files.some(f => f.name === name)) rmSync(join(DEST, name), { recursive: true, force: true });
}
for (const file of fetched.files) {
  const path = join(DEST, file.name);
  const text = rewrite(file, published);
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text);
}
writeFileSync(META, JSON.stringify({ ...fetched.meta, fetched: new Date().toISOString() }, null, 2) + '\n');

const at = fetched.meta.sha ? `${REPO}@${fetched.meta.sha.slice(0, 7)}` : fetched.meta.dir;
console.log(`[docs] ${fetched.files.length} doc(s) from ${at}`);
