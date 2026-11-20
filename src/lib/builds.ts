/** Display helpers shared by the build pages and the ecosystem panel. */
import { type Entity, fact, factNum, factStr } from './facts';
import { buildParts } from './sizing';
import { resolveLogo } from '../utils/resolveLogo';
import { partLogoDir } from '../data/schemas/factSchemas';

export function fmtGb(gb: number | null): string {
  if (gb === null) return '—';
  if (gb >= 1000) return `${(gb / 1000).toFixed(gb >= 10000 ? 0 : 2)} TB`;
  return `${gb >= 100 ? Math.round(gb) : gb.toFixed(1)} GB`;
}

export function fmtUsd(n: number | null): string {
  if (n === null) return '—';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function teamLabel(build: Entity): string | null {
  const min = factNum(build, 'team_min');
  const max = factNum(build, 'team_max');
  if (min !== null && max !== null) return `${min}–${max} people`;
  if (max !== null) return `up to ${max} people`;
  if (min !== null) return `${min}+ people`;
  return null;
}

export interface BuildPrice {
  /** The price as stated, or null when there is nothing to say yet. */
  label: string | null;
  /** For narrow columns: a range's figures in thousands ("$39.5–51.3k"),
   *  without its wording. Show `label` beside it (e.g. as a title). */
  short: string | null;
  /** The total of a system build's tracked part prices, when all are known. */
  total: number | null;
  kind: 'range' | 'tracked' | 'quote' | 'pending';
}

/** A custom build shows Luke's range and nothing computed; a system build
 *  shows its parts' tracked prices. A price fact present but null means the
 *  part is sold on quote; absent means not yet researched. */
export function buildPrice(build: Entity): BuildPrice {
  if (factStr(build, 'kind') === 'custom') {
    const range = factStr(build, 'price_range');
    return range ? { label: range, short: compactRange(range), total: null, kind: 'range' } : { label: null, short: null, total: null, kind: 'pending' };
  }
  let total = 0;
  for (const { part, quantity } of buildParts(build)) {
    const f = part ? fact(part, 'price.new_usd') : null;
    if (!f) return { label: null, short: null, total: null, kind: 'pending' };
    const v = factNum(part!, 'price.new_usd');
    if (v === null) return { label: 'Priced on quote', short: 'On quote', total: null, kind: 'quote' };
    total += quantity * v;
  }
  return { label: fmtUsd(total), short: fmtUsd(total), total, kind: 'tracked' };
}

/** "$39,500–51,300 in parts" → "$39.5–51.3k". Falls back to the text as
 *  written when it is not a dollar range. */
function compactRange(text: string): string {
  const m = text.match(/\$\s?([\d,]+(?:\.\d+)?)\s*[–-]\s*\$?([\d,]+(?:\.\d+)?)/);
  if (!m) return text;
  const k = (s: string) => {
    const n = parseFloat(s.replace(/,/g, ''));
    return n >= 1000 ? String(Math.round(n / 100) / 10) : String(n);
  };
  const big = parseFloat(m[2].replace(/,/g, '')) >= 1000;
  return `$${k(m[1])}–${k(m[2])}${big ? 'k' : ''}`;
}

/** A build's picture: its own photo (public/logos/builds/<slug>) when it has
 *  one, else, for a build that is one part, that part's product image. */
export function buildImage(build: Entity): string | null {
  const own = resolveLogo('builds', build.slug);
  if (own) return own;
  const parts = buildParts(build);
  return parts.length === 1 && parts[0].part ? partImage(parts[0].part) : null;
}

export function partImage(part: Entity): string | null {
  return resolveLogo(partLogoDir(factStr(part, 'class')), part.slug);
}
