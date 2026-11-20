/**
 * THE source of truth for facts on this site.
 *
 * Adding a fact key here is the only change needed for it to appear in
 * the admin dashboard, flow into entity pages, be offered to Neuman in a
 * run brief, and be judged by the checker. There is no other place to
 * declare a fact.
 *
 * Dotted keys (`benchmark.aa_intelligence_index`, `snapshot.huggingface_card`)
 * are grouped in the dashboard by their prefix — treat prefixes as
 * semantic sections.
 *
 * Consumed by:
 *   - src/pages/admin/index.astro  → renders every key as a card
 *   - src/lib/sizing.ts            → build fit, from build, part and model facts
 *   - src/lib/facts.ts             → generic loader + fact() accessor
 *   - scripts/lib/briefs.mjs       → tells Neuman which keys it may claim
 *   - scripts/check-run.mjs        → decides what a claim needs to publish
 */

export type EntityType = 'model' | 'build' | 'part' | 'company' | 'harness';

/** Fact types.
 *
 * `string`, `number`, `boolean`, `date` — scalars.
 *
 * `list` — array of flat records; `shape.columns` declares the columns
 *   and the dashboard renders a generic table editor. `[]` is a valid
 *   value distinct from `null` (confirmed-absent for lists).
 *
 * `text` — a `string` with a long-form UI hint (full-width textarea in
 *   the dashboard, full-width block on the entity page). Only `my_take`
 *   uses this.
 *
 * `snapshot` — a canonical URL for the entity. The fact's `value` is the
 *   URL string. Whoever writes it (sync, checker, or Luke's Verify click)
 *   fetches the URL, ingests it into the content-addressed archive, and
 *   stamps `snapshot_hash` + `snapshot_ext`. Snapshot facts are declared
 *   per entity type and constitute the *canonical set of captures*
 *   required for that type. */
export interface FactColumnSpec {
  name: string;
  type: 'string' | 'number' | 'boolean';
}
export interface ListShape {
  columns: FactColumnSpec[];
}

/** Who may write a fact. The schema decides this, not a prompt: the
 *  checker refuses an agent claim on any key that is not `agent`.
 *   - `sync`  — a deterministic API sync script (AA, Arena, OpenRouter, HuggingFace, GitHub).
 *               If an API can give us the value, an agent never touches it.
 *   - `agent` — Neuman may propose it as a claim in a run; the checker
 *               decides whether it publishes or waits for review.
 *   - `human` — only Luke, in the dashboard. */
export type FactWriter = 'sync' | 'agent' | 'human';

/** What the checker can confirm about an agent claim on its own.
 *   - `quote`    — the claimed value appears in a quote, and the quote
 *                  appears on the cited page as the checker fetched it.
 *                  Passing claims publish without review.
 *   - `judgment` — identity and classification (is this the right repo,
 *                  is this tier "prosumer"). The checker confirms the
 *                  quote is on the page; a value equal to the current one
 *                  is a confirmation, a new or changed value waits for
 *                  review. */
export type FactEvidence = 'quote' | 'judgment';

export interface FactSchemaEntry {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'list' | 'text' | 'snapshot';
  description: string;
  writer: FactWriter;
  /** Agent facts only. Absent = `quote`. */
  evidence?: FactEvidence;
  /** Agent facts only. Days between scheduled re-checks of this fact.
   *  Absent = no scheduled re-check. `withReviewCadence` gives snapshots and
   *  judgment facts 365 days; a `quote` fact sets it explicitly when its
   *  source can change (see `parent_company`, `install_method`). */
  review_days?: number;
  /** The value is expected to move (prices). A newer checked value
   *  supersedes one Luke signed off, instead of waiting as a conflict. */
  volatile?: boolean;
  /** Largest relative change of a numeric value the checker publishes
   *  without review. Absent = 0.5. A bigger jump is more often a
   *  misread page (wrong SKU, wrong unit) than a real move. */
  max_change?: number;
  /** Required when `type === 'list'`. Declares the columns of each row. */
  shape?: ListShape;
  /** Optional (snapshot only). true = "nice to have if trivially found,
   *  don't waste tool calls hunting." Absent = required (canonical).
   *  Snapshot facts marked optional don't count against roll-up dots. */
  optional?: boolean;
  /** Optional (snapshot only). Human-readable hint about what URL shape
   *  to expect. Doesn't gate anything — just Neuman guidance. */
  url_hint?: string;
  /** Optional. Advertised list of data-fact keys this snapshot is
   *  authoritative for. Purely descriptive — used to render the
   *  "preferred_for" column in run briefs. */
  preferred_for?: string[];
  /** Optional. Declares this fact only applies when other facts on the
   *  entity match. Format: `{ <fact_key>: <expected_value> | <expected_values[]> }`.
   *  All conditions must match (AND). Non-matching → the fact is treated
   *  exactly like N/A: dropped from briefs, dashboard tallies, and pages.
   *  Example: `applies_when: { distribution: 'open' }` on `native_size_gb`
   *  means the fact simply doesn't exist for closed models. */
  applies_when?: Record<string, string | string[]>;
}

