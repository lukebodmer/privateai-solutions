/**
 * Requests — what the dashboard asks Neuman's next run to do.
 *
 * The dashboard cannot start a Neuman run: the task API takes a browser
 * session, not a script (NEUMAN_FEEDBACK.md). So Onboard and Request update
 * each write a request here (the dashboard shows them as "Waiting for
 * Neuman"), and the task's `prepare` step takes the oldest one. When none
 * is waiting, it runs the sweep instead. Run now and the schedule do the
 * same.
 *
 *   queue/<created>-<kind>[-<type>-<slug>].json
 *     { id, kind, entity, title, created, onboarding? }
 *
 * `onboarding` carries what only the onboarding form knows — the seed URLs,
 * and a disambiguation when one was given — for the brief. The directory is
 * gitignored working state, like the runs.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ROOT } from './facts.mjs';

export const QUEUE_DIR = join(ROOT, 'queue');

/** Queue a request. A second request for the same kind and entity returns
 *  the one already waiting rather than asking for the same run twice. */
export function enqueue({ kind, entity = null, title, onboarding }) {
  const waiting = listQueue().find(r => r.kind === kind && r.entity === entity);
  if (waiting) return waiting;
  mkdirSync(QUEUE_DIR, { recursive: true });
  const created = new Date().toISOString();
  const id = [created.replace(/[:.]/g, '-'), kind, entity?.replace('/', '-')].filter(Boolean).join('-');
  const request = { id, kind, entity, title, created, ...(onboarding ? { onboarding } : {}) };
  writeFileSync(join(QUEUE_DIR, `${id}.json`), JSON.stringify(request, null, 2) + '\n', 'utf8');
  return request;
}

/** Every waiting request, oldest first. */
export function listQueue() {
  if (!existsSync(QUEUE_DIR)) return [];
  return readdirSync(QUEUE_DIR)
    .filter(name => name.endsWith('.json'))
    .map(name => JSON.parse(readFileSync(join(QUEUE_DIR, name), 'utf8')))
    .sort((a, b) => a.created.localeCompare(b.created));
}

/** Remove a request once a run has taken it, or Luke has dropped it. */
export function dequeue(id) {
  if (!listQueue().some(r => r.id === id)) throw new Error(`no queued request ${id}`);
  rmSync(join(QUEUE_DIR, `${id}.json`), { force: true });
}
