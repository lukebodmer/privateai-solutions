#!/usr/bin/env node
/**
 * Dev server — starts Astro + admin write-back server together.
 * Both processes get cleaned up on exit.
 */

import { spawn, spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { startAdminServer } from './admin-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Deterministic pre-fills — the trusted-API syncs, then Neuman's docs from
// main (scripts/fetch-docs.mjs). Each sync self-gates on freshness (24h); all
// fail soft on missing key / network.
// --env-file-if-exists loads AA_API_KEY, OPENROUTER_API_KEY, GITHUB_TOKEN and
// RESEARCH_ROOT from .env.
for (const script of ['scripts/sync-aa.mjs', 'scripts/sync-arena.mjs', 'scripts/sync-openrouter.mjs', 'scripts/sync-hf.mjs', 'scripts/sync-github.mjs', 'scripts/fetch-docs.mjs']) {
  spawnSync('node', ['--env-file-if-exists=.env', join(ROOT, script)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env },
  });
}

const adminServer = startAdminServer();

const astro = spawn('pnpm', ['exec', 'astro', 'dev'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env },
});

['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(sig => {
  process.on(sig, () => {
    astro.kill(sig);
    adminServer.close();
    process.exit(0);
  });
});

astro.on('close', code => {
  adminServer.close();
  process.exit(code ?? 0);
});