/**
 * `my_take` is a hand-authored prose fact appended to every entity type's
 * schema (see `withMyTake` below). It uses the fact-provenance system —
 * verified_by/verified_at gate it exactly like any other fact — and its
 * `human` writer keeps it out of every run brief and refused by the checker.
 * The entity page renders it as a full-width block at the top when non-empty.
 */
const MY_TAKE_FACT: FactSchemaEntry = {
  key: 'my_take',
  type: 'text',
  writer: 'human',
  description: 'Hand-authored prose commentary. Rendered at the top of the entity page. Prose on this site is written by Luke.',
};

/**
 * `hidden` is a display-control fact, curatorial rather than research, for
 * the entity types the admin dashboard can hide. true = the data is kept but
 * the entity appears nowhere on the site (src/lib/facts.ts loaders skip it);
 * null/missing/false = shown. The dashboard renders it as a dedicated
 * checkbox above the fact grid rather than mixed in with data facts.
 */
const HIDDEN_FACT: FactSchemaEntry = {
  key: 'hidden',
  type: 'boolean',
  writer: 'human',
  description: 'Hide this from the site while keeping its data. Null/missing = shown (default). Curatorial toggle — not sourced or verified.',
};

/** Append the universal my_take fact to a per-entity schema list. */
function withMyTake(entries: FactSchemaEntry[]): FactSchemaEntry[] {
  return [...entries, MY_TAKE_FACT];
}

/** The sweep re-checks agent facts on a cadence. An agent snapshot or
 *  judgment fact is reviewed yearly; a `quote` fact opts in explicitly by
 *  setting `review_days`. Facts with neither are checked when the entity is
 *  onboarded and then left alone. */
function withReviewCadence(entries: FactSchemaEntry[]): FactSchemaEntry[] {
  return entries.map(entry => {
    if (entry.writer !== 'agent' || entry.review_days) return entry;
    return entry.type === 'snapshot' || entry.evidence === 'judgment'
      ? { ...entry, review_days: 365 }
      : entry;
  });
}

/* ─────────────────────────── MODEL SCHEMA ─────────────────────────── */

