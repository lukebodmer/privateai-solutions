/// <reference types="../../.astro/types.d.ts" />

import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { EntityType, FactSchemaEntry, FactColumnSpec } from '../data/schemas/factSchemas';
import { FACT_SCHEMAS } from '../data/schemas/factSchemas';
import { ENTITY_DIR } from '../lib/entityTypes';
import RunsPanel from './RunsPanel';
import NewsPanel from './NewsPanel';
import TrashButton from './TrashButton';

/** A row in a `list`-typed fact — an object with string keys and primitive
 *  values, one entry per column declared in the fact's shape. */
type ListRow = Record<string, string | number | boolean | null>;

/** Blank row for a list, one null per declared column. */
function blankListRow(columns: FactColumnSpec[]): ListRow {
  const r: ListRow = {};
  for (const c of columns) r[c.name] = null;
  return r;
}

/** Render a cell value for the read-only table. */
function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

interface FlatFact {
  entity_name: string;
  entity_slug: string;
  entity_type: string;
  fact_key: string;
  value: unknown;
  source: string | null;
  fetched: string | null;
  verified_by: string | null;
  verified_at: string | null;
  missing: boolean;
  na: boolean;
  snapshot_hash: string | null;
  snapshot_ext: string | null;
}

interface EntityPayload {
  slug: string;
  name: string;
  facts: Record<string, unknown>;
  raw: Record<string, unknown>;
}

interface Props {
  facts: FlatFact[];
  entityPayloads: Record<string, EntityPayload[]>;
}

/** Admin server URL — snapshots are served through
 *  `GET /snapshot/<sha>.<ext>` (dev-only). Same origin as the write-back
 *  endpoints, no file:// mixed-context issues. */
const SNAPSHOT_BASE = 'http://localhost:4322/snapshot';

function snapshotUrl(hash: string, ext: string | null): string {
  return `${SNAPSHOT_BASE}/${hash}.${ext || 'html'}`;
}

interface Grouped {
  [entityType: string]: {
    [entitySlug: string]: {
      name: string;
      facts: FlatFact[];
    };
  };
}

function groupFacts(facts: FlatFact[]): Grouped {
  const g: Grouped = {};
  for (const f of facts) {
    if (!g[f.entity_type]) g[f.entity_type] = {};
    if (!g[f.entity_type][f.entity_slug]) g[f.entity_type][f.entity_slug] = { name: f.entity_name, facts: [] };
    g[f.entity_type][f.entity_slug].facts.push(f);
  }
  return g;
}

const STORAGE_KEY = 'pi-admin-verifications';

interface Verification {
  entity_type: string;
  entity_slug: string;
  fact_key: string;
  verified_by: string | null;
  verified_at: string | null;
  edited_value?: unknown;
  edited_source?: string | null;
  /** Locally-pending N/A toggle. undefined = no change; true/false = set. */
  edited_na?: boolean;
}

