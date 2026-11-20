# privateai.solutions — Plan

**Owner:** Luke Bodmer

> Architecture details live in `ARCHITECTURE.md`. This file is what's next.

---

## What's next

### Launch checklist

The site is deployed — Cloudflare Workers, rebuilt on every push to `main` —
and `info@privateai.solutions` receives through Email Routing. What is left
before it is announced:

- **`www.privateai.solutions` does not resolve.** A proxied `A` record for
  `www` to `192.0.2.0`, then a Redirect Rule from `https://www.*` to
  `https://${1}`, status 301, query string preserved.
- **Web Analytics is off** while the footer promises aggregate analytics. Add
  the site in Web Analytics; a proxied zone gets the beacon injected at the
  edge, so no snippet belongs in the layouts.
- **No DMARC record**, so `info@` can be spoofed. Add `_dmarc` =
  `v=DMARC1; p=none; rua=mailto:info@privateai.solutions`, read the reports,
  and tighten to `quarantine` then `reject` once the contact form's mail is
  confirmed to pass.
- **Commits are authored `lukejbodmer@gmail.com`** — a personal address in a
  public history. Add and verify `info@privateai.solutions` on GitHub, then
  set it in git.
- **Write *How I used Neuman to maintain this site*** (a placeholder now),
  **and read the home page in your own voice** — it was drafted for you and
  is public prose.
- **Work the review queue**, and fill the empty part prices.
- **Remove the `research` account and `modules/neuman-research`** from the
  NixOS config.

### Neuman's release

The repository is public, so the docs fetch needs no token and `/download`
installs from it. Left:

- Add Neuman as a harness entity (`snapshot.github`), and link the home page
  and `/docs` to the source.
- "Runs in Neuman" panel on model pages from Neuman's shipped presets (via
  its release bundle). Needs one model id convention across both repos —
  Neuman says `qwen3_8-27b`, this site `qwen3.8-27b`.

### The daily run

The schedule is Neuman's. Log every friction in `NEUMAN_FEEDBACK.md`; that
list is what the task feature needs next. Once the review queue stays
small, a fourth step can commit what passed.

### Builds replace hardware

Decided 2026-11-17. The site stops listing single cards. `/hardware` becomes
`/builds`: complete machines we build and set up, each sized for a team and
the models it runs. Cards and systems stay in the data as **parts** of
builds, each with a page reached from its builds and not listed on its own.

**The first builds** (a ladder, each step running a model the one below
cannot):

| Build | Kind | Memory | Sized for |
|---|---|---|---|
| Starter workstation: 1× RTX 5090 | custom | 32 GB | Qwen3.8-27B |
| Team workstation: 2× RTX PRO 6000 Blackwell | custom | 192 GB | GLM-5.3-Flash |
| Quiet office: Mac Studio, 512 GB | system | 512 GB | MiniMax M3, GLM-5.3 |
| DGX Station (GB300) | system | 748 GB coherent, 252 GB of it HBM3e | GLM-5.3, DeepSeek V4.1 |
| Kimi server: 8-GPU HGX B300 | system | ~2.3 TB HBM | Kimi K3.1 Pro (1,561 GB of weights) |

Two linked DGX Stations (1.5 TB) cannot hold Kimi K3.1 Pro's weights, so
its build is the HGX server: priced on quote, rack power and cooling.

**Entities.**
- `part` replaces `hardware`. Classes `gpu | system` (`system` covers DGX,
  Mac Studio, HGX servers). Specs and `price.new_usd` stay agent facts with
  quotes; `price.used_usd` goes. The A100, H100, A6000, RTX 6000 Ada, 3090
  and 4090 files are deleted; the RTX PRO 6000 Blackwell, Mac Studio, DGX
  Station and HGX B300 are onboarded through Neuman like any entity.
- `build` is new. Luke's facts (`human`): `kind` (`custom | system`),
  `team_size`, `concurrent_sessions`, `context_per_session`, `parts`
  (part slug, quantity), `models` (model slug, weights variant), and for
  custom builds `price_range`. A system build's price is its part's tracked
  price.

**Sizing: what fits is arithmetic on sourced values; what performs is
measured.** No recommendation rests on an unsourced number:
- *Weights*: the model's file sizes, already synced from Hugging Face.
- *KV cache per token*: computed by sync-hf from the model's archived
  `config.json`, with the published formulas, counting only full-attention
  layers (linear-attention layers keep a fixed state per session instead):
  - standard and grouped-query attention: NVIDIA, *Mastering LLM
    Techniques: Inference Optimization* (2023): `2 × num_layers ×
    (num_heads × dim_head) × precision_in_bytes`;
  - latent attention (GLM-5.3, Kimi K3.1): DeepSeek-V2 (arXiv 2405.04434),
    Table 1: `(d_c + d_h^R) × l` elements.
  An architecture neither formula covers (DeepSeek V4.1's compressed
  attention) gets no estimate, and its builds say "measure on deployment".