export const MODEL_FACT_SCHEMA: FactSchemaEntry[] = [
  HIDDEN_FACT,

  // Snapshots — the canonical captures for a model.
  {
    key: 'snapshot.huggingface_card',
    type: 'snapshot',
    writer: 'agent', evidence: 'judgment',
    description: 'HuggingFace model card (org/model). Rendered as the canonical HF link on the model page. Everything sync-hf fills hangs off this URL, so it is reviewed.',
    url_hint: 'https://huggingface.co/<org>/<model>',
    preferred_for: [
      'family', 'company_slug', 'license', 'license_commercial',
      'supports_tools', 'supports_vision', 'supports_structured_output',
      'released',
    ],
    applies_when: { distribution: ['open', 'gated'] },
  },
  {
    key: 'snapshot.hf_config',
    type: 'snapshot',
    writer: 'agent', evidence: 'judgment',
    description: 'The raw config.json on the HuggingFace repo. Structured, cheap to parse — authoritative for parameter counts.',
    url_hint: 'https://huggingface.co/<org>/<model>/raw/main/config.json',
    preferred_for: ['parameters_b', 'parameters_active_b'],
    applies_when: { distribution: ['open', 'gated'] },
  },
  {
    key: 'snapshot.unsloth_gguf',
    type: 'snapshot',
    writer: 'sync',
    description: 'Unsloth\'s GGUF repo page. Sole authority for `quantizations_unsloth`. Discovered by sync-hf via search.',
    url_hint: 'https://huggingface.co/unsloth/<model>-GGUF',
    preferred_for: ['quantizations_unsloth'],
    applies_when: { distribution: ['open', 'gated'] },
  },
  {
    key: 'snapshot.bartowski_gguf',
    type: 'snapshot',
    writer: 'sync',
    description: 'bartowski\'s GGUF repo page. Sole authority for `quantizations_bartowski`. Discovered by sync-hf via search.',
    url_hint: 'https://huggingface.co/bartowski/<model>-GGUF',
    preferred_for: ['quantizations_bartowski'],
    applies_when: { distribution: ['open', 'gated'] },
  },
  {
    key: 'snapshot.github',
    type: 'snapshot',
    writer: 'agent', evidence: 'judgment',
    description: 'Official GitHub repo for the model or model family. Many open-weight models release on HF only; mark N/A if genuinely absent.',
    url_hint: 'https://github.com/<org>/<repo>',
    preferred_for: [],
    optional: true,
  },
  {
    key: 'snapshot.official_announcement',
    type: 'snapshot',
    writer: 'agent', evidence: 'judgment',
    description: 'Official public release announcement from the model developer (their own site — a press release, product page, or announcement post). Not third-party coverage. Often the exact release date and headline capabilities live here.',
    preferred_for: ['released'],
  },

  // Data facts — extracted from the snapshots above, or from another
  // reputable page the agent cites.
  { key: 'family', type: 'string', writer: 'agent', evidence: 'judgment', description: 'Model family (e.g. "DeepSeek V4 Flash")' },
  { key: 'company_slug', type: 'string', writer: 'agent', evidence: 'judgment', description: 'Slug of the developing company (matches src/data/companies/<slug>.json)' },
  { key: 'distribution', type: 'string', writer: 'agent', evidence: 'judgment', description: 'open (weights downloadable), closed (API-only), or gated (weights available with acceptable-use restrictions)' },
  { key: 'released', type: 'date', writer: 'agent', description: 'Release date (YYYY-MM-DD)' },
  { key: 'parameters_b', type: 'number', writer: 'agent', description: 'Total parameters (billions)',
    applies_when: { distribution: ['open', 'gated'] } },
  { key: 'parameters_active_b', type: 'number', writer: 'agent',
    description: 'Active parameters per token (billions). Equals parameters_b for dense models.',
    applies_when: { distribution: ['open', 'gated'] } },
  { key: 'native_size_gb', type: 'number', writer: 'sync',
    description: 'Total size of native-precision weights on disk (decimal GB). Sum of the release\'s .safetensors files from HuggingFace, ÷1e9. The memory floor for vLLM/SGLang/TGI deployments before any KV cache (see kv_cache_bytes_per_token). For MoE models this is total (all experts must sit in memory), not active.',
    applies_when: { distribution: ['open', 'gated'] } },
  { key: 'kv_cache_bytes_per_token', type: 'number', writer: 'sync',
    description: 'KV cache per token of context, in bytes at 16-bit, for the layers whose cache grows with context. Computed by sync-hf from config.json with the formulas cited in src/data/sizing.json: 2 × kv_heads × head_dim per layer for standard and grouped-query attention (NVIDIA), (kv_lora_rank + qk_rope_head_dim) per layer for latent attention (DeepSeek-V2, Table 1). Linear-attention layers keep a fixed state per session and are not counted. Null when the config uses an attention design neither formula covers.',
    applies_when: { distribution: ['open', 'gated'] } },
  { key: 'architecture.type', type: 'string', writer: 'sync', description: 'dense or moe' },
  { key: 'architecture.experts', type: 'number', writer: 'sync',
    description: 'Number of experts (MoE only; null for dense)',
    applies_when: { distribution: ['open', 'gated'] } },
  { key: 'license', type: 'string', writer: 'agent', evidence: 'judgment', description: 'License name (MIT, Apache-2.0, etc.)',
    applies_when: { distribution: ['open', 'gated'] } },
  { key: 'license_commercial', type: 'boolean', writer: 'agent', evidence: 'judgment', description: 'Commercial use permitted',
    applies_when: { distribution: ['open', 'gated'] } },
  { key: 'context_length', type: 'number', writer: 'sync', description: 'Max context window in tokens' },
  { key: 'supports_tools', type: 'boolean', writer: 'agent', evidence: 'judgment', description: 'Native tool calling' },
  { key: 'supports_vision', type: 'boolean', writer: 'agent', evidence: 'judgment', description: 'Vision input' },
  { key: 'supports_structured_output', type: 'boolean', writer: 'agent', evidence: 'judgment', description: 'Structured / JSON output' },
  { key: 'quantizations_unsloth', type: 'list', writer: 'sync',
    shape: { columns: [{ name: 'name', type: 'string' }, { name: 'size_gb', type: 'number' }] },
    description: 'GGUF quantizations published by Unsloth. Each row is a single quant variant. Extracted from the `snapshot.unsloth_gguf` capture. Empty list = "confirmed no quants."',
    applies_when: { distribution: ['open', 'gated'] } },
  { key: 'quantizations_bartowski', type: 'list', writer: 'sync',
    shape: { columns: [{ name: 'name', type: 'string' }, { name: 'size_gb', type: 'number' }] },
    description: 'GGUF quantizations published by bartowski. Same shape and rules as quantizations_unsloth.',
    applies_when: { distribution: ['open', 'gated'] } },

  // AA join key. Identity, so a judgment: a wrong aa_id silently attaches
  // another model's benchmarks. Absent/null = model not tracked by AA.
  { key: 'aa_id', type: 'string', writer: 'agent', evidence: 'judgment',
    description: 'Artificial Analysis stable model UUID (`id` in GET /api/v2/language/models/free). Set once; sync-aa joins on it. Null/absent = model not tracked by AA (benchmarks/pricing/speed stay null).' },

  // Arena join key. Arena has no ids; `model_name` is what its dataset
  // keys rows by. Same rule as aa_id: a wrong name attaches another
  // model's rating, so it is a judgment.
  { key: 'arena_name', type: 'string', writer: 'agent', evidence: 'judgment',
    description: 'Arena leaderboard `model_name` (e.g. "GLM-5.3 (Max)") in the lmarena-ai/leaderboard-dataset Hugging Face dataset. sync-arena joins on it. Null = Arena does not rank this exact model.' },

  // OpenRouter join key, for closed models only: an open model is joined
  // by its Hugging Face repo, which OpenRouter lists, so it needs no
  // judgment. Same rule as aa_id otherwise.
  { key: 'openrouter_id', type: 'string', writer: 'agent', evidence: 'judgment',
    description: 'OpenRouter model id (e.g. "anthropic/claude-opus-5", `id` in GET https://openrouter.ai/api/v1/models), without a ":batch"-style suffix. sync-openrouter joins on it. Null = OpenRouter does not serve this model.',
    applies_when: { distribution: ['closed'] } },

  // Benchmarks — AA's headline composite, the one index its Free API fills.
  // The index version is recorded in src/data/aa-snapshot.json; a version
  // bump rescales every model at once, which is why AA nulls a model it
  // has not re-run rather than mixing scales.
  { key: 'benchmark.aa_intelligence_index', type: 'number', writer: 'sync', description: 'Artificial Analysis Intelligence Index — headline composite (0–100).' },

  // Arena's human-preference ratings, one per category, from the leaderboard
  // sync-arena reads (scripts/lib/arena.mjs maps each category to its key).
  { key: 'benchmark.arena_text_coding', type: 'number', writer: 'sync', description: 'Arena Text leaderboard, Coding category, style-controlled: an Elo-style rating from blind pairwise human votes on coding prompts.' },
  { key: 'benchmark.arena_text_legal', type: 'number', writer: 'sync', description: 'Arena Text leaderboard, Legal & Government category, style-controlled: an Elo-style rating from blind pairwise human votes on legal and government prompts.' },
  { key: 'benchmark.arena_text_science', type: 'number', writer: 'sync', description: 'Arena Text leaderboard, Life, Physical & Social Science category, style-controlled: an Elo-style rating from blind pairwise human votes on scientific prompts.' },

  // Pricing — USD per million tokens, across the providers OpenRouter
  // routes to (sync-openrouter). Medians, so one cut-price or premium host
  // does not set the number; the cheapest is kept beside them.
  { key: 'pricing.input_per_m_usd', type: 'number', writer: 'sync', description: 'Input token price, USD per 1M tokens: the median across OpenRouter providers.' },
  { key: 'pricing.cached_input_per_m_usd', type: 'number', writer: 'sync', description: 'Cached (cache-hit) input token price, USD per 1M tokens: the median across the providers that offer caching. What an agent re-sending a long context actually pays.' },
  { key: 'pricing.output_per_m_usd', type: 'number', writer: 'sync', description: 'Output token price, USD per 1M tokens: the median across OpenRouter providers.' },
  { key: 'pricing.blended_per_m_usd', type: 'number', writer: 'sync', description: 'Blended price at a 3:1 input:output ratio, USD per 1M tokens — (3 × input + output) ÷ 4 for each provider, then the median.' },
  { key: 'pricing.blended_min_per_m_usd', type: 'number', writer: 'sync', description: 'The cheapest provider\'s blended price, USD per 1M tokens.' },
  { key: 'providers', type: 'list', writer: 'sync',
    shape: { columns: [
      { name: 'provider', type: 'string' }, { name: 'quantization', type: 'string' },
      { name: 'input', type: 'number' }, { name: 'output', type: 'number' }, { name: 'cached_input', type: 'number' },
      { name: 'context_length', type: 'number' },
    ] },
    description: 'Every provider OpenRouter routes this model to, cheapest blended first: the weight precision it serves (fp4/fp8/bf16, or unknown), its prices per 1M tokens, and its context window. Live speed and uptime are left out — they change every read and are not facts.' },

  // Speed — measured medians from AA (sync-aa).
  { key: 'speed.output_tokens_per_second', type: 'number', writer: 'sync', description: 'Median output generation speed (tokens/second).' },
  { key: 'speed.time_to_first_token_seconds', type: 'number', writer: 'sync', description: 'Median time to first token (seconds).' },
];

