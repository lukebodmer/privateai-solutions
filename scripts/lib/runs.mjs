/**
 * Runs — one execution of the Neuman task that keeps this site up to date.
 *
 * Neuman makes each run's directory under the task's run root, which is
 * PRIVATEAI_RUNS_DIR here, and the task's three steps fill it:
 *
 *   <id>/neuman-run.json  Neuman's record of the run: status, each step, cost
 *   <id>/run.json         what the run is for (`pnpm prepare`)
 *   <id>/brief.md         the instructions the research step follows (`pnpm prepare`)
 *   <id>/claims.json      the research step's output: an array of claims
 *   <id>/report.md        the research step's summary, free text
 *   <id>/result.json      the checker's verdict on every claim, and the
 *                         review queue's decisions (`pnpm check`)
 *
 * The research step's envelope lets it write its own run directory and
 * nothing else, and everything it says passes the checker before it reaches
 * the site. The run root is outside this repository because the task's
 * commands run here: Neuman refuses a task whose agent step could write
 * what a command runs. A run is working state; what it changed is in the
 * entity files and changes.jsonl.
 */

import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';

export const RUNS_DIR = process.env.PRIVATEAI_RUNS_DIR || null;

function runsDir() {
  if (!RUNS_DIR) throw new Error('PRIVATEAI_RUNS_DIR is not set — it must be the Neuman task\'s run root');
  return RUNS_DIR;
}

export function runDir(id) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,120}$/.test(id)) throw new Error(`bad run id: ${id}`);
  return join(runsDir(), id);
}

/** The run a task command is part of, from the environment Neuman gives it.
 *  Refuses a run directory outside PRIVATEAI_RUNS_DIR, which would leave the
 *  dashboard and the checker looking somewhere else. */
export function currentRunId() {
  const dir = process.env.NEUMAN_RUN_DIR;
  if (!dir) throw new Error('NEUMAN_RUN_DIR is not set — this runs as a step of the Neuman task');
  if (dirname(dir) !== runsDir()) {
    throw new Error(`NEUMAN_RUN_DIR (${dir}) is not inside PRIVATEAI_RUNS_DIR (${runsDir()})`);
  }
  return basename(dir);
}

/** Write what the run is for into the directory Neuman made. `brief` is a
 *  function of the run id, which the brief names. Returns run.json. */
export function writeRun(id, { kind, entity, title, brief }) {
  const dir = runDir(id);
  if (!existsSync(dir)) throw new Error(`${dir} does not exist — Neuman makes it before the first step`);
  const run = { id, kind, entity: entity ?? null, title, created: new Date().toISOString() };
  writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2) + '\n', 'utf8');
  writeFileSync(join(dir, 'brief.md'), brief(id), 'utf8');
  return run;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

export function readRun(id) {
  return readJson(join(runDir(id), 'run.json'));
}

/** Neuman's own record: the `task-run` contract, written when the run
 *  starts and again when it ends. */
export function readNeuman(id) {
  return readJson(join(runDir(id), 'neuman-run.json'));
}

export function readBrief(id) {
  const path = join(runDir(id), 'brief.md');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** The research step's claims, or null if it has not written any. A file
 *  that is not a JSON array is reported, not guessed at. */
export function readClaims(id) {
  const path = join(runDir(id), 'claims.json');
  if (!existsSync(path)) return null;
  const claims = readJson(path);
  if (!Array.isArray(claims)) throw new Error(`${id}/claims.json is not a JSON array`);
  return claims;
}

export function readResult(id) {
  return readJson(join(runDir(id), 'result.json'));
}

export function writeResult(id, result) {
  writeFileSync(join(runDir(id), 'result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
}

export function readReport(id) {
  const path = join(runDir(id), 'report.md');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** Remove a run's directory. Refuses a run Neuman is still working on,
 *  whose steps would lose the directory under them. */
export function deleteRun(id) {
  const dir = runDir(id);
  if (!existsSync(dir)) throw new Error(`no run ${id}`);
  const status = readNeuman(id)?.status;
  if (status === 'running' || status === 'due' || status === 'waiting') throw new Error(`run ${id} is ${status} — stop it in Neuman first`);
  rmSync(dir, { recursive: true, force: true });
}

/** What the dashboard shows for Neuman's side of a run: its status, the
 *  step it is on or failed at, and what it cost. */
function neumanSummary(record) {
  if (!record) return null;
  const steps = record.steps ?? [];
  const current = steps.find(s => s.status === 'running') ?? steps.find(s => s.status === 'failed' || s.status === 'cancelled');
  return {
    status: record.status,
    step: current?.name ?? null,
    error: current?.error ?? record.error ?? null,
    cost_usd: record.cost_usd ?? null,
  };
}

/** Every run, newest first, with where it stands. */
export function listRuns() {
  if (!RUNS_DIR || !existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR)
    .map(id => {
      const dir = join(RUNS_DIR, id);
      const neuman = readJson(join(dir, 'neuman-run.json'));
      const run = readJson(join(dir, 'run.json'));
      if (!neuman && !run) return null;
      const result = readJson(join(dir, 'result.json'));
      const hasClaims = existsSync(join(dir, 'claims.json'));
      const pending = result ? result.claims.filter(c => c.outcome === 'review' && !c.decision).length : 0;
      const status = result ? (pending > 0 ? 'review' : 'done')
        : neuman?.status === 'running' || neuman?.status === 'due' || neuman?.status === 'waiting' ? 'running'
        : hasClaims ? 'claimed'
        : 'failed';
      return {
        id,
        kind: run?.kind ?? null,
        entity: run?.entity ?? null,
        title: run?.title ?? 'Run that did not get past prepare',
        created: run?.created ?? neuman?.started_at ?? neuman?.created_at ?? '',
        status,
        pending,
        checked: result?.checked ?? null,
        neuman: neumanSummary(neuman),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.created.localeCompare(a.created));
}