- *Usable memory*: vLLM's `gpu_memory_utilization` (the share of memory it
  will use), from vLLM's own source.
- *Sessions at once*: not a literature value. Luke sets it per build for
  the customer, and the page shows the margin it leaves. When a build is
  deployed, vLLM's startup line "Maximum concurrency for N tokens per
  request" is saved as the measured value and replaces the estimate.
- Every one of these documents is archived (`ingestBytes`) and cited from
  `src/data/sizing.json`, so the method's sources are as checkable as a
  fact's. Speed figures appear only when measured.

**Prices.** Daily. The sweep re-reads one listing per part; a part with no
listing the checker can read is marked `price.swept: false` and drops out. A
per-part history file (`src/data/price-history/<slug>.jsonl`) gets a row at
every check, changed or not, and system builds chart it. Custom builds show
Luke's range, never a computed total. Best Buy's Products API takes over new
prices where it lists the part (needs a key); Neuman keeps the rest.

**Done (2026-11-17):** (1) schema, entities and the sizing sources; (2)
`/builds` pages replacing `/hardware`, with the dashboard, briefs, ecosystem
panel and model pages following.

**Left:**
- Luke: verify each build's structural facts in the dashboard, and set
  `team_min`/`team_max`, `concurrent_sessions`, `context_per_session` and
  each custom build's `price_range` and `components`.
- Run the four queued onboardings (RTX PRO 6000 Blackwell, Mac Studio, DGX
  Station, HGX B300) and the RTX 5090's re-research of `bf16_tflops`; until
  then their builds show memory as pending.
- (3) the price history log and chart, with the schedule moving from daily
  to weekly for prices; (4) `sync-bestbuy.mjs`.

### Near-term features

1. **Markdown rendering for `my_take`.** Today renders as pre-wrapped plain
   string. Wire through Astro's markdown renderer.
2. **Blog cross-links.** `related: {models, hardware, companies, harnesses}`
   frontmatter and a "Related writing" section on entity pages. See
   `BLOG_IDEAS.md`. The follow-up post is the harness comparison (Neuman /
   pi / Claude Code on the local Qwen3.8-27B).
3. **Wikipedia REST API** for company `founded` / `hq_city` / `employee_tier`.

### Backlog

- **Measured builds.** Run each build's stack (model + Neuman + harness),
  record vLLM's reported concurrency and measured speeds, and publish them
  as the build's measured values (see *Builds replace hardware*). Speed and
  concurrency claims come only from these runs.
- More entities as models release (the sweep's "Candidates to onboard").

---

## Design invariants (do not break)

- **`factSchemas.ts` is the source of truth.** No hand-copied lists of fact
  keys anywhere. Loaders, briefs, the checker and dashboards derive from it.
- **The schema decides who writes a fact.** `writer` is `sync`, `agent` or
  `human`; the checker enforces it, not a prompt.
- **If an API can give it to us deterministically, a sync owns it.**
- **Neuman's research step writes only its run directory.** It never edits entity files, the schema,
  or the site. Its claims reach the site through the checker or Luke.
- **The checker trusts nothing Neuman saw.** It fetches the source itself,
  and that fetch is the receipt.
- **Prose is Luke's.** `my_take`, the blog, and the consulting pages.
- **One fact-writing path** (`scripts/lib/facts.mjs`): `fetched` is when the
  value changed, and every value change is logged.
- **URLs live in `snapshot.*` facts.** No separate `sources` array.
- **Entity JSON shape is uniform.** `{name, slug, facts, references}`.
- **Nothing in the toolchain writes page files.** New entity = new JSON file.
- **Closed models are entities like any other**, distinguished by
  `distribution`.
- **`applies_when` beats N/A for whole-class rules.**
- **Two-publisher quantization policy.** Unsloth and bartowski only.
- **No cruft.** Pre-v1 = no backwards-compat shims. If something's dead,
  delete it.

---

## Key files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Standing instructions for anyone (human or agent) editing this repo |
| `ARCHITECTURE.md` | System documentation |
| `PLAN.md` | This file |
| `NEUMAN_FEEDBACK.md` | What running this site on Neuman teaches Neuman |
| `BLOG_IDEAS.md` | Running list of possible blog posts |
| `neuman-task.json` | The Neuman task: its steps, the research envelope, the schedule and its inputs |
| `src/data/schemas/factSchemas.ts` | **The** source of truth |
| `src/data/prompts/` | Run brief templates and the claims protocol |
| `scripts/check-run.mjs` | The checker |
| `scripts/prepare.mjs` | Syncs, decides what the run is for, writes its brief (the task's first step) |
| `scripts/admin-server.mjs` | Admin server (patches, onboarding, the queue, runs, review) |
