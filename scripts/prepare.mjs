#!/usr/bin/env node
/**
 * The Neuman task's first step: everything before the research.
 *
 *   nix develop -c pnpm task:prepare     (a step of the Neuman task)
 *
 * 1. Runs the API syncs (each fails soft, self-gates to once a day,
 *    and records its changes).
 * 2. Takes the oldest request the dashboard queued — an onboarding or a
 *    refresh. When none is waiting, it runs the sweep: prices, facts due
 *    for a re-check, and a look for new releases.
 * 3. Writes run.json and brief.md into the run directory Neuman made, which
 *    the research step then reads.
 *
 * The research step follows the brief; `pnpm check` runs after it.
 */

import { spawnSync } from 'child_process';
import { join } from 'path';
import { ROOT, readEntity } from './lib/facts.mjs';
import { onboardBrief, refreshBrief, sweepBrief } from './lib/briefs.mjs';
import { dequeue, listQueue } from './lib/queue.mjs';
import { currentRunId, writeRun } from './lib/runs.mjs';

function briefFor(request) {
  if (request.kind === 'sweep') return sweepBrief();
  const [type, slug] = (request.entity ?? '').split('/');
  if (!readEntity(type, slug)) throw new Error(`request ${request.id}: no ${request.entity}`);
  if (request.kind === 'refresh') return refreshBrief({ type, slug });
  if (request.kind === 'onboard') {
    const { disambiguation, seed } = request.onboarding ?? {};
    return onboardBrief({ type, slug, disambiguation, seed });
  }
  throw new Error(`request ${request.id}: unknown kind ${request.kind}`);
}

function main() {
  const id = currentRunId();
  const queued = listQueue()[0];
  const request = queued ?? { id: null, kind: 'sweep', entity: null, title: 'Weekly check' };

  for (const script of ['sync-aa.mjs', 'sync-arena.mjs', 'sync-openrouter.mjs', 'sync-hf.mjs', 'sync-github.mjs']) {
    spawnSync(process.execPath, ['--env-file-if-exists=.env', join(ROOT, 'scripts', script)], { cwd: ROOT, stdio: 'inherit' });
  }

  const run = writeRun(id, { kind: request.kind, entity: request.entity, title: request.title, brief: briefFor(request) });
  // Taken only once the brief is written, so a prepare that fails leaves
  // the request for the next run.
  if (request.id) dequeue(request.id);
  console.log(`[prepare] ${run.id}: ${run.title}`);
}

try {
  main();
} catch (err) {
  console.error(`[prepare] ${err.message}`);
  process.exit(1);
}