/* ──────────────────────────── PART SCHEMA ──────────────────────────── */

/** A part is something a build is made of and that holds the model: a GPU
 *  card, or a whole system bought as one (DGX Station, Mac Studio, an HGX
 *  server). Each part has a page (/parts/<slug>), reached from the builds
 *  it is in; parts are not listed anywhere on their own. `class` gates the
 *  class-specific facts:
 *   - `gpu`    — an add-in card. VRAM, board power, slot width.
 *   - `system` — a complete machine. Its memory, GPU count, power, where it goes. */
export const PART_FACT_SCHEMA: FactSchemaEntry[] = [
  // Snapshots
  {
    key: 'snapshot.maker',
    type: 'snapshot',
    writer: 'agent', evidence: 'judgment',
    description: 'The maker\'s official product page or datasheet PDF. Highest authority for headline specs.',
    url_hint: 'e.g. https://www.nvidia.com/en-us/products/workstations/dgx-station/',
    preferred_for: ['maker', 'memory_gb', 'gpu_memory_gb', 'memory_bandwidth_gbps', 'gpu_count', 'power_w', 'form_factor', 'released'],
  },
  {
    key: 'snapshot.techpowerup',
    type: 'snapshot',
    writer: 'agent', evidence: 'judgment',
    description: 'TechPowerUp GPU database page. Fastest single spec source; cross-check against maker for numeric disagreements. Cards only.',
    url_hint: 'https://www.techpowerup.com/gpu-specs/<slug>.c<id>',
    preferred_for: ['memory_bandwidth_gbps', 'bf16_tflops'],
    applies_when: { class: 'gpu' },
  },
  {
    key: 'snapshot.wikipedia',
    type: 'snapshot',
    writer: 'agent', evidence: 'judgment',
    description: 'Wikipedia article for the card, system, or its generation.',
    preferred_for: [],
    optional: true,
  },

  // ── Every part ────────────────────────────────────────────────────────
  { key: 'class', type: 'string', writer: 'agent', evidence: 'judgment', description: 'Part class. Fixed enum: gpu (an add-in card) | system (a complete machine bought as one, e.g. DGX Station, Mac Studio, an HGX server). Adding a value is a schema change.' },
  { key: 'maker', type: 'string', writer: 'agent', evidence: 'judgment', description: 'Company that designed the part (NVIDIA, AMD, Apple). Not the fab (TSMC) and not a board partner or reseller (ASUS, Dell).' },
  { key: 'released', type: 'date', writer: 'agent', description: 'Release date' },

  // A price is one observed listing, not an estimate: the cited page is
  // the listing and the quote carries the price, so the checker can
  // confirm it. Checked weekly.
  { key: 'price.new_usd', type: 'number', writer: 'agent', volatile: true, max_change: 0.35,
    description: 'Lowest in-stock price for a new unit, USD: a major retailer for cards (maker store, Best Buy, Newegg, B&H, Micro Center, Amazon sold by Amazon), the maker or an authorized reseller for systems. The cited page is the listing. Null with a note when it is sold only on quote or no longer sold new.' },
  { key: 'price.swept', type: 'boolean', writer: 'human',
    description: 'Whether the weekly sweep re-checks this part\'s price. False when no listing the checker can read exists; absent = swept.' },

  { key: 'memory_gb', type: 'number', writer: 'agent',
    description: 'Memory a model can be loaded into, in GB: a card\'s VRAM; a Mac\'s unified memory; a Grace system\'s coherent memory (GPU HBM plus the CPU memory the GPU addresses over NVLink-C2C); an HGX server\'s total GPU memory. Builds size models against this.' },
  { key: 'memory_bandwidth_gbps', type: 'number', writer: 'agent', description: 'Memory bandwidth of the memory the GPU computes from (GB/s): VRAM, HBM, or unified memory.' },
  { key: 'power_w', type: 'number', writer: 'agent', description: 'Maximum power draw in watts: a card\'s total board power, or a system\'s total system power.' },
  { key: 'bf16_tflops', type: 'number', writer: 'agent', description: 'Dense BF16 TFLOPS (without sparsity), for the whole part.' },

  // ── Cards ─────────────────────────────────────────────────────────────
  { key: 'form_factor', type: 'string', writer: 'agent', evidence: 'judgment', description: 'dual-slot, triple-slot, pcie-passive, etc.',
    applies_when: { class: 'gpu' } },

  // ── Systems ───────────────────────────────────────────────────────────
  { key: 'gpu_memory_gb', type: 'number', writer: 'agent',
    description: 'GPU memory (HBM or GDDR) alone, in GB, where it differs from memory_gb: a Grace system\'s HBM without the CPU memory. Null for systems whose GPU memory is all of memory_gb.',
    applies_when: { class: 'system' } },
  { key: 'gpu_count', type: 'number', writer: 'agent', description: 'Number of GPUs in the system.',
    applies_when: { class: 'system' } },
  { key: 'placement', type: 'string', writer: 'agent', evidence: 'judgment',
    description: 'Where it goes. Fixed enum: desk (on a desk) | deskside (floor beside a desk, office power) | rack (a server rack, data-center power and cooling).',
    applies_when: { class: 'system' } },
];

