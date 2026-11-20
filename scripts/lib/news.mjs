/**
 * The news feed — links Luke picks out for himself and his clients: model
 * releases, what the closed labs are doing, anything worth knowing about
 * running AI on your own hardware. No prose of his; each item is a link,
 * a title, where it is from and when it was published.
 *
 *   src/data/news.json   [{ url, title, source, date, added }], newest first
 *
 * Luke gives a URL; `readArticle` fills the rest from the page's own
 * metadata, and anything it gets wrong he corrects in the dashboard.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ROOT } from './facts.mjs';

export const NEWS_PATH = join(ROOT, 'src/data/news.json');

export function listNews() {
  if (!existsSync(NEWS_PATH)) return [];
  return JSON.parse(readFileSync(NEWS_PATH, 'utf8'));
}

/** Newest published first; same day, most recently added first. */
function writeNews(items) {
  items.sort((a, b) => b.date.localeCompare(a.date) || b.added.localeCompare(a.added));
  writeFileSync(NEWS_PATH, JSON.stringify(items, null, 2) + '\n', 'utf8');
}

const isUrl = s => typeof s === 'string' && /^https?:\/\//.test(s);
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Fetch the page and add it. A title Luke types wins over the page's; with
 *  neither, the link is refused — the feed shows titles, never URLs. A URL
 *  already in the feed is refused rather than listed twice. */
export async function addNews(url, title) {
  if (!isUrl(url)) throw new Error('url must be an http(s) URL');
  const items = listNews();
  if (items.some(i => i.url === url)) throw new Error('already in the feed');
  const article = await readArticle(url);
  const chosen = (typeof title === 'string' && title.trim()) || article.title;
  if (!chosen) throw new Error('could not read a title from the page — type one');
  const item = { url, ...article, title: chosen, added: new Date().toISOString() };
  writeNews([...items, item]);
  return item;
}

/** Correct an item's title, source or date. */
export function updateNews({ url, title, source, date }) {
  const items = listNews();
  const item = items.find(i => i.url === url);
  if (!item) throw new Error(`not in the feed: ${url}`);
  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) throw new Error('title required');
    item.title = title.trim();
  }
  if (source !== undefined) {
    if (typeof source !== 'string' || !source.trim()) throw new Error('source required');
    item.source = source.trim();
  }
  if (date !== undefined) {
    if (!isDate(date)) throw new Error('date must be YYYY-MM-DD');
    item.date = date;
  }
  writeNews(items);
  return item;
}

export function deleteNews(url) {
  const items = listNews();
  const kept = items.filter(i => i.url !== url);
  if (kept.length === items.length) throw new Error(`not in the feed: ${url}`);
  writeNews(kept);
}

/* ─────────────────────────── reading a page ─────────────────────────── */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+|#39);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every <meta> tag as { property|name|itemprop → content }, first wins. */
function metaTags(html) {
  const tags = {};
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attr = name => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
    const key = attr('property') ?? attr('name') ?? attr('itemprop');
    const content = attr('content');
    if (!key || !content) continue;
    const k = (key[2] ?? key[3]).toLowerCase();
    if (!(k in tags)) tags[k] = decode(content[2] ?? content[3]);
  }
  return tags;
}

/** `datePublished` from the page's JSON-LD, wherever it is nested. */
function jsonLdDate(html) {
  for (const [, body] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const found = body.match(/"datePublished"\s*:\s*"([^"]+)"/);
    if (found) return found[1];
  }
  return null;
}

/** An ISO-ish timestamp → YYYY-MM-DD, or null. Taking the leading date
 *  keeps the publisher's own day rather than shifting it through UTC. */
function toDay(s) {
  if (!s) return null;
  const leading = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (leading) return leading[1];
  const parsed = new Date(s);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A date in the URL's path (`/2025/01/27/`, `/2025/Jun/16/`), for blogs
 *  that publish no date metadata. */
function urlDay(url) {
  const m = new URL(url).pathname.match(/\/(\d{4})\/(\d{1,2}|[a-z]{3})\/(\d{1,2})\//i);
  if (!m) return null;
  const month = /^\d+$/.test(m[2]) ? Number(m[2]) : MONTHS.indexOf(m[2].toLowerCase()) + 1;
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${String(month).padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/** Luke's own today, not UTC's: an evening post would otherwise be dated
 *  tomorrow. */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Strip a trailing " | Site" or " - Site" when the site name is known,
 *  so the feed does not say the source twice. */
function trimSiteSuffix(title, source) {
  for (const sep of [' | ', ' - ', ' — ', ' – ', ' · ']) {
    if (title.endsWith(`${sep}${source}`)) return title.slice(0, -(sep.length + source.length));
  }
  return title;
}

/** Title, source and publication date from a page's own metadata. For a
 *  site that refuses the fetch (or has no metadata) the host stands in for
 *  the source and a date in the URL or today for the date; the title is
 *  null, and Luke types it. */
async function readArticle(url) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  let html = '';
  try {
    const res = await fetch(url, {
      headers: {
        // Many news sites serve a bot wall to an unfamiliar agent and the
        // article to a browser.
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) html = await res.text();
    else console.warn(`[news] ${url}: HTTP ${res.status} — no metadata`);
  } catch (err) {
    console.warn(`[news] ${url}: ${err.message} — no metadata`);
  }

  const meta = metaTags(html);
  const source = meta['og:site_name'] || host;
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const rawTitle = meta['og:title'] || meta['twitter:title'] || (titleTag && decode(titleTag)) || null;
  const date = toDay(
    meta['article:published_time']
      ?? meta['datepublished']
      ?? jsonLdDate(html)
      ?? meta['parsely-pub-date']
      ?? meta['date']
      ?? meta['pubdate']
      ?? meta['publish-date']
      ?? html.match(/<time[^>]*\bdatetime\s*=\s*"([^"]+)"/i)?.[1],
  ) ?? urlDay(url) ?? localToday();

  return { title: rawTitle && trimSiteSuffix(rawTitle, source), source, date };
}
