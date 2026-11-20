/**
 * Does a build hold its models for its team? Arithmetic on sourced values
 * only: the method and every source it rests on are in src/data/sizing.json,
 * and nothing here adds a number of its own. What the arithmetic cannot
 * answer (a part's memory not yet researched, a model whose KV cache no
 * cited formula covers, a runtime with no published memory rule) comes back
 * as a reason, never as a guess.
 *
 * Units: decimal GB throughout, as Hugging Face file sizes are. Makers' "GB"
 * of VRAM is usually GiB, so reading it as GB understates memory slightly —
 * the safe direction.
 */
import sizing from '../data/sizing.json';
import { type Entity, factNum, factStr, factValue, isHiddenEntity, loadEntity } from './facts';

export interface PartRow { part: Entity | null; slug: string; quantity: number }

export interface ModelFit {
  model: Entity | null;
  slug: string;
  weights: string;
  weightsGb: number | null;
  kvBytesPerToken: number | null;
  /** Memory one session at the build's context holds, GB. */
  sessionGb: number | null;
  /** Weights plus every concurrent session, GB. */
  neededGb: number | null;
  /** How many sessions at the build's context fit beside the weights. */
  maxSessions: number | null;
  status: 'fits' | 'short' | 'unknown';
  reasons: string[];
}

export interface BuildFit {
  parts: PartRow[];
  runtime: string | null;
  totalMemoryGb: number | null;
  /** GPU memory alone, where a system's coherent memory is larger. */
  gpuMemoryGb: number | null;
  usableGb: number | null;
  usableRule: string;
  sessions: number | null;
  contextTokens: number | null;
  models: ModelFit[];
  /** Why usable memory could not be worked out, if it could not. */
  reasons: string[];
}

type Runtime = 'vllm' | 'llama.cpp' | 'mlx';
const RUNTIMES = sizing.runtimes as Record<Runtime, { rule: string; usable_fraction?: number; margin_gib_per_device?: number }>;
const GIB = 1024 ** 3 / 1e9;

interface QuantRow { name: string; size_gb: number | null }

/** Size on disk of a model's weights variant: "native", or a quantization name. */
export function weightsSize(model: Entity, weights: string): number | null {
  if (weights === 'native') return factNum(model, 'native_size_gb');
  for (const key of ['quantizations_unsloth', 'quantizations_bartowski']) {
    const row = (factValue<QuantRow[]>(model, key) ?? []).find(r => r.name === weights);
    if (row && typeof row.size_gb === 'number') return row.size_gb;
  }
  return null;
}

export function buildParts(build: Entity): PartRow[] {
  return (factValue<{ part: string; quantity: number }[]>(build, 'parts') ?? [])
    .map(r => ({ slug: r.part, quantity: r.quantity, part: loadEntity('part', r.part) }));
}

export function fitBuild(build: Entity): BuildFit {
  const parts = buildParts(build);
  const runtime = factStr(build, 'runtime');
  const sessions = factNum(build, 'concurrent_sessions');
  const contextTokens = factNum(build, 'context_per_session');
  const reasons: string[] = [];

  // Memory, added up across the parts that hold the model.
  let total: number | null = parts.length ? 0 : null;
  let gpu: number | null = parts.length ? 0 : null;
  let devices = 0;
  let apple = false;
  for (const { part, slug, quantity } of parts) {
    const mem = part ? factNum(part, 'memory_gb') : null;
    if (!part) reasons.push(`part ${slug} is not in the data`);
    else if (mem === null) reasons.push(`${part.name}: memory not yet researched`);
    total = total !== null && mem !== null ? total + quantity * mem : null;
    const g = part ? factNum(part, 'gpu_memory_gb') ?? mem : null;
    gpu = gpu !== null && g !== null ? gpu + quantity * g : null;
    devices += quantity * ((part && factNum(part, 'gpu_count')) ?? 1);
    if (part && factStr(part, 'maker') === 'Apple') apple = true;
  }
  if (!parts.length) reasons.push('no parts listed');

  // What the runtime leaves usable, by its sourced rule.
  let usable: number | null = null;
  let usableRule = '';
  const rule = runtime && runtime in RUNTIMES ? RUNTIMES[runtime as Runtime] : null;
  if (!runtime) reasons.push('no runtime set');
  else if (!rule) reasons.push(`no sizing rule for runtime ${runtime}`);
  else {
    usableRule = rule.rule;
    if (apple) {
      usableRule = sizing.apple_unified_memory.rule;
      reasons.push('macOS does not publish how much unified memory the GPU may use');
    } else if (total !== null && typeof rule.usable_fraction === 'number') {
      usable = total * rule.usable_fraction;
    } else if (total !== null && typeof rule.margin_gib_per_device === 'number') {
      usable = total - devices * rule.margin_gib_per_device * GIB;
    } else if (total !== null) {
      reasons.push(`${runtime} has no published memory rule`);
    }
  }

  // A model Luke has hidden is off the site, so it drops out of the build
  // rather than showing as missing.
  const models = (factValue<{ model: string; weights: string }[]>(build, 'models') ?? [])
    .filter(row => !isHiddenEntity('model', row.model))
    .map(row => {
    const model = loadEntity('model', row.model);
    const why: string[] = [];
    const weightsGb = model ? weightsSize(model, row.weights) : null;
    const kv = model ? factNum(model, 'kv_cache_bytes_per_token') : null;
    if (!model) why.push(`model ${row.model} is not in the data`);
    else {
      if (weightsGb === null) why.push(`no size on record for ${row.weights} weights`);
      if (kv === null) why.push('its attention design is not covered by a cited KV cache formula; measure on deployment');
    }
    if (contextTokens === null) why.push('context per session not set');
    if (sessions === null) why.push('concurrent sessions not set');

    const sessionGb = kv !== null && contextTokens !== null ? (kv * contextTokens) / 1e9 : null;
    const neededGb = weightsGb !== null && sessionGb !== null && sessions !== null ? weightsGb + sessions * sessionGb : null;
    const maxSessions = usable !== null && weightsGb !== null && sessionGb ? Math.max(0, Math.floor((usable - weightsGb) / sessionGb)) : null;
    const status: ModelFit['status'] = neededGb !== null && usable !== null ? (neededGb <= usable ? 'fits' : 'short') : 'unknown';
    return { model, slug: row.model, weights: row.weights, weightsGb, kvBytesPerToken: kv, sessionGb, neededGb, maxSessions, status, reasons: why };
  });

  return {
    parts, runtime,
    totalMemoryGb: total,
    gpuMemoryGb: gpu !== null && total !== null && gpu < total ? gpu : null,
    usableGb: usable,
    usableRule,
    sessions, contextTokens, models, reasons,
  };
}

export interface SizingSource { id: string; title: string; publisher: string; url: string; quotes: string[]; used_for: string; fetched: string | null; snapshot_hash: string | null }

/** The sources behind a rule, in the order sizing.json lists them. */
export function sourcesFor(ids: string[]): SizingSource[] {
  return (sizing.sources as SizingSource[]).filter(s => ids.includes(s.id));
}

export const SIZING = sizing;