/* ──────────────────────────── BUILD SCHEMA ─────────────────────────── */

/** A build is a complete machine we build and set up for a team, sized for
 *  the models it runs. Every build fact is Luke's: what goes in it, who it
 *  is for and what it runs are recommendations, not research. Its specs
 *  come from its parts and its fit from src/lib/sizing.ts, whose method
 *  and sources are in src/data/sizing.json. */
export const BUILD_FACT_SCHEMA: FactSchemaEntry[] = [
  HIDDEN_FACT,
  { key: 'kind', type: 'string', writer: 'human',
    description: 'custom (we source the parts and assemble it) or system (bought outright as one product, e.g. DGX Station).' },
  { key: 'runtime', type: 'string', writer: 'human',
    description: 'The inference server the build runs its models on. Fixed enum: vllm | llama.cpp | mlx. Decides which usable-memory rule in src/data/sizing.json applies.' },
  { key: 'parts', type: 'list', writer: 'human',
    shape: { columns: [{ name: 'part', type: 'string' }, { name: 'quantity', type: 'number' }] },
    description: 'The parts that hold the model, each a slug in src/data/parts/ with how many. Memory and power add up across these rows.' },
  { key: 'components', type: 'list', writer: 'human',
    shape: { columns: [{ name: 'name', type: 'string' }, { name: 'quantity', type: 'number' }] },
    description: 'The rest of a custom build (CPU, board, RAM, power supply, case), named as we would spec them. Not tracked as parts.',
    applies_when: { kind: 'custom' } },
  { key: 'models', type: 'list', writer: 'human',
    shape: { columns: [{ name: 'model', type: 'string' }, { name: 'weights', type: 'string' }] },
    description: 'The models the build is set up to run, first is the main one. model = a slug in src/data/models/; weights = "native" or the name of a quantization in that model\'s quantization lists.' },
  { key: 'team_min', type: 'number', writer: 'human', description: 'Smallest team the build is for (people).' },
  { key: 'team_max', type: 'number', writer: 'human', description: 'Largest team the build is for (people).' },
  { key: 'concurrent_sessions', type: 'number', writer: 'human',
    description: 'Neuman sessions the build is sized to hold at once, for that team. A customer requirement, not a literature value; sizing checks the memory it needs.' },
  { key: 'context_per_session', type: 'number', writer: 'human',
    description: 'Tokens of context each session is sized for (e.g. 65536).' },
  { key: 'price_range', type: 'string', writer: 'human',
    description: 'What a custom build costs, as Luke states it, saying what the range covers (e.g. "$9,300–12,300 in parts" or "$12–16k installed"). Set by Luke, never computed from part prices. A system build shows its part\'s tracked price instead.',
    applies_when: { kind: 'custom' } },
  { key: 'photo_credit', type: 'string', writer: 'human',
    description: 'Caption for a build photo that is not of this build itself (public/logos/builds/<slug>): what it shows and whose photo it is, e.g. "A similar desktop, for illustration. Photo: Dateks." The source is where the photo comes from. Empty when the photo is of the build.' },
  { key: 'measured.max_concurrency', type: 'number', writer: 'human',
    description: 'Measured on a deployed build: vLLM\'s startup line "Maximum concurrency for N tokens per request", at the build\'s context_per_session. The source is the saved log. Replaces the sizing estimate.' },
  { key: 'measured.output_tokens_per_second', type: 'number', writer: 'human',
    description: 'Measured on a deployed build: output tokens per second for one session on the main model. The source is the saved benchmark log.' },
];

