# privateai.solutions

Open-weight AI model reference: benchmarks, quantizations available on disk,
architecture, licensing, and the companies + harnesses in that ecosystem.
Closed-source frontier models are tracked as comparison points on the
benchmark scatter charts (they don't get detail pages).

**Site:** https://privateai.solutions
**Repo:** github.com/lukebodmer/privateai-solutions
**Hosting:** Cloudflare Workers (`wrangler.jsonc`) — every page is a static
asset; `src/worker.js` runs for `/api/*` only and emails a contact-form
submission to the destination pinned in the `send_email` binding. Workers
Builds deploys every push to `main`; `pnpm deploy` does the same from a
machine.
**Maintainer:** Luke Bodmer

---

## Architecture

Statically-generated Astro site. Every value on the site is a
**provenanced fact** — stored with its source URL, the date it last changed,
and who signed it off. The schema decides who may write each fact
(`writer`), and there are three signers:

- **`auto`** — a trusted API sync: Artificial Analysis (`sync-aa.mjs`),
  Hugging Face (`sync-hf.mjs`), GitHub (`sync-github.mjs`). If an API can
  answer it, a sync owns it.
- **`neuman`** — the agent claimed it in a [run](#runs), and the
  [checker](#the-checker) fetched the cited page itself and found the quote
  and the value on it. Only facts with `quote` evidence can publish this way.
- **`luke`** — signed off in the admin dashboard: by verifying a fact, or
  by accepting a claim from the review queue (identity and classification
  facts, conflicts, big jumps, anything the checker could not confirm).

Every page shows which, per value (`FactLedger`), and every value change is
logged to `src/data/changes.jsonl`. The blog post *How I Use Neuman's Tasks
to Maintain This Site* explains this to readers.

### Data model

All entity data lives in `src/data/` as JSON files. Each entity JSON has a
uniform shape:

```json
{
  "name": "DeepSeek V4 Flash 0731",
  "slug": "deepseek-v4-flash-0731",
  "facts": {
    "benchmark.aa_intelligence_index": {
      "value": 61,
      "source": "https://artificialanalysis.ai/models/deepseek-v4-flash",
      "fetched": "2026-09-05",
      "verified_by": "luke",
      "verified_at": "2026-09-05"
    },
    "my_take": {
      "value": "Optional hand-authored markdown.",
      "source": null,
      "fetched": null,
      "verified_by": "luke",
      "verified_at": "2026-09-05"
    }
  },
  "references": [ ... ]
}
```

**Fact provenance object:**

| Field | Meaning |
|-------|---------|
| `value` | The data (string, number, boolean, array/object for structured facts, or null) |
| `source` | URL where it was obtained |
| `fetched` | Date the value last changed. Re-confirming a value never moves it |
| `verified_by` | Who signed off: `"luke"`, `"auto"` (API sync), `"neuman"` (agent claim the checker confirmed), or `null` (unverified) |
| `verified_at` | Date it was last signed off or re-confirmed |
| `quote` | Optional. The passage on the source page that carries the value — on `neuman` facts and accepted claims |
| `na` | Optional. `true` = fact doesn't apply to this entity. Absent = active. See [N/A facts](#na-facts) |
| `snapshot_hash` | Optional. sha256 of the archived page/response backing this fact. Points at `$RESEARCH_ROOT/blobs/<sha[:2]>/<sha>.<ext>[.gz]`. See [Snapshot archive](#snapshot-archive) |
| `snapshot_ext` | Optional. File extension of the archived blob (`json`, `html`, ...). Paired with `snapshot_hash` for exact-file linking |

**`my_take`** is a universal fact appended to every entity type's schema. It's
prose — `type: 'text'` in the schema — so it participates in the same
verified_by/verified_at sign-off flow as any other fact. When non-empty, the
entity page renders it as a "My take" block at the top. Its `writer` is
`human`: it never appears in a brief and the checker refuses claims on it.

### Fact types

Facts are one of **seven semantic types**. Two of them (`text`, `snapshot`)
are hints on strings that drive specific UI treatment; the rest are plain
scalars.

| Type | `value` shape | Renders as |
|------|--------------|-----------|
| `string` | `"Aider AI"` | Text input |
| `number` | `42` | Number input |
| `boolean` | `true` \| `false` | true/false input |
| `date` | `"2026-09-06"` (ISO) | Date input |
| `list` | `Array<Record<string, primitive>>` | Generic table editor (see below) |
| `text` (hint on `string`) | `"long-form prose..."` | Full-width textarea, full-width card. Only `my_take` uses this |
| `snapshot` (hint on `string`) | `"https://..."` (the canonical URL) | Fact card with 📎 icon linking to the archived blob (served via admin server) |

**List facts** require a `shape.columns` declaration on the schema entry.
Each column names a field and its scalar type:

```ts
{ key: 'language', type: 'list',
  shape: { columns: [
    { name: 'name',    type: 'string' },
    { name: 'percent', type: 'number' },
  ]},
  description: '...' }
```

The dashboard renders any list fact with a generic table editor: one input
per column per row, `+ Add row` / `✕` remove / OK / Cancel. Read-only display
is a `·`-separated row list (first column emphasized). No per-fact-key
special cases. New list facts drop in with just the schema declaration.

`[]` (empty array) is a valid list-fact value distinct from `null` — it
means "we looked and there are none," the confirmed-absent state for lists.

### <a id="na-facts"></a>N/A facts

A fact can be marked N/A on a per-entity basis via the `× → Mark N/A` button on
the fact card, which writes `na: true` to the fact provenance. N/A means "this
key doesn't apply to this entity" (e.g. `snapshot.github` on a model released
only on Hugging Face).

The rules N/A implies, everywhere:

- **Dashboard:** N/A cards render dashed grey and faded, with only a
  `↺ Reactivate` button. Value and source are preserved underneath so
  reactivating restores the prior state verbatim.
- **Roll-ups:** N/A facts are excluded from all verified/unverified/total
  tallies. The entity-row counter shows `unverified / verified / active
  (N N/A)`.
- **Runs:** briefs leave N/A facts out of the claimable table, the checker
  refuses claims on them, and no script writes them.
- **Entity pages:** `factValue()` returns `null` for N/A facts, so they
  drop out of the UI with zero per-page changes.

The on-disk shape is clean: reactivating deletes the `na` key rather than
setting it to `false`. Absent = active.

### <a id="applies-when"></a>`applies_when` — schema-level gating

A schema entry can declare `applies_when: {<fact_key>: <value> | <value[]>}`.
Non-matching entities treat that fact **exactly like N/A**: dropped from
tallies, dropped from run briefs, refused by the checker, dropped from
pages, skipped by syncs. All conditions must match (AND). A referenced fact that is null
or N/A fails the condition (fail-safe: if we don't know `distribution`
yet, we hide distribution-gated facts).

Today's uses (all on the model schema):

```ts
{ key: 'snapshot.huggingface_card', applies_when: { distribution: ['open', 'gated'] }, ... }
{ key: 'snapshot.hf_config',        applies_when: { distribution: ['open', 'gated'] }, ... }
{ key: 'snapshot.unsloth_gguf',     applies_when: { distribution: ['open', 'gated'] }, ... }
{ key: 'snapshot.bartowski_gguf',   applies_when: { distribution: ['open', 'gated'] }, ... }
{ key: 'native_size_gb',            applies_when: { distribution: ['open', 'gated'] }, ... }
{ key: 'parameters_active_b',       applies_when: { distribution: ['open', 'gated'] }, ... }
{ key: 'architecture.experts',      applies_when: { distribution: ['open', 'gated'] }, ... }
{ key: 'quantizations_unsloth',     applies_when: { distribution: ['open', 'gated'] }, ... }
{ key: 'quantizations_bartowski',   applies_when: { distribution: ['open', 'gated'] }, ... }
```

Result: closed models don't show these fields at all — no red cards to
clear, no wasted agent work, no page holes. The onboarding modal collects
`distribution` up front so the gate takes effect immediately on the first
render.

**N/A vs `applies_when`:** N/A is a per-entity user choice ("this
specific entity doesn't have this fact"). `applies_when` is a
schema-level rule ("this fact only exists for entities matching X").
Same downstream behavior; different mental model.

**When to use which:** if a whole class of entities never has a fact,
use `applies_when` (e.g. closed models never have `native_size_gb`).
If only *this* specific entity is missing an otherwise-applicable fact
(e.g. AA never benchmarked *this one* open model), use N/A.

The evaluator lives in `factSchemas.ts` (`factApplies(entry, entity)`).
Consumers: `src/pages/admin/index.astro` (drops rows from `scanType`),
`scripts/lib/briefs.mjs` (claimable table), `scripts/check-run.mjs`
(refuses claims), `FactLedger.astro`, and `scripts/sync-hf.mjs` (skips
models where the HF snapshot fact wouldn't apply).

### Entity types

| Type | Directory | Schema |
|------|-----------|--------|
| Models | `src/data/models/*.json` | `MODEL_FACT_SCHEMA` |
| Builds | `src/data/builds/*.json` | `BUILD_FACT_SCHEMA` |
| Parts | `src/data/parts/*.json` | `PART_FACT_SCHEMA` |
| Companies | `src/data/companies/*.json` | `COMPANY_FACT_SCHEMA` |
| Harnesses | `src/data/harnesses/*.json` | `HARNESS_FACT_SCHEMA` |

**Images.** A part's product image is `public/logos/{gpus,systems}/<slug>`;
a build's own photo is `public/logos/builds/<slug>`. A build without one
shows its part's image when it is a single part. Only photos of the build
itself, or the maker's image of a product it contains, belong here.

**Builds** are complete machines we build and set up for a team: what goes
in them, who they are for and what they run. Every build fact is Luke's
(`human`): `kind` (`custom` | `system`), `runtime`, `parts` (part slug
and quantity), `components` (the rest of a custom build), `models` (model
slug and weights variant), team size, `concurrent_sessions`,
`context_per_session`, a custom build's `price_range`, and the
`measured.*` values of a deployed build. `/builds` lists them; each build
page shows what it runs and whether it fits.

**Parts** are what builds are made of and hold the model: a GPU card
(`class: gpu`) or a machine bought as one (`class: system` — DGX Station,
Mac Studio, an HGX server). Each has a page (`/parts/[slug]`: specs and
price with provenance, the builds it is in), linked from its builds' "What it
is" cards and not listed anywhere else. `memory_gb` is
the memory a model can be loaded into (VRAM, unified, or a Grace system's
coherent memory, with `gpu_memory_gb` beside it when that differs).

**Sizing** (`src/lib/sizing.ts`) is arithmetic on sourced values only:
weights (Hugging Face file sizes) plus `concurrent_sessions` ×
`context_per_session` × the model's `kv_cache_bytes_per_token` (computed by
sync-hf from `config.json`) must fit in the memory the build's runtime will
use. Every rule, and the document each comes from, is in
`src/data/sizing.json`; `pnpm sizing:sources` fetches those documents,
confirms their quotes with the checker's text rules, and archives them.
What the arithmetic cannot answer (a part not yet researched, an attention
design no cited formula covers, a Mac's GPU memory limit) is shown as a
reason, never estimated. Speeds and measured concurrency are `measured.*`
facts only.

**Prices.** `price.new_usd` on a part is one observed listing, with the
listing as source and the price in the quote, so the checker can confirm it;
`null` with the page that shows a part is sold on quote. It is `volatile`
(a newer checked price supersedes Luke's sign-off) with a 35% `max_change`.
`price.swept` is Luke's switch for whether the sweep re-checks that
part's price; false when no listing the checker can read exists.
A system build shows its parts' prices; a custom build shows only Luke's
`price_range`, never a computed total.

**`src/data/schemas/factSchemas.ts` is *the* source of truth.** Adding a fact
key there is the only change needed for it to appear in the admin dashboard,
flow into entity pages, be offered in run briefs, and be judged by the
checker. Each entry declares its `writer` (`sync` / `agent` / `human`),
for agent facts its `evidence` (`quote`, the default, or `judgment`), and
optionally `volatile`, `max_change` and `review_days`. No typed
`Model`/`Build`/etc. interfaces exist — pages read facts via a `fact()` accessor.

`review_days` is the sweep cadence for an agent fact: snapshots and judgment
facts default to 365 days, a `quote` fact opts in explicitly, and a fact with
no cadence is checked when the entity is onboarded and then left alone.
`price.new_usd` is the exception: it has no `review_days` because the price
list handles it.

**Closed models are first-class entities.** GPT-6, Claude Opus 5, etc. live in
`src/data/models/` alongside open ones, distinguished by the `distribution`
fact (`open` / `closed` / `gated`). They appear on charts and the
admin dashboard, but the `/models/[slug]` route filters them out — closed
models have no detail page.

### Snapshot facts — the primary unit of trust

Snapshots are first-class facts, not a separate concept. The schema
declares `snapshot.*` fact keys per entity type (`snapshot.huggingface_card`,
`snapshot.github`, `snapshot.techpowerup`, ...). Each snapshot fact holds
a canonical URL; whoever writes it archives the page. Its provenance carries
`snapshot_hash` + `snapshot_ext` pointing at the local blob.

There is no separate `sources` array. Anything URL-shaped lives in a
`snapshot.*` fact — one system, one editor, one verify flow.

The schema entry for a snapshot fact carries:

| Field | Meaning |
|-------|---------|
| `key` | e.g. `snapshot.huggingface_card` |
| `type` | `'snapshot'` |
| `description` | Human-facing purpose |
| `url_hint` | Expected URL shape (`https://huggingface.co/<org>/<model>`) — brief guidance |
| `preferred_for` | Data-fact keys this snapshot is authoritative for. Used in brief tables. |
| `optional` | `true` = nice-to-have; not hunted for. Absent = canonical (required). |

Canonical snapshots at a glance:

| Entity | Canonical snapshots | Optional snapshots |
|--------|---------------------|---------------------|
| Company | `snapshot.official`, `snapshot.wikipedia`, `snapshot.huggingface_org` | `snapshot.github_org` |
| Model | `snapshot.huggingface_card`, `snapshot.hf_config`, `snapshot.unsloth_gguf`, `snapshot.bartowski_gguf`, `snapshot.official_announcement` | `snapshot.github` |
| Part | `snapshot.maker`, `snapshot.techpowerup` (cards) | `snapshot.wikipedia` |
| Harness | `snapshot.github` | `snapshot.website`, `snapshot.docs`, `snapshot.package` |

Snapshot facts are identity, so agent-proposed ones are `judgment` and go
through review: accepting one means "this is the right document". The
GGUF repo snapshots are found by sync-hf's search and owned by it.

Benchmarks, pricing, and speed for models are not snapshot-driven — they
come from the AA and Arena syncs (see below).

### The generic loader

`src/lib/facts.ts` is the one way pages read entity data:

- `loadEntities(type)` — list every entity of a type, sorted by name
- `loadEntity(type, slug)` — load a single entity by slug
- `fact(entity, key)` / `factValue`, `factStr`, `factNum`, `factBool` — access provenance or values
- `snapshotUrl(entity, snapshotKey)` — read the URL captured by a snapshot fact (e.g. `snapshot.huggingface_card`)
- `relatedEntity(entity, key, targetType)` — cross-entity resolution (e.g. model → company)

**Split file layout:** `src/lib/entityTypes.ts` holds browser-safe constants
(`ENTITY_DIR`); `src/lib/facts.ts` holds Node-only loader logic (uses `fs`/`path`).
The split exists so `AdminDashboard.tsx` (a client-bundled React component)
can import type/dir info without pulling Node built-ins into the browser.

### How pages use facts

**Model pages** (`/models/[slug]`, open models only) render a hard-coded
per-type layout: header with SourceLinks chips, one quantizations table per
publisher (`quantizations_unsloth`, `quantizations_bartowski` — each with a
`↗ repo` link to its HF source; sections with empty or N/A values are
hidden), architecture, capabilities, AA pricing/speed chips, benchmarks
table (score + rank across all tracked models on each tile), optional My
take, references.

**Every entity page** ends with a collapsed **FactLedger** — every value on
the page with its Provenance line (signer, date last checked, source host;
the quote on hover) and a tally by signer. A system build's page also shows
each part's price Provenance inline, and every build page lists the sizing
documents behind its rules.

**Company pages** (`/companies/[slug]`) show `hq_city, country` in the
subhead + `founded` date, an optional "Subsidiary of X" line when
`ownership: subsidiary` (X is free text from the `parent_company` fact —
the parent doesn't need to be tracked as its own entity), a chip row for
weights-availability + ownership + legal_structure + employee_tier,
SourceLinks chips (with the company logo standing in for the `official`
role), models developed by that company (open ones link, closed ones show
as non-linked rows with a `closed` badge), harnesses developed by that
company, optional My take.

**Harness pages** (`/harnesses/[slug]`) show philosophy (hash-colored) +
license + primary-language chips, SourceLinks (website, github, docs,
package), install command, a horizontal-bar Languages breakdown (from the
`language` list fact), optional My take.

**Models table** (`ModelTable`, on `/models`) shows open-weight models only. Each row:
name, params, MoE/Dense, context, license, released. All from facts.

**Benchmark grid** (`BenchmarkGrid.astro` via `loadBenchmarks`, on
`/models` and each model page; the home dashboard draws the same tiles
small) renders one vertical-bar chart per tile declared in
`src/data/benchmarks/*.yaml`: AA's Intelligence Index and Arena's
Text/Coding rating. Every tile shares one column order (the first tile's
ranking, then models only a later tile scores), so a model sits in the same
place across charts. Open models are solid bars in their brand color and
closed models hollow, for reference. A tile's `scale_min`/`scale_max` set
the range a bar fills (Arena's ratings sit around 1300–1600, so its floor is
not 0), and `source_url` is the attribution link in its header. Adding a
tile is a one-file YAML add plus a sync-written schema key.

### Admin dashboard

**URL:** `/admin` (dev-only — renders nothing in production builds
via `import.meta.env.DEV` guard)

Start `pnpm dev` then open `http://localhost:4321/admin`:

- **5 category sections** in fixed alphabetical order: Builds, Companies,
  Harnesses, Models, Parts. Each collapsible.
- **Roll-up squares** on each category header (green if every entity in
  the category is fully verified, red if any entity has an unverified
  fact) and on each entity row (same rule, per entity). Missing facts
  count as unverified. **N/A facts are excluded from tallies entirely.**
- **Per-entity collapse**: expanding a category shows entity rows
  collapsed by default. Click a row to expand its fact cards.
- **Fact cards** — five states, three colors:
  - **Verified + has value** → full green
  - **Verified + null value** → muted green (signed off as "unavailable")
  - **Unverified** → red
  - **N/A** → dashed grey, faded (excluded from tallies; single Reactivate button)
  - **Missing** (in the schema, absent from the file) → red, rendered
    like an unverified null fact. Filling one via Edit creates the entry
    on Apply.
- **Staleness badge** on each fact: `Nd ago` / `Nmo ago` / `Ny ago`,
  colored grey (fresh), amber (>180d) or red (>365d). Ages come from
  `verified_at`, so a re-verified fact resets its counter.
- **📎 Snapshot badge** next to the signer badge when a fact carries a
  `snapshot_hash`: opens the archived blob (via `GET /snapshot/<sha>.<ext>`
  on the admin server, gunzipped and content-typed on the fly). Clicking
  the card background does the same. Dev-only — production has no admin
  server or `RESEARCH_ROOT`.
- **Click card background**: opens the archived blob when `snapshot_hash`
  is set, otherwise opens the live source URL. Verified facts always
  point at their receipt.
- **Verify button**: marks fact as verified in localStorage.
- **Edit button**: flips card to Value + Source URL fields with OK/Cancel.
  Also works on missing facts — filling one adds it to the JSON on Apply.
- **× (N/A) button** on the top-right corner of each card (visible on
  hover): marks the fact as N/A for this entity. See [N/A facts](#na-facts).
- **List-fact card** (any fact with `type: 'list'` in the schema): the
  card spans the full row width. Display: header shows the fact key and a
  row count; body is a `·`-separated list, one row per record, columns in
  schema order. Edit: generic table editor driven by `shape.columns` — one
  input per column per row, `+ Add row`, `✕` remove, OK/Cancel. Type
  coercion happens on input (number columns → number). Empty value → `[]`
  (confirmed-absent for lists) or `null` (unfilled).
  - **Quant-fact special-case rendering**: the two `quantizations_*` facts
    override the flat `·`-separated display with a grouped-by-bit-width
    layout that mirrors the HuggingFace quant table (`1-bit` label + rows,
    `2-bit` label + rows, …). Bit-width is parsed from the quant name
    (`UD-Q4_K_XL` → 4-bit, `MXFP4` → 4-bit); unparseable names land in an
    `Other` group. Sizes render with HF-style units (GB below 1000,
    otherwise TB with 2 decimals). The generic edit form is unchanged.
- **My take card** (special-case for the `text` type hint): full-width
  textarea editor. Empty value = section hidden on the entity page.
- **Save pill** (bottom-right, appears only with unsaved changes):
  POSTs verifications + N/A toggles to the write-back server → JSON on disk
- **Snapshot fact card** (any fact with `type: 'snapshot'` in the schema):
  the value is a URL. Verify = "I opened the archived blob and confirmed
  it's the right document." The verify itself triggers the fetch that
  produces that blob. The 📎 icon links to it after the fact.
- **Signer badge** next to the fact key: `file` for luke-verified, `✓ auto`
  for a trusted API sync, `✓ neuman` for an agent claim the checker
  confirmed. Missing = unverified.
- **Request update** (per entity): queues a refresh for the next Run now
  of the Neuman task (see [Runs](#runs)). The sweep has no button; Run now
  with an empty queue, or the daily schedule, runs it.
- **+ New model / company / part / harness** (section headers):
  modals collecting the seed (name, slug, the identifying URL(s), a
  disambiguation string when the name needs one, and per type: distribution,
  part class, images). Submits to `/onboard-<type>`, which writes the seeded entity and
  queues its onboarding.
- **+ New build** (Builds header): asks for a name and POSTs
  `/create-build`, which writes an empty build for Luke to fill in. Builds
  are never researched, so no run is queued.
- **Delete** (per entity row, every type): confirms in a modal, then
  POSTs `/delete-entity`. The entity file and its logo leave the working
  tree, requests queued for it are dropped, and the page reloads; the
  change log keeps what it recorded while the entity existed. An entity
  another still names is refused — a company named by a model or harness,
  a part or model named in a build — since those pages would lose it with
  nothing on them to say why.
- **Recent update runs** (top of the page): *Waiting for Neuman* (the
  queue, oldest first; each request has a trash button that cancels it),
  then every run, newest first, with its status — *running* (and which
  step), *claims not checked*, *needs review*, *done*, *failed* (and which
  step, with its error) — and what it cost. A waiting request waits for Run
  now on the task, in Neuman's Tasks. A run that is not running has a trash
  button that deletes its directory; the facts it changed stay. Expanding a run shows each step's status in Neuman's
  words, a command step's output (open when it failed), its brief, the research step's report, **Re-check**, and
  every claim's verdict with its quote, source and 📎 receipt. Review items
  have **Accept** (applied as Luke's sign-off) and **Reject**.

<a id="runs"></a>
### Runs — how Neuman works on this site

Neuman is the agent appliance this site showcases. Here it runs one
**task**, owned by Luke's own Neuman account: a recipe of three steps that
Neuman walks in order, on Luke's client, with a daily schedule. The recipe
is `neuman-task.json` in this repository — the same fields as Neuman's task
editor, kept here so the envelope the site describes is a reviewed file.

| Step | Kind | What it does |
|------|------|--------------|
| `prepare` | command: `nix develop -c pnpm task:prepare` | runs the API syncs, takes the oldest queued request or the sweep, writes `run.json` and `brief.md` |
| `research` | agent step | reads `brief.md`, researches the web, writes `claims.json` and `report.md` |
| `check` | command: `nix develop -c pnpm check`, also after the research step ran out of steps | runs [the checker](#the-checker), which publishes what it can confirm and writes `result.json` |

A **run** is one execution of the task. Neuman makes its directory,
`<run root>/<date>-<run id>`, under the task's run root, which is
`PRIVATEAI_RUNS_DIR` here (`/data/privateai-runs` on nemo):

| File | Written by | What it is |
|------|------------|------------|
| `neuman-run.json` | Neuman | its record of the run: inputs, each step's status, error and a command's output, cost, the research session (whose transcript is read on the task in Neuman, not in its chat list) |
| `run.json` | `prepare` | kind (`onboard`, `refresh`, `sweep`), entity, title |
| `brief.md` | `prepare` | what the research step is asked to do, composed from the schema (`scripts/lib/briefs.mjs`) |
| `claims.json` | the research step | an array of `{ entity, key, value, source, quote, note?, na? }` |
| `report.md` | the research step | what it did, what it could not find, what got in its way |
| `result.json` | `check` | a verdict per claim, and Luke's review decisions |

**What the research step can reach.** Its envelope grants `fs_read`,
`fs_list`, `fs_write` and `web_fetch`, reads and writes in its own run
directory and nowhere else, and network. Neuman intersects that with
Luke's live policy on every model step, so the step can never reach
further than the envelope says. The brief carries everything the step
needs; it never sees this repository.

**Why the run root is outside the repository.** The two commands run here,
as Luke. Neuman refuses a task whose agent step could write the workspace,
a command's working directory or its program — otherwise a page the agent
read could change what the next command runs. The checker still treats
`claims.json` as untrusted data: it fetches every source itself.

**What a run is for.** Every run takes the oldest request in the queue;
when none is waiting, it runs the sweep:

- **A queued request** — an onboarding or a refresh the dashboard asked for.
- **The sweep** — this run's price of every swept part, a re-check of agent
  facts whose `review_days` have elapsed (at most 40 per sweep), and a list
  of notable new releases in the report, since the start of the last sweep
  that reached `check` (`last-sweep` in `.sync-state.json`, written by that
  step). Onboarding stays a human click. `price.swept: false` on a part
  drops it from the price list when no listing the checker can read exists.

**The queue** (`queue/`, gitignored; `scripts/lib/queue.mjs`) is how the
dashboard asks for a run. Onboard and Request update each write
a request — an onboarding may carry a disambiguation and the seed URLs —
and `prepare` takes the oldest one; when none is waiting it sweeps.
The dashboard cannot start the run itself: Neuman's task API takes a
browser session, not a script (`NEUMAN_FEEDBACK.md`).

**Briefs** (`src/data/prompts/`): `onboard.md`, `refresh.md`, `sweep.md`, one
note per entity type in `types/`, and `protocol.md` — the claims format and
rules every brief ends with. The tables in a brief are computed from the
schema and the entity files: the facts the research step may claim (only
`writer: 'agent'` keys that apply and are not N/A, with current value and
signer), the canonical snapshot table, and the prior-sources table (how
existing entities were sourced, computed per brief by walking every
entity's `snapshot.*` facts and per-fact `source` URLs). A model onboarding
brief also carries the AA catalog entries and Arena leaderboard rows whose
names share a word with the model's; a model refresh brief carries them for
whichever of `aa_id` / `arena_name` / `openrouter_id` (closed models only) is
still unset.

### The checker

`scripts/check-run.mjs` is the only path from a claim to the site, and it
has no model in it. For each claim it:

1. **Refuses** (`rejected`) anything malformed, on an unknown entity or key,
   on a key whose `writer` is not `agent`, on a fact that does not apply or
   is N/A, or with a value of the wrong type.
2. **Fetches the source itself**, from this machine with no browser or
   login, and archives the bytes (`source_kind: "claim"`, with the run id) —
   the receipt. One fetch per URL per run.
3. **Looks for the quote** in the page's visible text (and raw text, for
   JSON sources), comparing words and numbers only — punctuation and markup
   are ignored, the words and their order are not. A bot-challenge page is
   named as such.
4. **Decides by the schema's evidence kind**:
   - `quote`: the value must appear in the quote (numbers by value, dates in
     ISO or written-out form, strings as whole words). Passing claims are
     `applied` with `quote` and the receipt; a value matching one Luke
     signed off keeps his signer, otherwise it is `verified_by: "neuman"`.
   - `judgment`: equal to the value on file, from the same source → `applied`
     with the existing signer; anything new, changed or newly sourced →
     `review`.
5. **Holds back** to `review`: a value contradicting Luke's sign-off (unless
   the fact is `volatile`), a numeric move beyond `max_change` (default
   50%; prices 35%), a `null` (claimed absence), an N/A proposal, a PDF, a
   source that refused the checker.

`aa_id`, `arena_name` and `openrouter_id` claims are checked against the
catalogs the syncs keep on disk (`aa-snapshot.json`, `arena-snapshot.json`,
`openrouter-snapshot.json`) instead of a page: AA's public pages don't print
the UUID, Arena's site refuses scripts, and a catalog lookup is exact. A claim already decided by
Luke keeps its decision when a run is re-checked.

It runs as the task's `check` step (`pnpm check`, which finds its run from
`NEUMAN_RUN_DIR`); `pnpm check <run-id> [--dry-run]` re-checks any run by
hand, and the dashboard's **Re-check** calls the same function.

### Writing facts — one path

Every writer — the syncs, the checker, `/apply-patch`, a review decision —
goes through `writeFact` / `recordChange` in `scripts/lib/facts.mjs`:

- **`fetched` is when the value last changed.** Re-confirming a value moves
  its signer and `verified_at`, never `fetched`.
- **A sync re-reading an unchanged value changes nothing** — not even the
  receipt, because API responses carry counters (stars, downloads) whose
  bytes differ on every read. A sync can also ignore a numeric move under
  `minChange` (AA's speed medians use 5%) as measurement noise. The checker,
  which re-confirms on purpose, does take a new receipt and a new
  `verified_at`.
- **A changed value is appended to `src/data/changes.jsonl`** (date, entity,
  key, from, to, signer, source). Lists are logged
  by row count.
- **N/A is never written by a script.**

### Deterministic syncs

Five scripts fill facts from trusted APIs, all the same shape: fail-soft,
gated to once per 24h (`.sync-state.json`, gitignored; sync-aa,
sync-arena and sync-openrouter use their snapshot's timestamp), `--force`
to bypass, archive every response via `ingestBytes`, write `verified_by:
"auto"`. All five run on `pnpm dev` startup and in every run's `prepare`
step.

| Script | What it fills | Runs against |
|--------|---------------|--------------|
| `sync-aa.mjs` | `benchmark.aa_intelligence_index`, `speed.*` | Every model with `aa_id` set |
| `sync-openrouter.mjs` | `pricing.*`, `providers` | Every open/gated model with `snapshot.huggingface_card` set, every closed model with `openrouter_id` set |
| `sync-arena.mjs` | `benchmark.arena_text_{coding,legal,science}` | Every model with `arena_name` set |
| `sync-hf.mjs` | `native_size_gb`, `architecture.type`, `architecture.experts`, `context_length`, `snapshot.{unsloth,bartowski}_gguf`, `quantizations_{unsloth,bartowski}` | Every open/gated model with `snapshot.huggingface_card` set |
| `sync-github.mjs` | `license`, `language` | Every harness with `snapshot.github` set |

`sync-aa` ignores speed moves under 5%: AA's medians are noisier than that,
and a quiet number should not rewrite a fact every day.

**Rule:** if a public API can answer it, a sync owns it (`writer: 'sync'`)
and the agent never sees it. Neuman is for what needs reading.

### AA sync

`scripts/sync-aa.mjs` pages through Artificial Analysis's documented V2
**Free** catalog, `GET /api/v2/language/models/free` (200 per page, ~4
pages; `scripts/lib/aa.mjs`). The Pro route returns 403 without a
subscription. The legacy `/api/v2/data/*` endpoints were retired on
2026-11-04 and answer 410.

The site takes the Intelligence Index and the speed medians under
`performance.*` from the Free record. It also carries domain indexes and
prices (which OpenRouter owns here, provider by provider); its coding and
agentic index fields are present but never filled, so the site has no
facts for them.

The envelope records `intelligence_index_version`; a version bump rescales
every model, and AA nulls a model it has not re-run under the new version
rather than mixing scales. The sync writes those nulls: an index on this
site is always one version.

- **Joined by `aa_id`**, written with `verified_by: "auto"`, `source` = the
  model's AA page.
- **A model AA stops returning keeps its values** — a transient absence
  doesn't wipe benchmarks.
- **`src/data/aa-snapshot.json`** holds the catalog and envelope; it is what
  model-onboarding briefs and the checker's `aa_id` lookup read.
- **Attribution.** Every surface rendering AA data links to
  https://artificialanalysis.ai/, as AA's terms require.
- **The key never reaches the browser** — `.env`, read by the scripts only.

### OpenRouter sync

`scripts/sync-openrouter.mjs` reads OpenRouter's catalog
(`GET /api/v1/models`) and, for each joined model, every provider it routes
to (`GET /api/v1/models/<id>/endpoints`; `scripts/lib/openrouter.mjs`). Both
answer without a key; `OPENROUTER_API_KEY` from `.env` is sent when set.

- **Joined two ways.** An open or gated model by its Hugging Face repo,
  which the catalog lists as `hugging_face_id` — deterministic, no
  judgment. A closed model has no repo, so by `openrouter_id`, a
  `judgment` fact like `aa_id`. Routing variants (`:batch`, `:free`) and
  aliases (`~…-latest`) are never join targets.
- **What it writes.** `providers`: one row per provider — the weight
  precision it serves (fp4/fp8/bf16), prices, context — cheapest blended
  first, leaving out $0 promotions. `pricing.*`: the median input, output,
  cached-input and blended (3:1) price across those rows, and the cheapest
  blended. Medians, so one cut-price or premium host does not set the number.
- **Live stats stay out.** With the key, endpoints also report latency,
  throughput and uptime per provider. They change every read, so as facts
  they would rewrite every model daily and flood the change log; hosted
  speed comes from AA instead.
- **Receipts.** The catalog and each model's endpoints response are
  archived; a model's facts carry its endpoints receipt.
- **A model whose providers fail to fetch keeps its values.** A model
  OpenRouter does not serve gets `null` prices and `[]` providers.
- **`src/data/openrouter-snapshot.json`** holds the catalog and each joined
  model's providers; briefs and the checker's `openrouter_id` lookup read
  it.

### Arena sync

`scripts/sync-arena.mjs` reads Arena's leaderboard dataset on Hugging Face
(`lmarena-ai/leaderboard-dataset`, CC-BY-4.0, no key;
`scripts/lib/arena.mjs`): the `latest` split of the style-controlled Text
board, served as one Parquet file. It keeps three categories
(`ARENA_CATEGORIES`): `coding`, the closest Arena gets to what a harness
asks of a model, and two occupational ones that match the site's
clients, Legal & Government and Life, Physical & Social Science.

- **Joined by `arena_name`** — Arena has no ids, so the join key is its
  `model_name`, a `judgment` fact like `aa_id`. Written as
  `benchmark.arena_text_coding`, `_legal` and `_science` (the ratings,
  rounded), `verified_by:
  "auto"`, `source` = the dataset page, the Parquet file archived as the
  receipt.
- **A model Arena stops listing, or stops ranking in a category, keeps its rating.**
- **`src/data/arena-snapshot.json`** holds one row per model on the
  `overall` board, with its rating in each kept category; briefs and the
  checker's `arena_name` lookup read it.
- **Attribution.** Every chart that shows benchmark ratings carries a credit
  line under it (`src/components/BenchmarkCredit.astro`) naming the sources
  on screen, with Arena's CC BY 4.0 licence, as CC-BY requires; each tile
  also links its source. The footer carries no credit.

### Snapshot archive (external, content-addressed) — the receipts

Every fact that carries a sign-off has a content-addressed copy of what
backed it. Layout:

```
$RESEARCH_ROOT/
├── blobs/<sha[:2]>/<sha>.<ext>[.gz]  — deduplicated archive; forever
└── manifest.jsonl                    — append-only observation log
```

`RESEARCH_ROOT` is a `.env` var (Luke's is `/data/privateai-research`).
Unset = fail-soft (no snapshots, everything else still works — the repo
stays portable).

- **Content-addressed by sha256**: identical fetches share one blob forever.
- **Compressed**: text formats gzipped; already-compressed formats raw.
- **Sharded** by the first 2 hex chars of the sha.
- **Manifest separate from blobs**: every observation (URL, kind, when,
  sha, and for claims the run id) is recorded even on a dedup hit.
- **Facts point at blobs**: `snapshot_hash` + `snapshot_ext`.

**Three writers**, all via `ingestBytes()` (`scripts/ingest-snapshots.mjs`):

| Writer | When it snapshots |
|--------|--------------------|
| The syncs | Every API response, at sync time |
| The checker | Every page a claim cites, as the checker fetched it — including pages that fail, so a review shows what the checker saw |
| `/apply-patch` | On a luke-verify of a fact with no receipt: fetches its source |

Neuman itself never writes to the archive: what it saw is not evidence;
what the checker fetched is. Never expires; grows monotonically.

### Admin server (dev-only)

`scripts/admin-server.mjs` runs on port 4322, started by `pnpm dev`.

- `POST /apply-patch` — writes Luke's fact edits. Server sets `verified_at`.
  `value`/`source` are overwritten only when sent; an edit drops the old
  quote and receipt. A fact turning luke-verified with no receipt gets one
  (best-effort — a failed fetch doesn't block the verify). Value changes are
  logged to `changes.jsonl`.
- `POST /create-build` — writes an empty build `{name, slug}`. Refuses an
  existing slug.
- `POST /onboard-{model,company,part,harness}` — writes the seeded
  entity (seed facts unverified: they are Luke's input, and the run's first
  job is to confirm them; images to `public/logos/<dir>/`) and queues the
  onboarding. Refuses an existing slug.
- `POST /queue` — queues a refresh `{type, slug}`.
- `POST /dequeue` — cancels a waiting request `{id}`.
- `POST /delete-entity` — removes `{type, slug}`: the entity file, its
  logo in `public/logos/<dir>/`, and any queued request for it. Refuses a
  company that a model or harness still names in `company_slug`.
- `GET /runs` (runs, queue, Neuman's URL), `GET /runs/<id>`,
  `POST /runs/<id>/check`, `POST /runs/<id>/review`
  (`{index, action: 'accept'|'reject'}`), `POST /runs/<id>/delete`
  (refuses a run Neuman is still working on).
- `GET /snapshot/<sha>.<ext>` — serves an archived blob, gunzipped.
- `GET /news`, `POST /news/add` (`{url, title?}`), `POST /news/update`
  (`{url, title?, source?, date?}`), `POST /news/delete` (`{url}`) — the
  news feed in `src/data/news.json`. Adding fetches the page and reads its
  title (`og:title`, then `<title>`), source (`og:site_name`, then the
  host) and publication date (`article:published_time`, JSON-LD
  `datePublished`, the usual date metas, `<time datetime>`, a date in the
  URL, then today). A typed title wins over the page's; with neither — a
  page behind a bot wall — the link is refused until Luke types one, so
  the feed never shows a URL as a title. The feed is links only — no prose.
  `/ecosystem`'s Relevant news panel and `/news` render it.

Entity writes are confined to `src/data/{models,builds,parts,companies,harnesses}/`
with a safe slug charset.

### Dev commands

| Command | What it does |
|---------|-------------|
| `pnpm dev` | All syncs (24h gated) + Neuman's docs + Astro dev + admin server |
| `pnpm task:prepare` | The task's first step: syncs, then `run.json` and `brief.md` in `NEUMAN_RUN_DIR` |
| `pnpm check [<run-id>] [--dry-run]` | Run the checker on a run's claims — the task's own run when no id is given |
| `pnpm dev:admin` | Just the admin server |
| `pnpm docs:fetch` | Neuman's docs from main |
| `pnpm sync:aa` / `sync:aa:force` | Manual AA sync |
| `pnpm sync:arena` / `sync:arena:force` | Manual Arena sync |
| `pnpm sync:openrouter` / `sync:openrouter:force` | Manual OpenRouter sync |
| `pnpm sync:hf` / `sync:hf:force` | Manual HuggingFace sync |
| `pnpm sync:github` / `sync:github:force` | Manual GitHub sync (`GITHUB_TOKEN` for good rate limits) |
| `pnpm build` | Neuman's docs from main, then the production build (static HTML, no admin page) |
| `pnpm deploy` | Build + publish to Cloudflare Pages |

### Key files

| Path | Purpose |
|------|---------|
| `src/data/schemas/factSchemas.ts` | **The** source of truth: every fact key, its writer, evidence, `applies_when` |
| `src/lib/facts.ts` | Generic loader + `fact()` accessor (Node-only) |
| `src/lib/entityTypes.ts` | Browser-safe `ENTITY_DIR` map |
| `src/types/fact.ts` | `FactEntry`, `Signer` |
| `src/data/{models,builds,parts,companies,harnesses}/*.json` | Entity facts |
| `src/data/sizing.json` | The sizing method: its rules and the archived documents behind them |
| `src/lib/sizing.ts`, `src/lib/builds.ts` | Build fit and price, for the build pages, model pages and `/ecosystem` |
| `scripts/sizing-sources.mjs` (`pnpm sizing:sources`) | Fetches, checks and archives the sizing documents |
| `src/data/changes.jsonl` | The change log (append-only, committed) |
| `src/data/aa-snapshot.json` | Latest AA catalog |
| `src/data/arena-snapshot.json` | Latest Arena Text leaderboard, kept categories |
| `src/data/openrouter-snapshot.json` | Latest OpenRouter catalog + joined models' providers |
| `src/data/benchmarks/*.yaml` | Benchmark tile meta |
| `src/data/prompts/` | Run brief templates, type notes, the claims protocol |
| `src/components/AdminDashboard.tsx` | Dashboard island (verify, edit, onboard) |
| `src/components/RunsPanel.tsx` | Dashboard runs panel (queue, run status, checker, review queue) |
| `src/components/NewsPanel.tsx` | Dashboard news panel (add by URL, correct, remove) |
| `src/data/news.json` | The news feed, newest first (written by `scripts/lib/news.mjs`) |
| `src/pages/news.astro` | The news feed, day by day |
| `src/pages/download.astro` | How to install Neuman's two programs — a square per platform, the install of the one picked — and the demo image |
| `src/components/InstallPicker.astro` | The square platform tiles that pick an install, shared by the download page's two sections; marks come from `src/lib/platformIcons.mjs` |
| `src/components/Provenance.astro` / `FactLedger.astro` | Public provenance line / per-page ledger |
| `src/components/BenchmarkCredit.astro` | The source credit under each set of benchmark charts |
| `src/components/SessionTranscript.astro` | A full Neuman session under a post: thinking rows, replies, every tool call and the pictures the looks took, from a checked-in session in `src/data/blog/` |
| `scripts/lib/facts.mjs` | The one fact-writing path + change log + sync state |
| `neuman-task.json` | The Neuman task: steps, envelope, schedule |
| `scripts/lib/runs.mjs` | Run directories |
| `scripts/lib/queue.mjs` | Requests the dashboard queues for the next run |
| `scripts/lib/briefs.mjs` | Brief composition |
| `scripts/lib/aa.mjs` | AA catalog client |
| `scripts/lib/arena.mjs` | Arena leaderboard client |
| `scripts/lib/openrouter.mjs` | OpenRouter catalog + endpoints client |
| `scripts/check-run.mjs` | The checker |
| `scripts/prepare.mjs` | The task's `prepare` step |
| `scripts/admin-server.mjs` | Admin server |
| `scripts/fetch-docs.mjs` | Neuman's docs from main into `src/content/docs/` |
| `src/lib/docs.ts`, `src/layouts/DocsLayout.astro`, `src/pages/docs/`, `src/components/DocCard.astro` | The docs section: sidebar groups, layout, pages, the card `/docs` and the home page share |
| `scripts/sync-{aa,arena,openrouter,hf,github}.mjs` | API syncs |
| `scripts/ingest-snapshots.mjs` | Content-addressed archive (`ingestBytes`) |
| `src/components/GliderMark.astro`, `public/favicon.svg` | The mark: a Game of Life glider, animated through its four generations on nav hover and on the 404 page |
| `src/components/OfficeScene.astro` | The home page hero's background: the office Neuman lives in, a glTF model whose people, the light along the lines to the cabinet, and the camera are all animated |
| `src/components/LifeWord.astro` | The last word of the hero's first line, taken away and put back by a band of Game of Life cells |
| `scripts/brand-images.mjs` (`pnpm brand`) | The mark's raster images: the link-preview card (`public/og-image.svg`, and the `og-image.png` that `Base.astro` points at, built from the home page hero copy) and `public/apple-touch-icon.png` for iOS home screens |

---

## Workflow: onboarding

```
1. "+ New <type>" in the dashboard; fill in the seed and, when the name
   needs it, a disambiguation string.
2. The server writes the seeded entity and queues its onboarding.
3. In Neuman: Tasks (foot of the rail) → the task → Run now.
4. prepare writes the onboarding brief; the research step settles identity
   and writes claims.json and report.md; check publishes the quote facts
   that pass as `neuman`.
5. Identity and classification wait under Review — Accept or Reject each.
6. Once snapshot.huggingface_card / snapshot.github / aa_id / arena_name /
   openrouter_id are accepted,
   the next sync fills everything the APIs know.
```

## Workflow: the daily update

```
1. 10:00 Pacific: Neuman runs the task — syncs, the sweep brief, the
   research, the checker. Prices that pass publish; jumps, absences and
   refusals wait for review.
2. Work the review queue in the dashboard.
3. Read the report's "Candidates to onboard".
4. Commit the data and changes.jsonl; deploy.
```

A due run waits for Luke's client: if nemo's client is not connected at
10:00, the run starts when it reconnects, or is marked missed after six
hours.

---

## Neuman's docs

`/docs` publishes Neuman's own documentation: an index of cards, one per doc
(`src/components/DocCard.astro`), and a page per doc. The nav links to the
index as Docs, and the home page shows four of the cards (`FEATURED_DOCS` in
the page). Neuman's repository owns the content; this site owns presentation.

- **Fetched at build from the head of main.** `pnpm build` (and so
  `pnpm deploy`) runs `scripts/fetch-docs.mjs` first, as does `pnpm dev`;
  `pnpm docs:fetch` runs it alone. The repository is public, so no token is
  needed; `GITHUB_TOKEN`, when set, only raises the API's unauthenticated rate
  limit. Main is the only source. The fetch
  writes only the files that changed, so a re-fetch leaves the rest alone.
- **Every top-level `docs/*.md` publishes**, except the two `NOT_PUBLISHED`
  in `scripts/fetch-docs.mjs`: the decision log (`decisions.md`) and the
  failure log (`gotchas.md`) stay in Neuman's repository, being working
  material for its contributors. `docs/plans/` does not publish either. The
  sidebar's groups are `GROUPS` in `src/lib/docs.ts`; a doc that list does
  not name appears under "More" rather than disappearing.
- **The fetch rewrites each file**: frontmatter (title from the H1, minus a
  leading "Neuman —"; description from the first paragraph), the H1
  removed, and links between docs — `[x](security-model.md)` and the
  `` `docs/security-model.md` `` code spans the docs cite each other with —
  pointed at `/docs/<slug>`. A link to a held-back doc keeps its text and
  loses its target. Output is `src/content/docs/` (the `docs`
  collection) and `src/data/neuman-docs.json` (the commit it read, shown
  under the sidebar); both gitignored.
- **A failed fetch keeps the copy on disk**, and fails the build only when
  there is none.

"Tracks main" means each build reads main as it is then: a doc pushed to
Neuman reaches the live site at the next deploy.

## Static site — no runtime backend

Everything is built ahead of time. Cloudflare Pages serves HTML directly.
No database, no API, no server process. The admin server and Neuman only
run on Luke's machines — never deployed.

The admin page at `/admin` checks `import.meta.env.DEV` at build time. In
production it produces an empty document.
