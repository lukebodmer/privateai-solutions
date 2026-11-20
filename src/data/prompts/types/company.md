## Notes for companies

**Identity.** Names collide ("Meta" the AI lab and Meta the platform). If
the seeded pages do not describe the company Luke named, stop and say so.

Wikipedia's infobox is the fastest single source for most of these facts;
the company's own About page is the authority when they disagree.

- `hq_city` — the city alone, in English ("Beijing", "San Francisco"), not
  "San Francisco, California, USA". The country is its own fact.
- `founded` — the year (`YYYY`) or the full date as a source gives it.
- `weights_availability` — look at the company's flagship models on Hugging
  Face. `open-fully` (permissive license, no use restrictions),
  `open-with-restrictions` (weights out, but an acceptable-use policy or
  field-of-use limits), `research-only` (non-commercial), `gated` (access by
  request), `closed` (API only).
- `legal_structure` — `for-profit`, `pbc`, `llc`, `nonprofit` or `other`.
  **Do not infer it.** Claim it only when a source names the corporate form
  ("Anthropic PBC", an infobox "Type: Public benefit corporation"). "It has a
  ticker, so it is for-profit" is inference. With no source, claim `null`
  with the page you checked.
- `ownership` — `public` (shares trade on an exchange), `private`, or
  `subsidiary` (majority-owned by a parent; then also claim
  `parent_company`). A company that IPO'd is `public` even if its founders
  hold most shares.
- `employee_tier` — `<50`, `50-500`, `500-5k`, `5k-50k`, `50k+`. Use the
  company's own headcount, not its parent's.

**Finding missing pages.** Wikipedia: `site:en.wikipedia.org "<name>"`.
Hugging Face org: try `https://huggingface.co/<slug>`. GitHub org: try
`https://github.com/<slug>`.
