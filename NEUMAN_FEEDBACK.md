# What running this site on Neuman teaches Neuman

This site is Neuman's first real unattended workload: a daily task of
commands and one research step, run on Luke's account inside an envelope,
whose output a machine checks. Every time a run is awkward, the reason goes
here — the list is the requirements for Neuman's task feature, and the
evidence for each one.

Each entry: what happened, what we did instead, and what Neuman would need.
Delete an entry when Neuman ships what it asks for and this site uses it.

---

## F1 — The dashboard cannot start a run

**What happened.** Onboarding and refreshing are dashboard clicks, but
Neuman's task API authenticates a browser session with a CSRF token, and a
script has neither.

**Instead.** The dashboard queues a request (`queue/`), and Run now on the
task in Neuman takes the oldest one (or sweeps when none is waiting). Two
clicks in two windows instead of one.

**Neuman would need.** An account-scoped API token for scripts, limited to
running and reading named tasks.

## F2 — Sites refuse automated fetches the agent's browser gets through

**What happened.** TechPowerUp answers a plain HTTP fetch with a bot-check
page (HTTP 200, no specs). Neuman's `browse` would get through, but the
checker deliberately does not use a browser, so claims citing it go to
review. Retailers are likely to behave the same way for prices.

**Instead.** The checker names the bot wall in the review reason, and the
claims protocol tells Neuman to prefer pages that print values in plain
text and load without JavaScript. The research step's envelope does not
grant `browse`.

**Neuman would need.** Nothing, probably — this is the cost of a checker
that trusts only its own fetch. Worth measuring over the first weeks of
sweeps: if most price claims land in review, the answer is a price API
(see PLAN.md), not a weaker checker.

## F3 — `web_fetch` returns raw HTML

**What happened.** The model reads markup and must quote "as a reader sees
it", which is easy to get subtly wrong across tags.

**Instead.** The checker compares words and numbers only, ignoring
punctuation and markup.

**Neuman would need.** Possibly a text rendering mode for `web_fetch`, if
quotes keep failing on markup boundaries. Measure first.

## F4 — A task's commands cannot use a provider key Neuman holds

**What happened.** The site's OpenRouter sync runs in the task's `prepare`
step and is better with an OpenRouter key. Neuman already holds one, for
the research step's model, but by design a key is readable only by Neuman
and a run step's environment carries only `NEUMAN_*` variables.

**Instead.** The key sits in this repository's `.env` as well, read by the
scripts as Luke — a second copy of a secret Neuman already manages.

**Neuman would need.** A way for a task to grant a named secret to its run
steps (as an environment variable, recorded in the run), so a key lives
in one place and its use by a task is visible.
