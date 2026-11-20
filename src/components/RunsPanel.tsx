import React, { useCallback, useEffect, useState } from 'react';
import TrashButton from './TrashButton';

/** The runs panel of the admin dashboard: what is queued for Neuman's next
 *  run, every run of the Neuman task with where it stands, the checker's
 *  verdicts, and the review queue. Talks to the admin server's /runs
 *  endpoints (scripts/admin-server.mjs). */

const ADMIN_ORIGIN = 'http://localhost:4322';

interface NeumanSummary {
  status: string;
  step: string | null;
  error: string | null;
  cost_usd: number | null;
}

interface RunSummary {
  id: string;
  kind: 'onboard' | 'refresh' | 'sweep' | null;
  entity: string | null;
  title: string;
  created: string;
  status: 'running' | 'claimed' | 'review' | 'done' | 'failed';
  pending: number;
  checked: string | null;
  neuman: NeumanSummary | null;
}

interface QueuedRequest {
  id: string;
  kind: 'onboard' | 'refresh';
  entity: string;
  title: string;
  created: string;
}

interface StepRecord {
  name: string;
  kind: 'run' | 'agent';
  status: string;
  error?: string | null;
  /** A command step's own words: the end of its stdout, then of its stderr.
   *  Its `error` is only the exit. */
  output?: string | null;
  cost_usd?: number | null;
}

interface Claim {
  entity?: string;
  key?: string;
  value?: unknown;
  source?: string;
  quote?: string;
  note?: string;
  na?: boolean;
}

interface ResultRow {
  index: number;
  claim: Claim;
  outcome: 'applied' | 'review' | 'rejected';
  reason: string;
  note?: string;
  current?: { value: unknown; verified_by: string | null };
  snapshot_hash?: string;
  snapshot_ext?: string;
  decision?: { action: 'accept' | 'reject'; at: string };
}

interface RunDetail {
  run: RunSummary | null;
  neuman: { status: string; steps: StepRecord[]; cost_usd: number | null; tokens: number | null } | null;
  brief: string | null;
  report: string | null;
  claims: Claim[] | null;
  claims_error: string | null;
  result: { checked: string; claims: ResultRow[] } | null;
}

const STATUS_STYLE: Record<RunSummary['status'], string> = {
  running: 'bg-nord-800 text-nord-300',
  claimed: 'bg-sky-900/60 text-sky-200',
  review: 'bg-amber-900/50 text-amber-200',
  done: 'bg-frost-900/50 text-frost-300',
  failed: 'bg-red-950/60 text-red-300',
};
const STATUS_LABEL: Record<RunSummary['status'], string> = {
  running: 'running',
  claimed: 'claims not checked',
  review: 'needs review',
  done: 'done',
  failed: 'failed',
};
const STEP_STYLE: Record<string, string> = {
  succeeded: 'text-frost-400',
  running: 'text-sky-300',
  budget: 'text-amber-300',
  failed: 'text-red-400',
  cancelled: 'text-red-400',
  skipped: 'text-nord-500',
  pending: 'text-nord-500',
};
// Neuman's task view says these, not the contract's names, so the two
// windows describe a step the same way.
const STEP_LABEL: Record<string, string> = {
  succeeded: 'done',
  budget: 'stopped early',
  cancelled: 'stopped',
  pending: 'waiting',
};
const OUTCOME_STYLE: Record<ResultRow['outcome'], string> = {
  applied: 'text-frost-400',
  review: 'text-amber-300',
  rejected: 'text-red-400',
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ADMIN_ORIGIN}${path}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `${path} failed`);
  return data as T;
}

function money(v: number | null | undefined): string | null {
  return v === null || v === undefined ? null : `$${v.toFixed(v < 0.01 ? 4 : 2)}`;
}