/* ────────────────────────── COMPANY SCHEMA ─────────────────────────── */

export const COMPANY_FACT_SCHEMA: FactSchemaEntry[] = [
  HIDDEN_FACT,

  // Snapshots
  {
    key: 'snapshot.official',
    type: 'snapshot',
    writer: 'agent', evidence: 'judgment',
    description: 'Company website / About page. Rendered as the "official" link on the company page. Often carries HQ city, employee count, legal structure.',
    preferred_for: ['hq_city', 'employee_tier'],
  },
  {
    key: 'snapshot.wikipedia',
    type: 'snapshot',
    writer: 'agent', evidence: 'judgment',
    description: 'Wikipedia page for the company. Infobox is the fastest single source for country, HQ city, founding, employee count, ownership.',
    preferred_for: ['country', 'hq_city', 'founded', 'legal_structure', 'ownership', 'parent_company', 'employee_tier'],
  },
  {
    key: 'snapshot.huggingface_org',
    type: 'snapshot',
    writer: 'agent', evidence: 'judgment',
    description: 'HuggingFace organization page. Rendered as the HF link on the company page.',
    url_hint: 'https://huggingface.co/<org>',
    preferred_for: ['weights_availability'],
  },
  {
    key: 'snapshot.github_org',
    type: 'snapshot',
    writer: 'agent', evidence: 'judgment',
    description: 'GitHub organization page. Rendered as the GitHub link on the company page.',
    url_hint: 'https://github.com/<org>',
    preferred_for: [],
    optional: true,
  },

  // Data facts
  { key: 'country', type: 'string', writer: 'agent', description: 'HQ country' },
  { key: 'hq_city', type: 'string', writer: 'agent', description: 'HQ city (paired with country — e.g. "San Francisco")' },
  { key: 'founded', type: 'string', writer: 'agent', description: 'Year founded (YYYY or YYYY-MM-DD)' },
  { key: 'weights_availability', type: 'string', writer: 'agent', evidence: 'judgment', description: 'open-fully, open-with-restrictions, research-only, gated, or closed' },
  { key: 'legal_structure', type: 'string', writer: 'agent', evidence: 'judgment', description: 'for-profit, pbc (public benefit corporation), llc, nonprofit, or other' },
  { key: 'ownership', type: 'string', writer: 'agent', evidence: 'judgment', description: 'public (traded on a stock exchange), private (privately held), or subsidiary (owned by a parent company — set parent_company)' },
  { key: 'parent_company', type: 'string', writer: 'agent', review_days: 365, description: 'Parent company name if ownership=subsidiary (e.g. "Alibaba Group"). Free text — parent does not need to be tracked in src/data/companies/.' },
  { key: 'employee_tier', type: 'string', writer: 'agent', evidence: 'judgment', description: 'Headcount bucket. Fixed enum: <50 | 50-500 | 500-5k | 5k-50k | 50k+' },
];