function loadStorage(): Verification[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveStorage(v: Verification[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return v < 1000 ? String(v) : v.toLocaleString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.length === 0 ? '(empty)' : `${v.length} item${v.length === 1 ? '' : 's'}`;
  const s = String(v);
  return s.length > 60 ? s.slice(0, 57) + '...' : s;
}

function isMyTakeFact(key: string): boolean {
  return key === 'my_take';
}

/** Look up a fact's schema entry given entity type + fact key.
 *  Returns undefined for keys not declared in the schema (shouldn't happen
 *  in normal flow — the dashboard only surfaces schema-declared or on-disk facts). */
function schemaEntryFor(entityType: string, factKey: string): FactSchemaEntry | undefined {
  return FACT_SCHEMAS[entityType as EntityType]?.find(s => s.key === factKey);
}

/** Is this fact declared as `type: 'list'` in the schema? Drives the
 *  generic table editor/renderer. */
function isListFact(entityType: string, factKey: string): boolean {
  return schemaEntryFor(entityType, factKey)?.type === 'list';
}

/** Parse the bit-width from a GGUF quant name.
 *  UD-IQ1_M → 1, UD-Q4_K_XL → 4, UD-TQ2_0 → 2, MXFP4 → 4.
 *  Falls back to null (renders as "Other") for names we can't parse. */
function quantBits(name: string): number | null {
  const m = name.match(/(?:^|[^A-Z])(?:I?Q|TQ|FP|MXFP)(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

/** Format a size_gb float as HF displays it: GB below 1000, TB above (2dp). */
function formatQuantSize(gb: unknown): string {
  if (typeof gb !== 'number' || !Number.isFinite(gb)) return String(gb ?? '');
  return gb >= 1000 ? `${(gb / 1000).toFixed(2)} TB` : `${Math.round(gb)} GB`;
}

/** Is this list fact one of the two quantization facts? Drives the
 *  group-by-bit rendering on the card. */
function isQuantFact(factKey: string): boolean {
  return factKey === 'quantizations_unsloth' || factKey === 'quantizations_bartowski';
}

/** Days between an ISO YYYY-MM-DD date and today. Returns null on bad input. */
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)));
}

/** Format staleness in the coarsest unit that fits: <30d = days, <365d = months, else years. */
function formatStaleness(days: number): string {
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Color the staleness text: fresh (grey), stale (amber, >6mo), old (red, >12mo). */
function stalenessClass(days: number): string {
  if (days > 365) return 'text-red-400/80';
  if (days > 180) return 'text-amber-400/80';
  return 'text-nord-500';
}

function StalenessTag({ date }: { date: string | null }) {
  const days = daysSince(date);
  if (days === null) return null;
  return <span className={stalenessClass(days)}>{formatStaleness(days)}</span>;
}

/** Small 📎 icon linking to the archived snapshot for a fact. Served via
 *  the admin-server (`GET /snapshot/<sha>.<ext>`) — same origin, gunzipped
 *  on the fly, proper content-type. */
function SnapshotBadge({ hash, ext }: { hash: string | null; ext: string | null }) {
  if (!hash) return null;
  return (
    <a
      href={snapshotUrl(hash, ext)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      title={`Snapshot ${hash.slice(0, 12)}…${ext ? ` (.${ext})` : ''} — click to open`}
      className="text-[10px] text-nord-500 hover:text-frost-400 leading-none"
    >📎</a>
  );
}

/** Inline badge shown next to the fact key when the fact is verified on-disk.
 *  Distinguishes signers: `auto` (a trusted API sync), `neuman` (an agent
 *  claim the checker confirmed on the cited page), anything else renders as
 *  `file` (human-signed on disk). Absent = unverified. */
function SignerBadge({ signer }: { signer: string | null }) {
  if (!signer) return null;
  if (signer === 'neuman') {
    return (
      <span
        title="Claimed by Neuman; the checker found the quote and value on the cited page"
        className="text-[10px] px-1 py-0.5 bg-sky-900/40 text-sky-300 rounded inline-flex items-center gap-0.5"
      >
        <span aria-hidden>✓</span>
        <span>neuman</span>
      </span>
    );
  }
  if (signer === 'auto') {
    return (
      <span
        title="Auto-validated from a trusted API source (e.g. Artificial Analysis)"
        className="text-[10px] px-1 py-0.5 bg-frost-900/40 text-frost-400 rounded inline-flex items-center gap-0.5"
      >
        <span aria-hidden>✓</span>
        <span>auto</span>
      </span>
    );
  }
  return (
    <span className="text-[10px] px-1 py-0.5 bg-frost-900/40 text-frost-400 rounded">file</span>
  );
}

const ADMIN_ORIGIN = 'http://localhost:4322';

interface QueuedRequest { id: string; title: string }

/** POST to an admin-server endpoint that queues a request for Neuman's next
 *  run (onboarding, refresh). Resolves to the request, or throws with
 *  the server's error. */
async function postRequest(path: string, body: unknown): Promise<QueuedRequest> {
  const res = await fetch(`${ADMIN_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `${path} failed`);
  return data.request;
}

/** Auto-suggest a slug from a display name: lowercase, non-alnum → hyphen,
 *  collapse repeats, trim leading/trailing hyphens. Not authoritative —
 *  user can edit before submitting. */
function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

// Canonical display order + labels for entity type sections. Order is
// alphabetical by label; labels handle irregular pluralization
// ("Companies", not "Companys").
const TYPE_ORDER: EntityType[] = ['build', 'company', 'harness', 'model', 'part'];
const TYPE_LABELS: Record<EntityType, string> = {
  company: 'Companies',
  build: 'Builds',
  part: 'Parts',
  harness: 'Harnesses',
  model: 'Models',
};

export default function AdminDashboard({ facts, entityPayloads }: Props) {
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(new Set());  // "type/slug" keys
  const [editing, setEditing] = useState<string | null>(null);
  // Fact cards render as one-line rows; these are the ones opened to full size.
  const [openFacts, setOpenFacts] = useState<Set<string>>(new Set());
  const toggleFact = (key: string) => setOpenFacts(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const [editValue, setEditValue] = useState('');
  const [editSource, setEditSource] = useState('');
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [promptStatus, setPromptStatus] = useState<string | null>(null);
  // Bumped whenever a request is queued, so the runs panel reloads.
  const [runsVersion, setRunsVersion] = useState(0);
  // Separate draft state for list-typed facts (the generic table editor).
  const [listDraft, setListDraft] = useState<ListRow[]>([]);
  const editRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<HTMLInputElement>(null);

  // Onboarding modal — models.
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [onboardName, setOnboardName] = useState('');
  const [onboardSlug, setOnboardSlug] = useState('');
  const [onboardSlugTouched, setOnboardSlugTouched] = useState(false);
  const [onboardUrl, setOnboardUrl] = useState('');
  const [onboardDistribution, setOnboardDistribution] = useState<'open' | 'closed' | 'gated'>('open');
  const [onboardDisambig, setOnboardDisambig] = useState('');
  const [onboardBusy, setOnboardBusy] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);

  // Onboarding modal — companies.
  const [companyOpen, setCompanyOpen] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [companySlug, setCompanySlug] = useState('');
  const [companySlugTouched, setCompanySlugTouched] = useState(false);
  const [companyOfficial, setCompanyOfficial] = useState('');
  const [companyWiki, setCompanyWiki] = useState('');
  const [companyHf, setCompanyHf] = useState('');
  const [companyDisambig, setCompanyDisambig] = useState('');
  const [companyBusy, setCompanyBusy] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);

  // Onboarding modal — parts.
  const [hwOpen, setHwOpen] = useState(false);
  const [hwName, setHwName] = useState('');
  const [hwSlug, setHwSlug] = useState('');
  const [hwSlugTouched, setHwSlugTouched] = useState(false);
  const [hwClass, setHwClass] = useState<'gpu' | 'system'>('gpu');
  const [hwMakerUrl, setHwMakerUrl] = useState('');
  const [hwImageUrl, setHwImageUrl] = useState('');
  const [hwDisambig, setHwDisambig] = useState('');
  const [hwBusy, setHwBusy] = useState(false);
  const [hwError, setHwError] = useState<string | null>(null);

  // Onboarding modal — harnesses.
  const [harnessOpen, setHarnessOpen] = useState(false);
  const [harnessName, setHarnessName] = useState('');
  const [harnessSlug, setHarnessSlug] = useState('');
  const [harnessSlugTouched, setHarnessSlugTouched] = useState(false);
  const [harnessGithub, setHarnessGithub] = useState('');
  const [harnessLogoUrl, setHarnessLogoUrl] = useState('');
  const [harnessDisambig, setHarnessDisambig] = useState('');
  const [harnessBusy, setHarnessBusy] = useState(false);
  const [harnessError, setHarnessError] = useState<string | null>(null);

  // Delete confirmation — one entity at a time, any type.
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; slug: string; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => { setVerifications(loadStorage()); }, []);

  useEffect(() => {
    if (editing && editRef.current) { editRef.current.focus(); editRef.current.select(); }
  }, [editing]);

  useEffect(() => {
    if (verifications.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [verifications.length]);

  const grouped = useMemo(() => groupFacts(facts), [facts]);

  const verKey = (v: { entity_type: string; entity_slug: string; fact_key: string }) =>
    `${v.entity_type}/${v.entity_slug}/${v.fact_key}`;
  const localVerKey = verKey;

  const getLocalVer = (f: FlatFact) =>
    verifications.find(v => v.entity_type === f.entity_type && v.entity_slug === f.entity_slug && v.fact_key === f.fact_key);

  const getEffectiveValue = (f: FlatFact) => {
    const lv = getLocalVer(f);
    return lv && lv.edited_value !== undefined ? lv.edited_value : f.value;
  };

  const getEffectiveSource = (f: FlatFact): string | null => {
    const lv = getLocalVer(f);
    return lv && lv.edited_source !== undefined ? lv.edited_source : f.source;
  };

  const getEffectiveNA = (f: FlatFact): boolean => {
    const lv = getLocalVer(f);
    if (lv && lv.edited_na !== undefined) return lv.edited_na;
    return f.na;
  };

  // A fact has "a value" iff its effective value is non-null and non-empty.
  // Used only for card content — never for gating buttons.
  const hasValue = (f: FlatFact): boolean => {
    const eff = getEffectiveValue(f);
    return !(eff === null || eff === undefined || eff === '');
  };

  const toggleNA = (f: FlatFact) => {
    const lv = getLocalVer(f);
    const currentNA = getEffectiveNA(f);
    const next = verifications.filter(v => verKey(v) !== verKey(f));
    // N/A on a fact that had a pending verify — drop the verify and set N/A.
    // N/A off — preserve existing verified_by/verified_at from disk.
    next.push({
      entity_type: f.entity_type,
      entity_slug: f.entity_slug,
      fact_key: f.fact_key,
      verified_by: lv?.verified_by ?? f.verified_by,
      verified_at: lv?.verified_at ?? f.verified_at,
      edited_value: lv?.edited_value,
      edited_source: lv?.edited_source,
      edited_na: !currentNA,
    });
    setVerifications(next);
    saveStorage(next);
  };

  const isVerified = (f: FlatFact) => {
    const lv = getLocalVer(f);
    if (lv) return lv.verified_by !== null;
    return f.verified_by !== null;
  };

  const markVerified = (f: FlatFact) => {
    const now = new Date().toISOString().slice(0, 10);
    const lv = getLocalVer(f);
    const newList = verifications.filter(v => verKey(v) !== verKey(f));
    const entry: Verification = {
      entity_type: f.entity_type,
      entity_slug: f.entity_slug,
      fact_key: f.fact_key,
      verified_by: 'luke',
      verified_at: now,
      edited_value: lv?.edited_value,
      edited_source: lv?.edited_source,
    };
    // If the file doesn't have this key yet AND the user didn't type
    // anything, we still need the server to create the fact so the
    // sign-off has something to attach to. Explicit null value = "verified
    // unavailable" (state 3). The server checks for `value in u`, so we
    // must include the key explicitly (not just leave it undefined).
    if (f.missing && entry.edited_value === undefined && entry.edited_source === undefined) {
      entry.edited_value = null;
    }
    newList.push(entry);
    setVerifications(newList);
    saveStorage(newList);
  };

  const markUnverified = (f: FlatFact) => {
    const lv = getLocalVer(f);
    const next = verifications.filter(v => verKey(v) !== verKey(f));
    // Case A: fact was verified on disk. We need to actively push
    // verified_by: null to the server on next Save; a bare local removal
    // would just revert to the disk state (still verified).
    // Case B: local pending sign-off with no disk verification. Simple
    // removal — the local record was the whole assertion.
    if (f.verified_by !== null) {
      next.push({
        entity_type: f.entity_type,
        entity_slug: f.entity_slug,
        fact_key: f.fact_key,
        verified_by: null,
        verified_at: null,
        // Preserve any in-flight value/source edits from the existing lv.
        edited_value: lv?.edited_value,
        edited_source: lv?.edited_source,
      });
    }
    setVerifications(next);
    saveStorage(next);
  };

  /** Toggle a curatorial boolean fact (e.g. hidden). No source,
   *  auto-verified as luke since it's a taste decision not a research claim.
   *  `entitySlug` + `factKey` identify the target; `nextValue` is the value
   *  to write. Creates a fact-shaped local verification just like markVerified. */
  const setCuratorialBool = (entityType: string, entitySlug: string, factKey: string, nextValue: boolean) => {
    const nowIso = new Date().toISOString().slice(0, 10);
    const stubKey = { entity_type: entityType, entity_slug: entitySlug, fact_key: factKey };
    const newList = verifications.filter(v => verKey(v) !== verKey(stubKey));
    newList.push({
      ...stubKey,
      verified_by: 'luke',
      verified_at: nowIso,
      edited_value: nextValue,
      edited_source: null,
    });
    setVerifications(newList);
    saveStorage(newList);
  };

  const startEdit = (f: FlatFact) => {
    if (isListFact(f.entity_type, f.fact_key)) {
      const columns = schemaEntryFor(f.entity_type, f.fact_key)?.shape?.columns ?? [];
      const curr = getEffectiveValue(f);
      const rows: ListRow[] = Array.isArray(curr)
        ? (curr as ListRow[]).map(r => {
            const out = blankListRow(columns);
            for (const c of columns) if (r[c.name] != null) out[c.name] = r[c.name];
            return out;
          })
        : [];
      setListDraft(rows);
      setEditSource(getEffectiveSource(f) || '');
      setEditing(localVerKey(f));
      return;
    }
    if (isMyTakeFact(f.fact_key)) {
      const curr = getEffectiveValue(f);
      setEditValue(typeof curr === 'string' ? curr : '');
      setEditSource('');
      setEditing(localVerKey(f));
      return;
    }
    setEditValue(getEffectiveValue(f) === null ? '' : String(getEffectiveValue(f)));
    setEditSource(getEffectiveSource(f) || '');
    setEditing(localVerKey(f));
  };

  const saveEdit = (f: FlatFact) => {
    if (editing !== localVerKey(f)) return;
    setEditing(null);

    let parsed: unknown;
    if (isListFact(f.entity_type, f.fact_key)) {
      const columns = schemaEntryFor(f.entity_type, f.fact_key)?.shape?.columns ?? [];
      // First column is the row identifier — drop rows where it's empty.
      const idCol = columns[0]?.name;
      parsed = listDraft
        .filter(r => idCol == null || (r[idCol] != null && String(r[idCol]).trim() !== ''))
        .map(r => {
          // Onchange already coerces to the column's type, so this is
          // mostly a pass-through — we just filter empty strings back to
          // null one more time in case a user left a whitespace-only cell.
          const out: ListRow = {};
          for (const c of columns) {
            const raw = r[c.name];
            if (raw === null || raw === undefined) { out[c.name] = null; continue; }
            if (typeof raw === 'string' && raw.trim() === '') { out[c.name] = null; continue; }
            out[c.name] = raw;
          }
          return out;
        });
    } else if (isMyTakeFact(f.fact_key)) {
      // Prose: preserve whitespace/newlines exactly; empty string → null.
      const v = editValue;
      parsed = v.trim() === '' ? null : v;
    } else {
      let v: unknown = editValue.trim();
      if (v === '' || v === '—') v = null;
      else if (!isNaN(Number(v))) v = Number(v);
      else if (v === 'true') v = true;
      else if (v === 'false') v = false;
      parsed = v;
    }

    const srcParsed = editSource.trim() || null;

    // If this fact was previously verified (on-disk) and the user actually
    // changed the value or source, drop verification — a modified fact must
    // be re-signed-off.
    const valueChanged = parsed !== f.value;
    const sourceChanged = srcParsed !== f.source;
    const wasFileVerified = f.verified_by !== null;
    const dropVerification = wasFileVerified && (valueChanged || sourceChanged);

    const newList = verifications.filter(v => verKey(v) !== verKey(f));
    newList.push({
      entity_type: f.entity_type, entity_slug: f.entity_slug, fact_key: f.fact_key,
      verified_by: dropVerification ? null : 'luke',
      verified_at: dropVerification ? null : new Date().toISOString().slice(0, 10),
      edited_value: parsed,
      edited_source: srcParsed,
    });
    setVerifications(newList);
    saveStorage(newList);
  };

  const cancelEdit = () => { setEditing(null); setListDraft([]); };

  /** Build the patch object from current verifications.
   * Only emits `value`/`source` when the user actually edited them —
   * a plain Verify click leaves the existing values alone on disk. */
  function buildPatch() {
    const byFile = new Map<string, Array<Record<string, unknown>>>();
    for (const v of verifications) {
      const dir = ENTITY_DIR[v.entity_type as EntityType];
      if (!dir) continue;
      const fileKey = `src/data/${dir}/${v.entity_slug}.json`;
      if (!byFile.has(fileKey)) byFile.set(fileKey, []);
      const entry: Record<string, unknown> = {
        fact_key: v.fact_key,
        verified_by: v.verified_by,
        verified_at: v.verified_at,
      };
      if (v.edited_value !== undefined) entry.value = v.edited_value;
      if (v.edited_source !== undefined) entry.source = v.edited_source;
      if (v.edited_na !== undefined) entry.na = v.edited_na;
      byFile.get(fileKey)!.push(entry);
    }
    const output: Record<string, unknown> = {};
    for (const [file, updates] of byFile) output[file] = updates;
    return output;
  }

  const handleApply = async () => {
    setApplyStatus('saving...');
    const patch = buildPatch();
    try {
      const res = await fetch('http://localhost:4322/apply-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!data.ok) {
        setApplyStatus('✗ Error: ' + (data.error || 'unknown'));
        return;
      }
      const results = data.results as Array<{ file: string; status: string; updated: number }>;
      const updated = results.filter(r => r.updated > 0).length;
      const failed = results.filter(r => r.updated === 0);

      if (updated === 0) {
        const detail = failed.map(r => `${r.file} (${r.status})`).join(', ');
        setApplyStatus(`✗ Wrote to 0 files — ${detail || 'no matching facts'}`);
        console.error('[admin] Apply failed:', results);
        return;
      }

      let msg = `✓ Wrote to ${updated} file(s)`;
      if (failed.length > 0) msg += ` — ${failed.length} skipped`;
      setApplyStatus(msg + ' — reloading...');
      localStorage.removeItem(STORAGE_KEY);
      setVerifications([]);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setApplyStatus('✗ Server not running. Start: node scripts/admin-server.mjs');
      // Fallback: offer download
      const blob = new Blob([JSON.stringify(patch, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'fact-verifications-patch.json'; a.click();
      URL.revokeObjectURL(url);
      setTimeout(() => setApplyStatus(null), 5000);
    }
  };

  const handleReset = () => {
    if (confirm('Clear all local verifications?')) { setVerifications([]); localStorage.removeItem(STORAGE_KEY); }
  };

  const showPromptStatus = (msg: string) => {
    setPromptStatus(msg);
    setTimeout(() => setPromptStatus(null), 3500);
  };

  const queued = (request: QueuedRequest) => {
    setRunsVersion(v => v + 1);
    showPromptStatus(`✓ ${request.title}: waiting for Neuman — press Run now on the task there`);
  };

  const queue = async (body: unknown) => {
    try { queued(await postRequest('/queue', body)); }
    catch (err) { showPromptStatus(`✗ ${err instanceof Error ? err.message : String(err)}`); }
  };

  const openDelete = (type: string, slug: string, name: string) => {
    setDeleteError(null);
    setDeleteTarget({ type, slug, name });
  };

  const closeDelete = () => {
    if (deleteBusy) return;
    setDeleteTarget(null);
    setDeleteError(null);
  };

  /** Delete removes the entity file and its logo from the working tree, so
   *  the page has to re-read the filesystem afterwards: reload. Pending
   *  sign-offs for the entity go with it. */
  const submitDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(`${ADMIN_ORIGIN}/delete-entity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: deleteTarget.type, slug: deleteTarget.slug }),
      });
      const data = await res.json();
      if (!data.ok) { setDeleteError(data.error || 'delete failed'); setDeleteBusy(false); return; }
      const remaining = verifications.filter(v => !(v.entity_type === deleteTarget.type && v.entity_slug === deleteTarget.slug));
      saveStorage(remaining);
      window.location.reload();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleteBusy(false);
    }
  };

  const entityOrder = (type: string) => {
    const slugs = Object.keys(grouped[type]);
    slugs.sort((a, b) => grouped[type][a].name.localeCompare(grouped[type][b].name));
    return slugs;
  };

  // Curatorial keys don't participate in the "all facts verified" story —
  // they're display config, not research. Excluded from tallies and roll-ups.
  const CURATORIAL_KEYS = new Set(['hidden']);
  const isResearchFact = (f: FlatFact) => !CURATORIAL_KEYS.has(f.fact_key);

  // N/A facts are excluded from all roll-up tallies. "Active" = not N/A.
  const isActive = (f: FlatFact) => !getEffectiveNA(f);
  const researchFactsAll = facts.filter(isResearchFact);
  const activeFacts = researchFactsAll.filter(isActive);
  const verifiedCount = activeFacts.filter(isVerified).length;
  const unverifiedCount = activeFacts.length - verifiedCount;
  const naCount = researchFactsAll.length - activeFacts.length;

  // Fixed alphabetical section order — never depends on verification state.
  const factTypes = TYPE_ORDER.filter(t => grouped[t]);

  // An entity is "all green" iff every active (non-N/A) research fact is verified.
  const entityAllVerified = (type: string, slug: string): boolean => {
    return grouped[type][slug].facts.filter(isResearchFact).filter(isActive).every(f => isVerified(f));
  };
  const typeAllVerified = (type: string): boolean => {
    return Object.keys(grouped[type]).every(slug => entityAllVerified(type, slug));
  };

  const resetOnboard = () => {
    setOnboardOpen(false);
    setOnboardName(''); setOnboardSlug(''); setOnboardSlugTouched(false);
    setOnboardUrl(''); setOnboardDistribution('open'); setOnboardDisambig('');
    setOnboardBusy(false); setOnboardError(null);
  };

  const submitOnboard = async () => {
    setOnboardError(null);
    const name = onboardName.trim();
    const slug = (onboardSlugTouched ? onboardSlug : suggestSlug(onboardName)).trim();
    const url = onboardUrl.trim();
    const disambig = onboardDisambig.trim();
    if (!name) return setOnboardError('name required');
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(slug)) return setOnboardError('slug must be kebab-case, alnum + . _ -');
    if (!/^https?:\/\//.test(url)) return setOnboardError('announcement URL must be http(s)');
    if (disambig.length < 5) return setOnboardError('disambiguation must be at least 5 characters');
    if (entityPayloads.model?.some(e => e.slug === slug)) return setOnboardError(`slug already exists: ${slug}`);

    setOnboardBusy(true);
    try {
      const res = await fetch(`${ADMIN_ORIGIN}/onboard-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug, announcement_url: url, disambiguation: disambig, distribution: onboardDistribution }),
      });
      const data = await res.json();
      if (!data.ok) { setOnboardError(data.error || 'onboard failed'); setOnboardBusy(false); return; }
      resetOnboard();
      queued(data.request);
    } catch (err) {
      setOnboardError(err instanceof Error ? err.message : String(err));
      setOnboardBusy(false);
    }
  };

  const resetCompany = () => {
    setCompanyOpen(false);
    setCompanyName(''); setCompanySlug(''); setCompanySlugTouched(false);
    setCompanyOfficial(''); setCompanyWiki(''); setCompanyHf('');
    setCompanyDisambig('');
    setCompanyBusy(false); setCompanyError(null);
  };

  const submitCompany = async () => {
    setCompanyError(null);
    const name = companyName.trim();
    const slug = (companySlugTouched ? companySlug : suggestSlug(companyName)).trim();
    const official = companyOfficial.trim();
    const wiki = companyWiki.trim();
    const hf = companyHf.trim();
    const disambig = companyDisambig.trim();
    if (!name) return setCompanyError('name required');
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(slug)) return setCompanyError('slug must be kebab-case');
    if (!/^https?:\/\//.test(official)) return setCompanyError('official homepage must be http(s)');
    if (!/^https?:\/\//.test(wiki)) return setCompanyError('wikipedia URL must be http(s)');
    if (hf && !/^https?:\/\//.test(hf)) return setCompanyError('HF org URL must be http(s) if provided');
    if (disambig && disambig.length < 5) return setCompanyError('disambiguation must be at least 5 characters if provided');
    if (entityPayloads.company?.some(e => e.slug === slug)) return setCompanyError(`slug already exists: ${slug}`);

    setCompanyBusy(true);
    try {
      const res = await fetch(`${ADMIN_ORIGIN}/onboard-company`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, slug,
          official_url: official,
          wikipedia_url: wiki,
          huggingface_org_url: hf || undefined,
          disambiguation: disambig,
        }),
      });
      const data = await res.json();
      if (!data.ok) { setCompanyError(data.error || 'onboard failed'); setCompanyBusy(false); return; }
      resetCompany();
      queued(data.request);
    } catch (err) {
      setCompanyError(err instanceof Error ? err.message : String(err));
      setCompanyBusy(false);
    }
  };

  const resetHw = () => {
    setHwOpen(false);
    setHwName(''); setHwSlug(''); setHwSlugTouched(false);
    setHwClass('gpu'); setHwMakerUrl(''); setHwImageUrl(''); setHwDisambig('');
    setHwBusy(false); setHwError(null);
  };

  /** A build is Luke's to fill in, so it starts empty with no run. */
  const createBuild = async () => {
    const name = window.prompt('Build name (e.g. "Team workstation")')?.trim();
    if (!name) return;
    const slug = suggestSlug(name);
    if (entityPayloads.build?.some(e => e.slug === slug)) { setApplyStatus(`build already exists: ${slug}`); return; }
    try {
      const res = await fetch(`${ADMIN_ORIGIN}/create-build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug }),
      });
      const data = await res.json();
      setApplyStatus(data.ok ? `Created build/${slug} — reload to fill it in` : (data.error || 'create failed'));
    } catch (err) {
      setApplyStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const submitHw = async () => {
    setHwError(null);
    const name = hwName.trim();
    const slug = (hwSlugTouched ? hwSlug : suggestSlug(hwName)).trim();
    const makerUrl = hwMakerUrl.trim();
    const imageUrl = hwImageUrl.trim();
    const disambig = hwDisambig.trim();
    if (!name) return setHwError('name required');
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(slug)) return setHwError('slug must be kebab-case');
    if (!/^https?:\/\//.test(makerUrl)) return setHwError('maker/product page URL must be http(s)');
    if (imageUrl && !/^https?:\/\//.test(imageUrl)) return setHwError('product image URL must be http(s) if provided');
    if (disambig.length < 5) return setHwError('disambiguation must be at least 5 characters');
    if (entityPayloads.part?.some(e => e.slug === slug)) return setHwError(`slug already exists: ${slug}`);

    setHwBusy(true);
    try {
      const res = await fetch(`${ADMIN_ORIGIN}/onboard-part`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, slug, cls: hwClass,
          maker_url: makerUrl,
          product_image_url: imageUrl || undefined,
          disambiguation: disambig,
        }),
      });
      const data = await res.json();
      if (!data.ok) { setHwError(data.error || 'onboard failed'); setHwBusy(false); return; }
      resetHw();
      queued(data.request);
    } catch (err) {
      setHwError(err instanceof Error ? err.message : String(err));
      setHwBusy(false);
    }
  };

  const resetHarness = () => {
    setHarnessOpen(false);
    setHarnessName(''); setHarnessSlug(''); setHarnessSlugTouched(false);
    setHarnessGithub(''); setHarnessLogoUrl(''); setHarnessDisambig('');
    setHarnessBusy(false); setHarnessError(null);
  };

  const submitHarness = async () => {
    setHarnessError(null);
    const name = harnessName.trim();
    const slug = (harnessSlugTouched ? harnessSlug : suggestSlug(harnessName)).trim();
    const github = harnessGithub.trim();
    const logo = harnessLogoUrl.trim();
    const disambig = harnessDisambig.trim();
    if (!name) return setHarnessError('name required');
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(slug)) return setHarnessError('slug must be kebab-case');
    if (!/^https?:\/\/github\.com\//.test(github)) return setHarnessError('GitHub URL must start with https://github.com/');
    if (logo && !/^https?:\/\//.test(logo)) return setHarnessError('logo URL must be http(s) if provided');
    if (disambig.length < 5) return setHarnessError('disambiguation must be at least 5 characters');
    if (entityPayloads.harness?.some(e => e.slug === slug)) return setHarnessError(`slug already exists: ${slug}`);

    setHarnessBusy(true);
    try {
      const res = await fetch(`${ADMIN_ORIGIN}/onboard-harness`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, slug,
          github_url: github,
          logo_image_url: logo || undefined,
          disambiguation: disambig,
        }),
      });
      const data = await res.json();
      if (!data.ok) { setHarnessError(data.error || 'onboard failed'); setHarnessBusy(false); return; }
      resetHarness();
      queued(data.request);
    } catch (err) {
      setHarnessError(err instanceof Error ? err.message : String(err));
      setHarnessBusy(false);
    }
  };

  const toggleEntity = (type: string, slug: string) => {
    const key = `${type}/${slug}`;
    setExpandedEntities(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Feedback from the last action (a queued request, an error); clears itself. */}
      {promptStatus && (
        <p className={`text-xs px-1 ${promptStatus.startsWith('✓') ? 'text-sky-300' : 'text-red-400'}`}>
          {promptStatus}
        </p>
      )}

      <RunsPanel version={runsVersion} />

      {/* Entity type sections */}
      {factTypes.map(type => (
        <div key={type} className="border border-nord-800 rounded-lg overflow-hidden">
          <div className="w-full flex items-center justify-between px-4 py-3 bg-nord-900 hover:bg-nord-800/80">
            <button
              onClick={() => setExpandedType(expandedType === type ? null : type)}
              className="flex items-center gap-3 flex-1 text-left"
            >
              <span
                title={typeAllVerified(type as EntityType) ? 'All facts verified across every entity' : 'One or more entities have unverified facts'}
                className={`inline-block w-3 h-3 rounded-sm ${typeAllVerified(type as EntityType) ? 'bg-frost-500' : 'bg-red-500'}`}
              />
              <div>
                <h2 className="text-base font-semibold text-nord-100">{TYPE_LABELS[type as EntityType]}</h2>
                {(() => {
                  const total = Object.keys(grouped[type]).length;
                  const verified = Object.keys(grouped[type]).filter(slug => entityAllVerified(type, slug)).length;
                  return (
                    <p className="text-xs text-nord-500 mt-0.5">
                      {total} entities / <span className="text-frost-400">{verified} verified</span>
                    </p>
                  );
                })()}
              </div>
            </button>
            <div className="flex items-center gap-3 shrink-0">
              {type === 'model' && (
                <button
                  onClick={e => { e.stopPropagation(); setOnboardOpen(true); }}
                  className="text-xs px-3 py-1.5 bg-frost-800/40 hover:bg-frost-700/60 text-frost-200 rounded border border-frost-700/60 transition-colors"
                >
                  + New model
                </button>
              )}
              {type === 'company' && (
                <button
                  onClick={e => { e.stopPropagation(); setCompanyOpen(true); }}
                  className="text-xs px-3 py-1.5 bg-frost-800/40 hover:bg-frost-700/60 text-frost-200 rounded border border-frost-700/60 transition-colors"
                >
                  + New company
                </button>
              )}
              {type === 'part' && (
                <button
                  onClick={e => { e.stopPropagation(); setHwOpen(true); }}
                  className="text-xs px-3 py-1.5 bg-frost-800/40 hover:bg-frost-700/60 text-frost-200 rounded border border-frost-700/60 transition-colors"
                >
                  + New part
                </button>
              )}
              {type === 'build' && (
                <button
                  onClick={e => { e.stopPropagation(); createBuild(); }}
                  className="text-xs px-3 py-1.5 bg-frost-800/40 hover:bg-frost-700/60 text-frost-200 rounded border border-frost-700/60 transition-colors"
                >
                  + New build
                </button>
              )}
              {type === 'harness' && (
                <button
                  onClick={e => { e.stopPropagation(); setHarnessOpen(true); }}
                  className="text-xs px-3 py-1.5 bg-frost-800/40 hover:bg-frost-700/60 text-frost-200 rounded border border-frost-700/60 transition-colors"
                >
                  + New harness
                </button>
              )}
              <button
                onClick={() => setExpandedType(expandedType === type ? null : type)}
                className="text-nord-500 text-sm px-2"
              >{expandedType === type ? '▲' : '▼'}</button>
            </div>
          </div>

          <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${expandedType === type ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden min-h-0">
            <div className="divide-y divide-nord-800">
              {entityOrder(type).map(slug => {
                const entity = grouped[type][slug];
                const entityKey = `${type}/${slug}`;
                const isEntityExpanded = expandedEntities.has(entityKey);
                const allVerified = entityAllVerified(type, slug);
                const researchFacts = entity.facts.filter(isResearchFact);
                const entityActiveFacts = researchFacts.filter(isActive);
                const factTotal = entityActiveFacts.length;
                const factVerified = entityActiveFacts.filter(f => isVerified(f)).length;
                const factUnverified = factTotal - factVerified;
                const factNA = researchFacts.length - factTotal;
                return (
                  <div key={slug} className="px-4 py-3 bg-nord-950/50">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => toggleEntity(type, slug)}
                        className="flex items-center gap-2.5 flex-1 min-w-0 text-left hover:bg-nord-900/40 -mx-2 px-2 py-1 rounded transition-colors">
                        <span className="text-nord-500 text-xs w-3 shrink-0">{isEntityExpanded ? '▾' : '▸'}</span>
                        <span
                          title={allVerified ? 'All facts verified' : 'One or more facts are unverified'}
                          className={`inline-block w-2.5 h-2.5 rounded-sm shrink-0 ${allVerified ? 'bg-frost-500' : 'bg-red-500'}`}
                        />
                        <h3 className="text-sm font-medium text-nord-200 truncate">{entity.name}</h3>
                        <span
                          title={`unverified / verified / active total${factNA > 0 ? ` (${factNA} N/A)` : ''}`}
                          className="text-[10px] font-mono shrink-0 tabular-nums">
                          <span className="text-red-400">{factUnverified}</span>
                          <span className="text-nord-600"> / </span>
                          <span className="text-frost-400">{factVerified}</span>
                          <span className="text-nord-600"> / </span>
                          <span className="text-nord-400">{factTotal}</span>
                          {factNA > 0 && (
                            <span className="text-nord-500"> ({factNA} N/A)</span>
                          )}
                        </span>
                      </button>
                      <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => queue({ type, slug })}
                          title={`Ask Neuman to re-research ${entity.name} — waits for Run now on the task in Neuman`}
                          className="text-[10px] px-2 py-1 bg-sky-900/60 hover:bg-sky-800/70 text-sky-200 rounded border border-sky-700 transition-colors">
                          Request update
                        </button>
                        <TrashButton
                          onClick={() => openDelete(type, slug, entity.name)}
                          title={`Delete ${entity.name} — removes its file and logo`} />
                      </div>
                    </div>

                    <div className={`grid transition-[grid-template-rows,margin-top] duration-200 ease-out ${isEntityExpanded ? 'grid-rows-[1fr] mt-2' : 'grid-rows-[0fr]'}`}>
                      <div className="overflow-hidden min-h-0">
                    {/* Curatorial controls (models, companies and builds). Rendered above the fact
                        grid because they're display config, not research facts. */}
                    {(type === 'model' || type === 'company' || type === 'build') && (() => {
                      const hiddenFact = entity.facts.find(f => f.fact_key === 'hidden');
                      const isHidden = (hiddenFact ? getEffectiveValue(hiddenFact) : null) === true;
                      const lv = hiddenFact ? getLocalVer(hiddenFact) : undefined;
                      const isDirty = lv && lv.edited_value !== undefined && lv.edited_value !== hiddenFact?.value;
                      return (
                        <div className="mt-3 px-3 py-2 bg-amber-950/20 border border-amber-900/40 rounded flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`hidden-${slug}`}
                            checked={isHidden}
                            onChange={e => setCuratorialBool(type, slug, 'hidden', e.target.checked)}
                            className="w-4 h-4 accent-amber-500 cursor-pointer"
                          />
                          <label htmlFor={`hidden-${slug}`} className="text-xs text-amber-100/90 cursor-pointer select-none flex-1">
                            Hide {type} from site
                            <span className="ml-2 text-amber-100/50">keeps its data; removes it from every page</span>
                            {isDirty && <span className="ml-2 text-amber-400">✎ unsaved</span>}
                          </label>
                        </div>
                      );
                    })()}
                    {/* One compact row per fact; a row opens to its full card in place. */}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5 pt-2">
                      {entity.facts.filter(f => f.fact_key !== 'hidden').map(f => {
                        const verified = isVerified(f);
                        const effVal = getEffectiveValue(f);
                        const isNull = effVal === null || effVal === undefined || effVal === '';
                        const lv = getLocalVer(f);
                        const isLocallyEdited = lv && lv.edited_value !== undefined && lv.edited_value !== f.value;
                        const isLocallySourced = lv && lv.edited_source !== undefined && lv.edited_source !== f.source;
                        const isEditing = editing === localVerKey(f);
                        const effSrc = getEffectiveSource(f);

                        // Prefer the archived snapshot over the live URL when
                        // we have one — clicking a verified card opens the exact
                        // page luke signed off on, not a possibly-drifted live page.
                        const blobHref = f.snapshot_hash ? snapshotUrl(f.snapshot_hash, f.snapshot_ext) : null;

                        const clickSource = () => {
                          if (isEditing) return;
                          const target = blobHref || effSrc;
                          if (target) window.open(target, '_blank');
                        };

                        const isList = isListFact(f.entity_type, f.fact_key);
                        const isMyTake = isMyTakeFact(f.fact_key);
                        const listColumns = isList
                          ? (schemaEntryFor(f.entity_type, f.fact_key)?.shape?.columns ?? [])
                          : [];
                        const isListArray = isList && Array.isArray(effVal);
                        const factKey = localVerKey(f);
                        const isOpen = isEditing || openFacts.has(factKey);
                        const cardSpan = isOpen && (isList || isMyTake) ? 'md:col-span-2 xl:col-span-3' : '';
                        const factHasValue = hasValue(f);
                        const na = getEffectiveNA(f);

                        // Five states, three colors:
                        //   N/A              → dashed grey, faded (excluded from tallies)
                        //   verified + value → full green
                        //   verified + null  → muted green (signed off as "unavailable")
                        //   unverified       → red
                        const cardClass = na
                          ? 'bg-nord-950/60 border-nord-800 border-dashed opacity-60'
                          : verified
                            ? (factHasValue
                                ? 'bg-frost-800/25 border-frost-700/60'
                                : 'bg-frost-900/15 border-frost-800/40')
                            : 'bg-red-800/25 border-red-700/60';

                        if (na) {
                          // N/A cards: greyed-out, single Reactivate button, no other actions.
                          return (
                            <div key={f.fact_key}
                              className={`rounded border px-2 py-1 text-xs flex items-center gap-2 ${cardClass}`}
                              title="Not applicable for this entity"
                            >
                              <span className="font-mono text-[10px] text-nord-500 truncate flex-1">{f.fact_key}</span>
                              <span className="text-[9px] px-1 bg-nord-800 text-nord-500 rounded">N/A</span>
                              <button onClick={() => toggleNA(f)}
                                title="Reactivate this fact"
                                className="text-[10px] px-1.5 bg-nord-800 hover:bg-nord-700 text-nord-400 rounded">↺</button>
                            </div>
                          );
                        }

                        // What the collapsed row shows: enough to tell the fact apart.
                        const summary = isMyTake
                          ? ((typeof effVal === 'string' && effVal.trim()) ? effVal.trim().split('\n')[0] : '—')
                          : isListArray
                            ? `${(effVal as ListRow[]).length} row${(effVal as ListRow[]).length === 1 ? '' : 's'}`
                            : (!factHasValue && verified ? 'unavailable' : fmtVal(effVal));

                        return (
                          <div key={f.fact_key}
                            className={`group rounded border text-xs transition-colors ${cardSpan} ${cardClass}`}
                          >
                            {/* Collapsed row: click to open the full card. */}
                            <div onClick={() => { if (!isEditing) toggleFact(factKey); }}
                              className="flex items-center gap-2 px-2 py-1 cursor-pointer select-none">
                              <span className="font-mono text-[10px] text-nord-400 truncate min-w-0 shrink" title={f.fact_key}>{f.fact_key}</span>
                              <span className={`font-mono text-[11px] truncate min-w-0 flex-1 text-right ${
                                isNull && !isListArray ? 'text-nord-500 italic' : isLocallyEdited ? 'text-amber-300' : verified ? 'text-frost-200' : 'text-nord-200'
                              }`} title={summary}>
                                {isLocallyEdited && <span className="text-amber-400 mr-0.5">✎</span>}
                                {summary}
                              </span>
                              {!verified && !isEditing && (
                                <button onClick={e => { e.stopPropagation(); markVerified(f); }}
                                  title="Verify"
                                  className="text-[10px] px-1.5 bg-frost-600 hover:bg-frost-500 text-white rounded shrink-0">✓</button>
                              )}
                              {!isEditing && (
                                <button onClick={e => { e.stopPropagation(); toggleNA(f); }}
                                  title="Mark N/A — this fact doesn't apply to this entity"
                                  className="text-[11px] leading-none px-1 text-nord-500 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">×</button>
                              )}
                              <span className={`text-nord-500 text-[9px] shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                            </div>
                            {isOpen && (
                            <div onClick={isMyTake ? undefined : clickSource}
                              className={`border-t border-white/5 p-2.5 ${(isEditing || isMyTake) ? 'cursor-default' : 'cursor-pointer'}`}
                              title={isMyTake || isEditing ? undefined : 'Open the source'}>
                            {/* Front face or edit form */}
                            {isEditing && isMyTake ? (
                              <div onClick={e => e.stopPropagation()} className="space-y-2">
                                <div className="font-mono text-[10px] text-nord-400 break-all mb-1">{f.fact_key}</div>
                                <textarea
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); }}
                                  rows={8}
                                  placeholder="Your take on this entity. Plain text or markdown. Empty = section hidden on the entity page."
                                  className="w-full bg-nord-800 border border-nord-700 rounded px-2 py-1.5 text-xs font-mono text-nord-200 outline-none focus:border-frost-600 leading-relaxed"
                                />
                                <div className="flex gap-2 pt-1">
                                  <button onClick={() => saveEdit(f)}
                                    className="text-[10px] px-3 py-1 bg-frost-700 hover:bg-frost-600 text-white rounded font-medium">OK</button>
                                  <button onClick={cancelEdit}
                                    className="text-[10px] px-3 py-1 bg-nord-700 hover:bg-nord-600 text-nord-300 rounded">Cancel</button>
                                </div>
                              </div>
                            ) : isMyTake ? (() => {
                              const verBy = lv?.verified_by ?? f.verified_by;
                              const verAt = lv?.verified_at ?? f.verified_at;
                              const text = typeof effVal === 'string' ? effVal : '';
                              return (
                                <div>
                                  <div className="font-mono text-[10px] text-nord-400 break-all mb-1 flex items-center gap-1">
                                    <span>{f.fact_key}</span>
                                    <SignerBadge signer={f.verified_by} />
                                    <SnapshotBadge hash={f.snapshot_hash} ext={f.snapshot_ext} />
                                  </div>
                                  {text.trim() === '' ? (
                                    <div className={`italic text-xs ${verified ? 'text-frost-500/70' : 'text-nord-500'}`}>
                                      {verified ? '(intentionally blank)' : '(no my-take written yet)'}
                                    </div>
                                  ) : (
                                    <div className={`text-xs whitespace-pre-wrap leading-relaxed ${isLocallyEdited ? 'text-amber-300' : verified ? 'text-frost-100' : 'text-nord-200'}`}>
                                      {isLocallyEdited && <span className="text-amber-400 mr-0.5">✎</span>}
                                      {text}
                                    </div>
                                  )}
                                  <div className="flex justify-end items-center gap-2 mt-2" onClick={e => e.stopPropagation()}>
                                    {verified && verBy && (
                                      <div className="text-[9px] text-nord-500 font-mono mr-auto leading-tight">
                                        <div>✓ {verBy}{verAt ? ` · ${verAt}` : ''}</div>
                                        {verAt && <div className="pl-3"><StalenessTag date={verAt} /></div>}
                                      </div>
                                    )}
                                    {verified ? (
                                      <button onClick={() => markUnverified(f)}
                                        className="text-[10px] px-2 py-1 bg-nord-800 hover:bg-nord-700 text-nord-400 rounded">Unverify</button>
                                    ) : (
                                      <>
                                        <button onClick={() => markVerified(f)}
                                          className="text-[10px] px-2 py-1 bg-frost-600 hover:bg-frost-500 text-white rounded font-medium">Verify</button>
                                        <button onClick={() => startEdit(f)}
                                          title="Edit"
                                          className="text-[10px] px-2 py-1 bg-nord-800 hover:bg-nord-700 text-nord-300 rounded">✎</button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })() : isEditing && isList ? (
                              <div onClick={e => e.stopPropagation()} className="space-y-2">
                                <div className="font-mono text-[10px] text-nord-400 break-all mb-1">{f.fact_key}</div>
                                <div className="space-y-1">
                                  {/* Header row: column names */}
                                  <div className="flex gap-1.5 text-[10px] text-nord-500 px-1">
                                    {listColumns.map(c => (
                                      <span key={c.name} className="flex-1 min-w-0">{c.name}</span>
                                    ))}
                                    <span className="w-5" />
                                  </div>
                                  {listDraft.map((row, ri) => (
                                    <div key={ri} className="flex gap-1.5 items-center">
                                      {listColumns.map(c => (
                                        <input
                                          key={c.name}
                                          type={c.type === 'number' ? 'number' : 'text'}
                                          step={c.type === 'number' ? 'any' : undefined}
                                          value={row[c.name] === null || row[c.name] === undefined ? '' : String(row[c.name])}
                                          placeholder={c.name}
                                          onChange={e => {
                                            const next = [...listDraft];
                                            const raw = e.target.value;
                                            let coerced: string | number | boolean | null;
                                            if (raw.trim() === '') coerced = null;
                                            else if (c.type === 'number') { const n = Number(raw); coerced = Number.isNaN(n) ? null : n; }
                                            else if (c.type === 'boolean') coerced = raw === 'true' ? true : raw === 'false' ? false : null;
                                            else coerced = raw;
                                            next[ri] = { ...next[ri], [c.name]: coerced };
                                            setListDraft(next);
                                          }}
                                          className="flex-1 min-w-0 bg-nord-800 border border-nord-700 rounded px-2 py-1 text-xs font-mono text-nord-200 outline-none focus:border-frost-600"
                                        />
                                      ))}
                                      <button onClick={() => setListDraft(listDraft.filter((_, j) => j !== ri))}
                                        title="Remove row"
                                        className="text-nord-500 hover:text-red-400 px-1 w-5">✕</button>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex gap-2 pt-1">
                                  <button onClick={() => setListDraft([...listDraft, blankListRow(listColumns)])}
                                    className="text-[10px] px-2 py-1 bg-nord-800 hover:bg-nord-700 text-nord-300 rounded border border-nord-700">
                                    + Add row
                                  </button>
                                  <div className="flex-1" />
                                  <button onClick={() => saveEdit(f)}
                                    className="text-[10px] px-3 py-1 bg-frost-700 hover:bg-frost-600 text-white rounded font-medium">OK</button>
                                  <button onClick={cancelEdit}
                                    className="text-[10px] px-3 py-1 bg-nord-700 hover:bg-nord-600 text-nord-300 rounded">Cancel</button>
                                </div>
                              </div>
                            ) : isEditing ? (
                              <div onClick={e => e.stopPropagation()} className="space-y-2">
                                <div className="font-mono text-[10px] text-nord-400 break-all mb-0.5">{f.fact_key}</div>
                                <div>
                                  <label className="text-[10px] text-nord-500 block mb-0.5">
                                    Value <span className="text-nord-600">(leave empty to sign off as "unavailable")</span>
                                  </label>
                                  <input ref={editRef} type="text" value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') (sourceRef.current || editRef.current)?.focus(); }}
                                    className="w-full bg-nord-800 border border-nord-700 rounded px-2 py-1.5 text-xs font-mono text-nord-200 outline-none focus:border-frost-600 mb-1.5" />
                                </div>
                                <div>
                                  <label className="text-[10px] text-nord-500 block mb-0.5">Source URL <span className="text-nord-600">(optional — where the value came from)</span></label>
                                  <input ref={sourceRef} type="text" value={editSource}
                                    onChange={e => setEditSource(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(f); if (e.key === 'Escape') cancelEdit(); }}
                                    className="w-full bg-nord-800 border border-nord-700 rounded px-2 py-1.5 text-xs font-mono text-nord-200 outline-none focus:border-frost-600" />
                                </div>
                                <div className="flex gap-2 pt-1">
                                  <button onClick={() => saveEdit(f)}
                                    className="flex-1 text-[10px] px-2 py-1.5 bg-frost-700 hover:bg-frost-600 text-white rounded text-center font-medium">OK</button>
                                  <button onClick={cancelEdit}
                                    className="flex-1 text-[10px] px-2 py-1.5 bg-nord-700 hover:bg-nord-600 text-nord-300 rounded text-center">Cancel</button>
                                </div>
                              </div>
                            ) : isListArray ? (
                              (() => {
                                const arr = effVal as ListRow[];
                                return (
                                  <div>
                                    <div className="font-mono text-[10px] text-nord-400 break-all mb-1 flex items-center flex-wrap gap-1">
                                      <span>{f.fact_key}</span>
                                      <SignerBadge signer={f.verified_by} />
                                      <SnapshotBadge hash={f.snapshot_hash} ext={f.snapshot_ext} />
                                      <span className="flex-1" />
                                      <span className="text-[10px] text-nord-500">{arr.length} row{arr.length === 1 ? '' : 's'}</span>
                                    </div>
                                    {arr.length === 0 ? (
                                      <div className="text-nord-500 italic text-xs">(empty — none published)</div>
                                    ) : isQuantFact(f.fact_key) ? (() => {
                                      // Group by bit-width parsed from the quant name, sort
                                      // groups ascending, sort rows within a group by size asc.
                                      // Layout mirrors the HF quant table: bit label on the left,
                                      // rows on the right. Rows that don't parse land in "Other".
                                      const groups = new Map<number | null, ListRow[]>();
                                      for (const row of arr) {
                                        const name = typeof row.name === 'string' ? row.name : '';
                                        const bits = quantBits(name);
                                        const list = groups.get(bits) ?? [];
                                        list.push(row);
                                        groups.set(bits, list);
                                      }
                                      const orderedBits = [...groups.keys()].sort((a, b) => {
                                        if (a === null) return 1;
                                        if (b === null) return -1;
                                        return a - b;
                                      });
                                      return (
                                        <div className="space-y-1.5">
                                          {orderedBits.map(bits => {
                                            const rows = groups.get(bits)!.slice().sort((a, b) => {
                                              const av = typeof a.size_gb === 'number' ? a.size_gb : 0;
                                              const bv = typeof b.size_gb === 'number' ? b.size_gb : 0;
                                              return av - bv;
                                            });
                                            return (
                                              <div key={bits ?? 'other'} className="flex items-start gap-2 text-xs font-mono">
                                                <div className="w-10 shrink-0 text-[10px] text-nord-500 pt-0.5 text-right">
                                                  {bits === null ? 'Other' : `${bits}-bit`}
                                                </div>
                                                <div className="flex-1 space-y-0.5">
                                                  {rows.map((row, ri) => (
                                                    <div key={ri} className="flex items-center gap-2">
                                                      <span className="text-nord-200 flex-1">{String(row.name ?? '')}</span>
                                                      <span className="text-nord-400">{formatQuantSize(row.size_gb)}</span>
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      );
                                    })() : (
                                      <div className="space-y-0.5">
                                        {arr.map((row, ri) => (
                                          <div key={ri} className="flex items-center gap-2 text-xs font-mono">
                                            {listColumns.map((c, ci) => (
                                              <React.Fragment key={c.name}>
                                                {ci > 0 && <span className="text-nord-500">·</span>}
                                                <span className={ci === 0 ? 'text-nord-200' : 'text-nord-300'}>{formatCell(row[c.name])}</span>
                                              </React.Fragment>
                                            ))}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {(() => {
                                      const verBy = lv?.verified_by ?? f.verified_by;
                                      const verAt = lv?.verified_at ?? f.verified_at;
                                      return (
                                        <div className="flex justify-end items-start gap-2 mt-2" onClick={e => e.stopPropagation()}>
                                          {verified && verBy && (
                                            <div className="text-[9px] text-nord-500 font-mono mr-auto leading-tight">
                                              <div>✓ {verBy}{verAt ? ` · ${verAt}` : ''}</div>
                                              {verAt && <div className="pl-3"><StalenessTag date={verAt} /></div>}
                                            </div>
                                          )}
                                          {verified ? (
                                            <button onClick={() => markUnverified(f)}
                                              className="text-[10px] px-2 py-1 bg-nord-800 hover:bg-nord-700 text-nord-400 rounded">Unverify</button>
                                          ) : (
                                            <>
                                              <button onClick={() => markVerified(f)}
                                                className="text-[10px] px-2 py-1 bg-frost-600 hover:bg-frost-500 text-white rounded font-medium">Verify</button>
                                              <button onClick={() => startEdit(f)}
                                                title="Edit"
                                                className="text-[10px] px-2 py-1 bg-nord-800 hover:bg-nord-700 text-nord-300 rounded">✎</button>
                                            </>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                );
                              })()
                            ) : (() => {
                              const verBy = lv?.verified_by ?? f.verified_by;
                              const verAt = lv?.verified_at ?? f.verified_at;
                              return (
                              <div className="flex flex-col gap-1.5">
                                <div className="flex gap-2">
                                  {/* Left: fact key + value + source */}
                                  <div className="flex-1 min-w-0">
                                    <div className="font-mono text-[10px] text-nord-400 break-all mb-0.5 flex items-center gap-1 flex-wrap">
                                      <span>{f.fact_key}</span>
                                      <SignerBadge signer={f.verified_by} />
                                      <SnapshotBadge hash={f.snapshot_hash} ext={f.snapshot_ext} />
                                      {!factHasValue && verified && (
                                        <span title="Signed off as unavailable — no public data for this fact"
                                          className="text-[10px] px-1 py-0.5 bg-frost-900/40 text-frost-500 rounded">unavailable</span>
                                      )}
                                    </div>
                                    <div className={`font-mono text-sm truncate ${
                                      isNull ? 'text-nord-500 italic' : isLocallyEdited ? 'text-amber-300' : verified ? 'text-frost-200' : 'text-nord-200'
                                    }`} title={fmtVal(effVal)}>
                                      {isLocallyEdited && <span className="text-amber-400 mr-0.5">✎</span>}
                                      {!factHasValue && verified ? 'unavailable' : fmtVal(effVal)}
                                    </div>
                                    {effSrc && (
                                      <div className="text-[9px] text-nord-600 truncate mt-0.5" title={effSrc}>
                                        {isLocallySourced && <span className="text-amber-400 mr-0.5">✎</span>}
                                        {effSrc.replace(/^https?:\/\//, '').slice(0, 35)}
                                      </div>
                                    )}
                                  </div>

                                  {/* Right: action buttons */}
                                  <div className="flex flex-col gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                    {verified ? (
                                      <button onClick={() => markUnverified(f)}
                                        className="w-16 text-[10px] px-1 py-1.5 bg-nord-800 hover:bg-nord-700 text-nord-400 rounded text-center">Unverify</button>
                                    ) : (
                                      <>
                                        <button onClick={() => markVerified(f)}
                                          className="w-16 text-[10px] px-1 py-1.5 bg-frost-600 hover:bg-frost-500 text-white rounded text-center font-medium">Verify</button>
                                        <button onClick={() => startEdit(f)}
                                          title="Edit"
                                          className={`w-16 text-[10px] px-1 py-1.5 rounded text-center inline-flex items-center justify-center ${isEditing ? 'bg-amber-700 text-white' : 'bg-nord-800 hover:bg-nord-700 text-nord-300'}`}>✎</button>
                                      </>
                                    )}
                                  </div>
                                </div>

                                {verified && verBy && (
                                  <div className="text-[9px] text-nord-500 text-right font-mono leading-tight" onClick={e => e.stopPropagation()}>
                                    <div>✓ {verBy}{verAt ? ` · ${verAt}` : ''}</div>
                                    {verAt && <div><StalenessTag date={verAt} /></div>}
                                  </div>
                                )}
                              </div>
                              );
                            })()}
                            </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        </div>
      ))}

      <NewsPanel />

      {/* Fact tally across every entity. */}
      <p className="text-xs text-nord-500 px-1">
        <strong className="text-frost-400 font-medium tabular-nums">{verifiedCount}</strong> verified
        <span className="text-nord-700 mx-2">·</span>
        <strong className="text-red-400 font-medium tabular-nums">{unverifiedCount}</strong> unverified
        <span className="text-nord-700 mx-2">·</span>
        <strong className="text-nord-400 font-medium tabular-nums">{activeFacts.length}</strong> total
        {naCount > 0 && (
          <>
            <span className="text-nord-700 mx-2">·</span>
            <strong className="text-nord-400 font-medium tabular-nums">{naCount}</strong> N/A
          </>
        )}
      </p>

      {/* Delete confirmation — shared by all four types. The entity file and
          its logo leave the working tree; the change log keeps the values it
          recorded while the entity existed, and prose that mentions it stays
          as written. */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={closeDelete}>
          <div className="w-full max-w-md bg-nord-950 border border-nord-800 rounded-lg shadow-xl p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-nord-100">Delete {deleteTarget.name}?</h3>
              <button onClick={closeDelete} disabled={deleteBusy}
                className="text-nord-500 hover:text-nord-300 text-sm disabled:opacity-40">✕</button>
            </div>
            <p className="text-xs text-nord-500 mb-3 leading-relaxed">
              This removes <span className="text-nord-300 font-mono">src/data/{ENTITY_DIR[deleteTarget.type as EntityType]}/{deleteTarget.slug}.json</span>
              {' '}and its logo, and drops any request queued for it. There is no undo — the page
              disappears on the next build and <span className="text-nord-300">git</span> is your only copy.
            </p>
            <p className="text-xs text-nord-500 mb-3 leading-relaxed">
              The change log keeps the values it recorded while the {deleteTarget.type} existed.
            </p>

            {deleteError && (
              <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/60 rounded px-3 py-2 mb-3">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={closeDelete} disabled={deleteBusy}
                className="text-xs px-3 py-2 bg-nord-800 hover:bg-nord-700 text-nord-300 rounded disabled:opacity-40">
                Cancel
              </button>
              <button onClick={submitDelete} disabled={deleteBusy}
                className="text-xs px-3 py-2 bg-red-700 hover:bg-red-600 text-white rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                {deleteBusy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding modal — new model. Right side of the Models section header
          opens this; submission POSTs /onboard-model, which seeds the entity
          and queues the onboarding run shown under Recent update runs. */}
      {onboardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => !onboardBusy && resetOnboard()}>
          <div className="w-full max-w-lg bg-nord-950 border border-nord-800 rounded-lg shadow-xl p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-nord-100">Onboard new model</h3>
              <button onClick={resetOnboard} disabled={onboardBusy}
                className="text-nord-500 hover:text-nord-300 text-sm disabled:opacity-40">✕</button>
            </div>
            <p className="text-xs text-nord-500 mb-4">
              Paste the official release announcement URL and describe exactly which model this is.
              We&rsquo;ll seed the entity and create a run; Neuman fills the rest from its brief.
            </p>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs text-nord-400 mb-1">Model name</label>
                <input
                  type="text"
                  value={onboardName}
                  onChange={e => {
                    setOnboardName(e.target.value);
                    if (!onboardSlugTouched) setOnboardSlug(suggestSlug(e.target.value));
                  }}
                  placeholder="e.g. DeepSeek V4 Flash 0731"
                  disabled={onboardBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 outline-none focus:border-frost-600"
                />
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">
                  Slug <span className="text-nord-600">(filename in src/data/models/)</span>
                </label>
                <input
                  type="text"
                  value={onboardSlugTouched ? onboardSlug : suggestSlug(onboardName)}
                  onChange={e => { setOnboardSlug(e.target.value); setOnboardSlugTouched(true); }}
                  placeholder="deepseek-v4-flash-0731"
                  disabled={onboardBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 font-mono outline-none focus:border-frost-600"
                />
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">Official release announcement URL</label>
                <input
                  type="url"
                  value={onboardUrl}
                  onChange={e => setOnboardUrl(e.target.value)}
                  placeholder="https://api-docs.deepseek.com/news/..."
                  disabled={onboardBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 font-mono text-xs outline-none focus:border-frost-600"
                />
                <p className="text-[10px] text-nord-600 mt-1">
                  The developer&rsquo;s own announcement — press release, product page, or blog post from them.
                  Not third-party coverage.
                </p>
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">Distribution</label>
                <select
                  value={onboardDistribution}
                  onChange={e => setOnboardDistribution(e.target.value as 'open' | 'closed' | 'gated')}
                  disabled={onboardBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 outline-none focus:border-frost-600"
                >
                  <option value="open">open — weights downloadable, permissive license</option>
                  <option value="gated">gated — weights downloadable with acceptable-use restrictions</option>
                  <option value="closed">closed — API-only, no weights</option>
                </select>
                <p className="text-[10px] text-nord-600 mt-1">
                  Determines which facts apply. Closed models won&rsquo;t ask about HF card, quants, or native size.
                </p>
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">Disambiguation</label>
                <textarea
                  value={onboardDisambig}
                  onChange={e => setOnboardDisambig(e.target.value)}
                  rows={3}
                  placeholder="This is DeepSeek V4 Flash 0731 (2026-07-31 release) — NOT the preview or the earlier 0611 checkpoint. HF repo is deepseek-ai/DeepSeek-V4-Flash-0731."
                  disabled={onboardBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 text-xs outline-none focus:border-frost-600 leading-relaxed"
                />
                <p className="text-[10px] text-nord-600 mt-1">
                  Neuman uses this to lock down identity before touching any fact. Be specific — model names collide.
                </p>
              </div>

              {onboardError && (
                <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/60 rounded px-3 py-2">
                  {onboardError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={resetOnboard} disabled={onboardBusy}
                className="text-xs px-3 py-2 bg-nord-800 hover:bg-nord-700 text-nord-300 rounded disabled:opacity-40">
                Cancel
              </button>
              <button onClick={submitOnboard} disabled={onboardBusy}
                className="text-xs px-3 py-2 bg-frost-600 hover:bg-frost-500 text-white rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                {onboardBusy ? 'Adding model…' : 'Add model'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding modal — new company. */}
      {companyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => !companyBusy && resetCompany()}>
          <div className="w-full max-w-lg bg-nord-950 border border-nord-800 rounded-lg shadow-xl p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-nord-100">Onboard new company</h3>
              <button onClick={resetCompany} disabled={companyBusy}
                className="text-nord-500 hover:text-nord-300 text-sm disabled:opacity-40">✕</button>
            </div>
            <p className="text-xs text-nord-500 mb-4">
              Paste the company&rsquo;s homepage, Wikipedia article, and (optionally) HuggingFace organization URL.
              We&rsquo;ll seed the entity and create a run; Neuman extracts the rest from its brief.
            </p>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs text-nord-400 mb-1">Company name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={e => {
                    setCompanyName(e.target.value);
                    if (!companySlugTouched) setCompanySlug(suggestSlug(e.target.value));
                  }}
                  placeholder="e.g. MiniMax"
                  disabled={companyBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 outline-none focus:border-frost-600"
                />
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">
                  Slug <span className="text-nord-600">(filename in src/data/companies/)</span>
                </label>
                <input
                  type="text"
                  value={companySlugTouched ? companySlug : suggestSlug(companyName)}
                  onChange={e => { setCompanySlug(e.target.value); setCompanySlugTouched(true); }}
                  placeholder="minimax"
                  disabled={companyBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 font-mono outline-none focus:border-frost-600"
                />
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">Official homepage</label>
                <input
                  type="url"
                  value={companyOfficial}
                  onChange={e => setCompanyOfficial(e.target.value)}
                  placeholder="https://www.minimax.io/"
                  disabled={companyBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 font-mono text-xs outline-none focus:border-frost-600"
                />
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">Wikipedia URL</label>
                <input
                  type="url"
                  value={companyWiki}
                  onChange={e => setCompanyWiki(e.target.value)}
                  placeholder="https://en.wikipedia.org/wiki/MiniMax_(company)"
                  disabled={companyBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 font-mono text-xs outline-none focus:border-frost-600"
                />
                <p className="text-[10px] text-nord-600 mt-1">
                  The infobox drives country, founded, ownership, employee_tier, etc.
                </p>
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">HuggingFace organization <span className="text-nord-600">(optional)</span></label>
                <input
                  type="url"
                  value={companyHf}
                  onChange={e => setCompanyHf(e.target.value)}
                  placeholder="https://huggingface.co/MiniMaxAI"
                  disabled={companyBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 font-mono text-xs outline-none focus:border-frost-600"
                />
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">Disambiguation <span className="text-nord-600">(optional)</span></label>
                <textarea
                  value={companyDisambig}
                  onChange={e => setCompanyDisambig(e.target.value)}
                  rows={2}
                  placeholder="This is MiniMax the Shanghai-based AI lab (稀宇科技), NOT the MiniMax music platform."
                  disabled={companyBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 text-xs outline-none focus:border-frost-600 leading-relaxed"
                />
                <p className="text-[10px] text-nord-600 mt-1">
                  Leave blank when the name is unambiguous.
                </p>
              </div>

              {companyError && (
                <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/60 rounded px-3 py-2">
                  {companyError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={resetCompany} disabled={companyBusy}
                className="text-xs px-3 py-2 bg-nord-800 hover:bg-nord-700 text-nord-300 rounded disabled:opacity-40">
                Cancel
              </button>
              <button onClick={submitCompany} disabled={companyBusy}
                className="text-xs px-3 py-2 bg-frost-600 hover:bg-frost-500 text-white rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                {companyBusy ? 'Adding company…' : 'Add company'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding modal — new part. Seeds class + snapshot.maker and,
          optionally, downloads a product image into public/logos/<dir>/. */}
      {hwOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => !hwBusy && resetHw()}>
          <div className="w-full max-w-lg bg-nord-950 border border-nord-800 rounded-lg shadow-xl p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-nord-100">Onboard new part</h3>
              <button onClick={resetHw} disabled={hwBusy}
                className="text-nord-500 hover:text-nord-300 text-sm disabled:opacity-40">✕</button>
            </div>
            <p className="text-xs text-nord-500 mb-4">
              Pick the class, paste the maker&rsquo;s product page and (optionally) a product image URL,
              and describe exactly which SKU/variant this is. The run asks Neuman for the class-appropriate facts.
            </p>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs text-nord-400 mb-1">Part name</label>
                <input
                  type="text"
                  value={hwName}
                  onChange={e => {
                    setHwName(e.target.value);
                    if (!hwSlugTouched) setHwSlug(suggestSlug(e.target.value));
                  }}
                  placeholder="e.g. TPU v5p, M3 Max, RTX 5090"
                  disabled={hwBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 outline-none focus:border-frost-600"
                />
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">
                  Slug <span className="text-nord-600">(filename in src/data/parts/)</span>
                </label>
                <input
                  type="text"
                  value={hwSlugTouched ? hwSlug : suggestSlug(hwName)}
                  onChange={e => { setHwSlug(e.target.value); setHwSlugTouched(true); }}
                  placeholder="rtx-pro-6000-blackwell"
                  disabled={hwBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 font-mono outline-none focus:border-frost-600"
                />
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">Class</label>
                <select
                  value={hwClass}
                  onChange={e => setHwClass(e.target.value as 'gpu' | 'system')}
                  disabled={hwBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 outline-none focus:border-frost-600"
                >
                  <option value="gpu">GPU — an add-in card (VRAM, board power, slot width)</option>
                  <option value="system">System — a machine bought as one: DGX Station, Mac Studio, HGX server</option>
                </select>
                <p className="text-[10px] text-nord-600 mt-1">
                  Determines which facts apply. Class-inappropriate facts are omitted from the schema.
                </p>
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">Maker product page URL</label>
                <input
                  type="url"
                  value={hwMakerUrl}
                  onChange={e => setHwMakerUrl(e.target.value)}
                  placeholder="https://cloud.google.com/tpu/docs/v5p"
                  disabled={hwBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 font-mono text-xs outline-none focus:border-frost-600"
                />
                <p className="text-[10px] text-nord-600 mt-1">
                  The maker&rsquo;s own product/spec page or datasheet PDF. Highest authority for headline specs.
                </p>
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">
                  Product image URL <span className="text-nord-600">(optional)</span>
                </label>
                <input
                  type="url"
                  value={hwImageUrl}
                  onChange={e => setHwImageUrl(e.target.value)}
                  placeholder="https://.../tpu-v5p.png"
                  disabled={hwBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 font-mono text-xs outline-none focus:border-frost-600"
                />
                <p className="text-[10px] text-nord-600 mt-1">
                  We&rsquo;ll download and save it as <code className="text-nord-500">public/logos/{hwClass === 'gpu' ? 'gpus' : 'systems'}/{hwSlug || '<slug>'}.&lt;ext&gt;</code>.
                  Supported: SVG, PNG, JPG, WebP.
                </p>
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">Disambiguation</label>
                <textarea
                  value={hwDisambig}
                  onChange={e => setHwDisambig(e.target.value)}
                  rows={3}
                  placeholder="This is the TPU v5p (production, 2024) — NOT v5e (inference-optimized) or v4. Google Cloud's flagship training TPU."
                  disabled={hwBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 text-xs outline-none focus:border-frost-600 leading-relaxed"
                />
                <p className="text-[10px] text-nord-600 mt-1">
                  Neuman uses this to lock down the SKU before touching any fact. Be specific — hardware variants collide.
                </p>
              </div>

              {hwError && (
                <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/60 rounded px-3 py-2">
                  {hwError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={resetHw} disabled={hwBusy}
                className="text-xs px-3 py-2 bg-nord-800 hover:bg-nord-700 text-nord-300 rounded disabled:opacity-40">
                Cancel
              </button>
              <button onClick={submitHw} disabled={hwBusy}
                className="text-xs px-3 py-2 bg-frost-600 hover:bg-frost-500 text-white rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                {hwBusy ? 'Adding part…' : 'Add part'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding modal — new harness. Seeds snapshot.github and,
          optionally, downloads a logo into public/logos/harnesses/. */}
      {harnessOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => !harnessBusy && resetHarness()}>
          <div className="w-full max-w-lg bg-nord-950 border border-nord-800 rounded-lg shadow-xl p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-nord-100">Onboard new harness</h3>
              <button onClick={resetHarness} disabled={harnessBusy}
                className="text-nord-500 hover:text-nord-300 text-sm disabled:opacity-40">✕</button>
            </div>
            <p className="text-xs text-nord-500 mb-4">
              Paste the GitHub repo URL and (optionally) a logo image URL. The run asks Neuman for the qualitative facts;
              license and language breakdown are auto-synced from the GitHub API by <code className="text-nord-400">sync-github.mjs</code>.
            </p>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs text-nord-400 mb-1">Harness name</label>
                <input
                  type="text"
                  value={harnessName}
                  onChange={e => {
                    setHarnessName(e.target.value);
                    if (!harnessSlugTouched) setHarnessSlug(suggestSlug(e.target.value));
                  }}
                  placeholder="e.g. Cline, Aider, Continue"
                  disabled={harnessBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 outline-none focus:border-frost-600"
                />
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">
                  Slug <span className="text-nord-600">(filename in src/data/harnesses/)</span>
                </label>
                <input
                  type="text"
                  value={harnessSlugTouched ? harnessSlug : suggestSlug(harnessName)}
                  onChange={e => { setHarnessSlug(e.target.value); setHarnessSlugTouched(true); }}
                  placeholder="cline"
                  disabled={harnessBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 font-mono outline-none focus:border-frost-600"
                />
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">GitHub repo URL</label>
                <input
                  type="url"
                  value={harnessGithub}
                  onChange={e => setHarnessGithub(e.target.value)}
                  placeholder="https://github.com/cline/cline"
                  disabled={harnessBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 font-mono text-xs outline-none focus:border-frost-600"
                />
                <p className="text-[10px] text-nord-600 mt-1">
                  Must be a github.com URL. The next sync-github run auto-fills license and language breakdown.
                </p>
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">
                  Logo image URL <span className="text-nord-600">(optional)</span>
                </label>
                <input
                  type="url"
                  value={harnessLogoUrl}
                  onChange={e => setHarnessLogoUrl(e.target.value)}
                  placeholder="https://.../cline-logo.svg"
                  disabled={harnessBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 font-mono text-xs outline-none focus:border-frost-600"
                />
                <p className="text-[10px] text-nord-600 mt-1">
                  We&rsquo;ll download and save it as <code className="text-nord-500">public/logos/harnesses/{harnessSlug || '<slug>'}.&lt;ext&gt;</code>.
                  Supported: SVG, PNG, JPG, WebP.
                </p>
              </div>

              <div>
                <label className="block text-xs text-nord-400 mb-1">Disambiguation</label>
                <textarea
                  value={harnessDisambig}
                  onChange={e => setHarnessDisambig(e.target.value)}
                  rows={3}
                  placeholder="This is Cline, the VSCode coding agent extension (formerly Claude Dev) — NOT unrelated CLIs named Cline. Maintained by cline/cline on GitHub."
                  disabled={harnessBusy}
                  className="w-full bg-nord-900 border border-nord-800 rounded px-3 py-2 text-nord-100 text-xs outline-none focus:border-frost-600 leading-relaxed"
                />
                <p className="text-[10px] text-nord-600 mt-1">
                  Neuman uses this to lock down identity and decide whether the maintainer maps to an existing company.
                </p>
              </div>

              {harnessError && (
                <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/60 rounded px-3 py-2">
                  {harnessError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={resetHarness} disabled={harnessBusy}
                className="text-xs px-3 py-2 bg-nord-800 hover:bg-nord-700 text-nord-300 rounded disabled:opacity-40">
                Cancel
              </button>
              <button onClick={submitHarness} disabled={harnessBusy}
                className="text-xs px-3 py-2 bg-frost-600 hover:bg-frost-500 text-white rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                {harnessBusy ? 'Adding harness…' : 'Add harness'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky save pill — appears only when there are unsaved local changes */}
      {verifications.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-2.5 bg-nord-900 border border-frost-700/60 rounded-full shadow-lg shadow-black/40 text-xs">
          <span className="text-nord-300">
            <strong className="text-amber-300">{verifications.length}</strong> unsaved {verifications.length === 1 ? 'change' : 'changes'}
          </span>
          <button onClick={handleApply}
            className="px-3 py-1 bg-frost-600 hover:bg-frost-500 text-white rounded-full font-medium transition-colors">
            Save
          </button>
          <button onClick={handleReset}
            className="text-nord-500 hover:text-nord-300 transition-colors">
            Discard
          </button>
          {applyStatus && (
            <span className={`${applyStatus.startsWith('✓') ? 'text-frost-400' : applyStatus.startsWith('✗') ? 'text-red-400' : 'text-nord-400'}`}>
              {applyStatus}
            </span>
          )}
        </div>
      )}
    </div>
  );
}