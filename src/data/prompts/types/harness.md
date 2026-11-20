## Notes for harnesses

**Identity.** Harness names collide, and popular projects have forks under
other names. Confirm the repository is the project Luke named.

**Not yours:** `license` and `language` come from GitHub's API once
`snapshot.github` is right.

- `developer` — the maintainer's display name, as the repo or site gives it.
- `developer_company_slug` — only if the developer is a file in
  `src/data/companies/`; otherwise leave it out. Never invent a slug.
- `license_commercial` — read the LICENSE file. MIT and Apache-2.0 permit
  commercial use; AGPL and SSPL carry conditions worth a note.
- `philosophy` — two to four words for what the project is, in its own words
  where possible ("minimal git-native editor", "Claude Code-style TUI").
- `install_method` — the command the project tells users to run first,
  copied exactly. If it has a bootstrap installer distinct from the package
  (`pip install aider-install`), the bootstrap is the canonical one.

**Finding missing pages.** `snapshot.docs`: the README's badges or nav,
`<site>/docs/`, `docs.<site>`. `snapshot.package`: npmjs.com, pypi.org,
crates.io. `snapshot.website`: the repo's "Website" link.