/* ────────────────────────── HARNESS SCHEMA ─────────────────────────── */

export const HARNESS_FACT_SCHEMA: FactSchemaEntry[] = [
  // Snapshots
  {
    key: 'snapshot.github',
    type: 'snapshot',
    writer: 'agent', evidence: 'judgment',
    description: 'GitHub repo README (or root page). Rendered as the canonical GitHub link on the harness page; sync-github reads license and languages from it.',
    url_hint: 'https://github.com/<org>/<repo>',
    preferred_for: [
      'developer', 'developer_company_slug',
      'license_commercial', 'install_method',
    ],
  },
  {
    key: 'snapshot.website',
    type: 'snapshot',
    writer: 'agent', evidence: 'judgment',
    description: 'Marketing / homepage for the project. Rendered as the canonical website link on the harness page.',
    preferred_for: [],
    optional: true,
  },
  {
    key: 'snapshot.docs',
    type: 'snapshot',
    writer: 'agent', evidence: 'judgment',
    description: 'Documentation site landing page (docs.foo.com or /docs subpath). Rendered as the canonical docs link.',
    preferred_for: ['install_method'],
    optional: true,
  },
  {
    key: 'snapshot.package',
    type: 'snapshot',
    writer: 'agent', evidence: 'judgment',
    description: 'Package registry entry (npm, PyPI, crates.io).',
    preferred_for: ['install_method'],
    optional: true,
  },

  // Data facts
  { key: 'developer', type: 'string', writer: 'agent', description: 'Developer / maintainer (display name)' },
  { key: 'developer_company_slug', type: 'string', writer: 'agent', evidence: 'judgment', description: 'Slug of the developing company if it exists in src/data/companies/, else null' },
  { key: 'license', type: 'string', writer: 'sync', description: 'License (SPDX id) from GitHub\'s repo API.' },
  { key: 'license_commercial', type: 'boolean', writer: 'agent', evidence: 'judgment', description: 'Commercial use permitted' },
  { key: 'language', type: 'list', writer: 'sync',
    shape: { columns: [{ name: 'name', type: 'string' }, { name: 'percent', type: 'number' }] },
    description: 'Language breakdown from GitHub\'s /languages API, converted to percentages. Sorted descending; small languages rolled into an "Other" row.' },
  { key: 'philosophy', type: 'string', writer: 'agent', evidence: 'judgment', description: 'Short 2-4 word phrase capturing the harness\'s identity, drawn from its own README / tagline / docs (e.g. "minimal git-native editor", "Claude Code-style TUI", "focused refactoring agent"). Coin a new phrase if the source material warrants it — prefer the project\'s own words. The dashboard chip colors by hashing the phrase, so consistent wording across similar harnesses is worth some care.' },
  { key: 'install_method', type: 'string', writer: 'agent', review_days: 365, description: 'Canonical install command (e.g. "npm install -g foo"), quoted exactly as the project documents it.' },
];