function show(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `${v.length} rows`;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function RunBody({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showBrief, setShowBrief] = useState(false);

  const load = useCallback(() => {
    call<RunDetail>(`/runs/${id}`).then(setDetail, e => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); load(); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (!detail) return <p className="text-xs text-nord-500 px-3 py-2">{error ?? 'Loading…'}</p>;
  const rows = detail.result?.claims ?? [];

  return (
    <div className="px-3 pb-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          disabled={busy || !detail.claims}
          onClick={() => act(() => call(`/runs/${id}/check`, {}))}
          className="text-xs px-2.5 py-1 rounded border border-sky-700 bg-sky-900/50 text-sky-200 hover:bg-sky-800/60 disabled:opacity-40">
          {detail.result ? 'Re-check' : 'Check claims'}
        </button>
        {detail.brief && (
          <button onClick={() => setShowBrief(!showBrief)} className="text-xs text-nord-400 hover:text-nord-200">
            {showBrief ? 'Hide brief' : 'Show brief'}
          </button>
        )}
        {!detail.claims && !detail.claims_error && <span className="text-xs text-nord-500">No claims — the research step writes {id}/claims.json.</span>}
        {detail.result && <span className="text-xs text-nord-500">Checked {new Date(detail.result.checked).toLocaleString()} — reload the page to see the facts it changed.</span>}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {detail.neuman && (
        <ol className="text-xs space-y-0.5">
          {detail.neuman.steps.map(step => (
            <li key={step.name}>
              <div className="flex items-baseline gap-2">
                <span className={`font-mono text-[10px] uppercase w-24 ${STEP_STYLE[step.status] ?? 'text-nord-400'}`}>{STEP_LABEL[step.status] ?? step.status}</span>
                <span className="text-nord-300">{step.name}</span>
                {money(step.cost_usd) && <span className="text-nord-500">{money(step.cost_usd)}</span>}
                {step.error && <span className="text-red-400/80 truncate">{step.error}</span>}
              </div>
              {step.output && (
                <details open={step.status === 'failed'} className="ml-[6.5rem] mt-1">
                  <summary className="cursor-pointer text-nord-500">output</summary>
                  <pre className="mt-1 text-[11px] text-nord-400 bg-nord-950 border border-nord-800 rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap">{step.output}</pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
      {detail.claims_error && <p className="text-xs text-red-400">{detail.claims_error}</p>}
      {showBrief && <pre className="text-[11px] text-nord-400 bg-nord-950 border border-nord-800 rounded p-3 max-h-96 overflow-auto whitespace-pre-wrap">{detail.brief}</pre>}
      {detail.report && (
        <details className="text-xs">
          <summary className="cursor-pointer text-nord-400">Neuman's report</summary>
          <pre className="mt-2 text-[11px] text-nord-300 bg-nord-950 border border-nord-800 rounded p-3 max-h-96 overflow-auto whitespace-pre-wrap">{detail.report}</pre>
        </details>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-nord-800 border border-nord-800 rounded">
          {rows.map(row => (
            <li key={row.index} className="px-3 py-2 text-xs space-y-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className={`font-mono uppercase text-[10px] ${OUTCOME_STYLE[row.outcome] ?? 'text-nord-400'}`}>{row.outcome}</span>
                <span className="text-nord-300 font-mono">{row.claim.entity} · {row.claim.key}</span>
                <span className="text-nord-100">= {row.claim.na ? 'N/A' : show(row.claim.value)}</span>
                {row.current && <span className="text-nord-500">(was {show(row.current.value)}{row.current.verified_by ? `, ${row.current.verified_by}` : ''})</span>}
              </div>
              <p className="text-nord-400">{row.reason}{row.note ? ` — ${row.note}` : ''}{row.claim.note ? ` · Neuman: ${row.claim.note}` : ''}</p>
              {row.claim.quote && <p className="text-nord-500 italic">“{row.claim.quote}”</p>}
              <div className="flex items-center gap-3">
                {row.claim.source && <a href={row.claim.source} target="_blank" rel="noopener noreferrer" className="text-sky-400/80 hover:text-sky-300 truncate max-w-md">{row.claim.source}</a>}
                {row.snapshot_hash && (
                  <a href={`${ADMIN_ORIGIN}/snapshot/${row.snapshot_hash}.${row.snapshot_ext ?? 'html'}`} target="_blank" rel="noopener noreferrer"
                    title="What the checker fetched" className="text-nord-500 hover:text-frost-400">📎 receipt</a>
                )}
                {row.outcome === 'review' && !row.decision && (
                  <span className="ml-auto flex gap-2">
                    <button disabled={busy} onClick={() => act(() => call(`/runs/${id}/review`, { index: row.index, action: 'accept' }))}
                      className="px-2 py-0.5 rounded border border-frost-700 bg-frost-900/40 text-frost-200 hover:bg-frost-800/60 disabled:opacity-40">Accept</button>
                    <button disabled={busy} onClick={() => act(() => call(`/runs/${id}/review`, { index: row.index, action: 'reject' }))}
                      className="px-2 py-0.5 rounded border border-nord-700 text-nord-300 hover:bg-nord-800 disabled:opacity-40">Reject</button>
                  </span>
                )}
                {row.decision && <span className="ml-auto text-nord-500">{row.decision.action}ed</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function RunsPanel({ version }: { version: number }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [queue, setQueue] = useState<QueuedRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(() => {
    call<{ runs: RunSummary[]; queue: QueuedRequest[] }>('/runs').then(
      d => { setRuns(d.runs); setQueue(d.queue); setError(null); },
      e => setError(e.message),
    );
  }, []);
  useEffect(load, [load, version]);

  const reviewCount = runs.filter(r => r.status === 'review').length;

  const remove = async (what: string, path: string, body: unknown) => {
    if (!confirm(`Delete ${what}?`)) return;
    try { await call(path, body); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    load();
  };

  return (
    <div className="border border-nord-800 rounded-lg overflow-hidden">
      {/* Collapsed by default; the header keeps what needs attention in view. */}
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-nord-900 hover:bg-nord-800/80 text-left">
        <h2 className="text-base font-semibold text-nord-100">Recent update runs</h2>
        <span className="text-xs text-nord-500">
          {[
            queue.length > 0 ? `${queue.length} waiting` : null,
            reviewCount > 0 ? `${reviewCount} need${reviewCount === 1 ? 's' : ''} review` : null,
          ].filter(Boolean).join(' · ')}
        </span>
        <span className="ml-auto text-nord-500 text-sm px-2">{expanded ? '▲' : '▼'}</span>
      </button>
      {error && <p className="px-4 py-2 text-xs text-red-400">Admin server: {error}</p>}
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
      <div className="overflow-hidden min-h-0">
      <div className="px-4 py-2.5 border-b border-nord-800 bg-nord-900/40">
        <p className="text-xs text-nord-400 mb-1">
          Waiting for Neuman{queue.length > 0 ? ` (${queue.length}) — each Run now takes the first, or sweeps if none is waiting:` : ''}
        </p>
        {queue.length === 0
          ? <p className="text-xs text-nord-500">Nothing waiting. Run now will sweep.</p>
          : (
            <ol className="text-xs text-nord-300 space-y-0.5">
              {queue.map((request, i) => (
                <li key={request.id} className="flex items-center gap-2">
                  <span className="text-nord-600 w-4 text-right tabular-nums">{i + 1}.</span>
                  <span className="truncate">{request.title}</span>
                  <span className="text-[10px] text-nord-600">{new Date(request.created).toLocaleString()}</span>
                  <span className="ml-auto">
                    <TrashButton title={`Cancel ${request.title}`}
                      onClick={() => remove(`waiting request "${request.title}"`, '/dequeue', { id: request.id })} />
                  </span>
                </li>
              ))}
            </ol>
          )}
      </div>
      {runs.length === 0 && !error && <p className="px-4 py-3 text-xs text-nord-500">No runs yet. Onboard an entity, request an update, or press Run now to sweep.</p>}
      <ul className="divide-y divide-nord-800">
        {runs.map(run => (
          <li key={run.id} className="bg-nord-950/50">
            <div className="flex items-center gap-3 px-4 py-2.5">
              <button onClick={() => setOpen(open === run.id ? null : run.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                <span className="text-nord-500 text-xs w-3">{open === run.id ? '▾' : '▸'}</span>
                <span className="text-sm text-nord-200 truncate">{run.title}</span>
                <span className="text-[10px] font-mono text-nord-600 truncate">{run.id}</span>
              </button>
              {money(run.neuman?.cost_usd) && <span className="text-[10px] text-nord-500">{money(run.neuman?.cost_usd)}</span>}
              <span title={run.neuman?.error ?? undefined} className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLE[run.status]}`}>
                {STATUS_LABEL[run.status]}
                {run.status === 'review' ? ` · ${run.pending}` : ''}
                {(run.status === 'running' || run.status === 'failed') && run.neuman?.step ? ` · ${run.neuman.step}` : ''}
              </span>
              {run.status !== 'running' && (
                <TrashButton title="Delete this run's directory — facts it changed stay"
                  onClick={() => remove(`run "${run.title}" (${run.id})`, `/runs/${run.id}/delete`, {})} />
              )}
            </div>
            {open === run.id && <RunBody id={run.id} onChanged={load} />}
          </li>
        ))}
      </ul>
      </div>
      </div>
    </div>
  );
}
