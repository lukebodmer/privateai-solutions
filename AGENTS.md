# Working in this repository

privateai.solutions is Luke Bodmer's reference site on running AI on your
own hardware — models, the builds that run them, harnesses, the companies
behind them — and the front door to his consulting. `ARCHITECTURE.md` is
how it works; `PLAN.md` is what's next.

## The rule that overrides tidiness: this is pre-release

The site has not launched. Until it has:

- **No backwards compatibility.** No migration shims, aliases or `legacy`
  comments. If a fact key, a script or a flow is wrong, delete it and
  rewrite the callers and the data.
- **The tree reads as if it were written this way.** No comment, doc line or
  prompt describing a mechanism that is gone.

## Who writes what

- **`src/data/schemas/factSchemas.ts` decides.** Each fact has a `writer`:
  `sync` (an API script), `agent` (Neuman, through the checker) or `human`
  (Luke). Do not add a second place that lists fact keys.
- **Entity JSON is written only through `scripts/lib/facts.mjs`** (or the
  admin server, which uses it), so every value change is logged to
  `src/data/changes.jsonl`. Do not hand-edit entity files to change a value
  that matters; if you must, the change log will not know.
- **Neuman's research step writes only its run directory** (under
  `PRIVATEAI_RUNS_DIR`, outside this repository). If you are Neuman, working
  from a brief: follow the brief's protocol and touch nothing else. The
  task's commands (`neuman-task.json`) run here as Luke.
- **Prose is Luke's**: `my_take`, `src/content/blog/`, `/about`,
  `/services`, `/contact`. Draft only when asked, and say it is a draft.

## Related repositories

| Repo | Relationship |
|------|--------------|
| `~/projects/neuman` | The product, public at <https://github.com/lukebodmer/neuman>. This site showcases it and is maintained with it. Read its `docs/security-model.md` before describing it publicly. Nothing here may become a build-time dependency of Neuman. |

What flows between them:

- **Neuman → this site, always:** its `docs/*.md` from the head of main,
  fetched at every build into `/docs` (`scripts/fetch-docs.mjs`). Neuman's
  repository owns their content; fix a doc there, never in the fetched copy.
  The repository is public, so the fetch needs no token, and main is the only
  source: nothing reads a local checkout.
- **Neuman → this site, at its releases:** its release bundle (version,
  presets) for the home page, which is Neuman's, and "Runs in Neuman" panels.
  Neuman is at 0.1.0 with a public repository; the home page is still
  hand-written and links nowhere external, and joining the two is not done.
- **This site → Neuman:** `NEUMAN_FEEDBACK.md` — what running this site on
  Neuman shows Neuman needs. Never code.
- **Model ids** differ today (`qwen3.8-27b` here, `qwen3_8-27b` in Neuman's
  presets); agree on one before joining them.

## Checking a change

```bash
nix develop -c pnpm build          # the site builds
nix develop -c pnpm exec tsc --noEmit -p .   # TS/TSX type-check
nix develop -c pnpm check <run> --dry-run    # the checker on a run, writing nothing
```

There is no test suite. A change to the checker should be exercised with a
hand-written `claims.json` covering applied / review / rejected outcomes
against live pages, with `--dry-run` first.
