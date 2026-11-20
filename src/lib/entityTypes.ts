/**
 * Pure constants for entity typing — safe to import from browser-bundled
 * code (no Node built-ins). The full loader (`src/lib/facts.ts`) uses
 * `fs`/`path` and is Node-only.
 */
import type { EntityType } from '../data/schemas/factSchemas';

export const ENTITY_DIR: Record<EntityType, string> = {
  model: 'models',
  build: 'builds',
  part: 'parts',
  company: 'companies',
  harness: 'harnesses',
};
