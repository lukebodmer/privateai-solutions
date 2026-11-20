## Notes for models

**Identity.** Model names collide: "DeepSeek V4 Flash Preview" is not
"DeepSeek V4 Flash 0731", and "Qwen3.8-27B-Instruct" is not
"Qwen3.8-27B-Base". The official announcement usually links the exact
Hugging Face repo; if it does not, search Hugging Face and pick the repo that
matches the disambiguation, not the most popular one.

**Not yours** (filled by sync scripts once `snapshot.huggingface_card` is
right): weight size, quantizations, architecture, context length,
benchmarks, token prices, speed. Getting `snapshot.huggingface_card` right
is what makes all of those appear.

**Snapshots.**
- `snapshot.huggingface_card` — `https://huggingface.co/<org>/<model>`.
- `snapshot.hf_config` — the card URL plus `/raw/main/config.json`.
- `snapshot.official_announcement` — the developer's own announcement page,
  never third-party coverage.
- `snapshot.github` — optional; only if the model has an obvious official repo.

**Data facts.**
- `parameters_b` / `parameters_active_b` — in billions. `config.json` rarely
  states a total; the model card usually does ("27B parameters").
- `license` — as the model card or LICENSE file names it (`Apache 2.0`, `MIT`).
  `license_commercial` — whether that license permits commercial use; read
  the license, do not guess from the name.
- `company_slug` — must be a file in `src/data/companies/`. If the company is
  not there, leave it out and say so in the report.
- `distribution` — `open` (weights downloadable), `gated` (weights behind an
  access request or acceptable-use gate), `closed` (API only).

**Useful endpoints.**
- Model card: `https://huggingface.co/<repo>`
- Config: `https://huggingface.co/<repo>/raw/main/config.json`
- License: `https://huggingface.co/<repo>/raw/main/LICENSE`
- Search: `https://huggingface.co/api/models?search=<name>&limit=5`