/** Map a part `class` value to its image subdirectory under
 *  `public/logos/`. Kept next to the schema because the class enum is
 *  defined here — any new class needs a directory decision made here. */
export function partLogoDir(cls: string | null | undefined): string {
  if (cls === 'gpu') return 'gpus';
  if (cls === 'system') return 'systems';
  return 'parts';
}

export const FACT_SCHEMAS: Record<EntityType, FactSchemaEntry[]> = {
  model: withReviewCadence(withMyTake(MODEL_FACT_SCHEMA)),
  build: withReviewCadence(withMyTake(BUILD_FACT_SCHEMA)),
  part: withReviewCadence(PART_FACT_SCHEMA),
  company: withReviewCadence(withMyTake(COMPANY_FACT_SCHEMA)),
  harness: withReviewCadence(withMyTake(HARNESS_FACT_SCHEMA)),
};

/** The schema entry for a key, or undefined if the key is not declared. */
export function schemaEntry(type: EntityType, key: string): FactSchemaEntry | undefined {
  return FACT_SCHEMAS[type]?.find(s => s.key === key);
}

/** The evidence an agent claim on this entry needs (`quote` by default). */
export function evidenceOf(entry: FactSchemaEntry): FactEvidence {
  return entry.evidence ?? 'quote';
}

/** Minimal shape for the evaluator — just enough to read fact values.
 *  Works for both on-disk entity JSONs and dashboard-flattened facts. */
interface FactValueLookup {
  facts?: Record<string, { value?: unknown; na?: boolean }>;
}

/** Evaluate `applies_when` against an entity. Returns true if every
 *  declared condition matches (AND). Unset `applies_when` → always true.
 *  A referenced fact that is null/missing/N/A → the condition doesn't
 *  match (fail-safe: if we don't yet know `distribution`, we hide
 *  distribution-gated facts). */
export function factApplies(entry: FactSchemaEntry, entity: FactValueLookup): boolean {
  const conditions = entry.applies_when;
  if (!conditions) return true;
  const facts = entity.facts ?? {};
  for (const [key, expected] of Object.entries(conditions)) {
    const fact = facts[key];
    if (!fact || fact.na === true) return false;
    const actual = fact.value;
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(actual as string)) return false;
  }
  return true;
}
