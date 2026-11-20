import { existsSync } from 'fs';
import { join } from 'path';

/** Extensions to try in order of preference */
const EXTENSIONS = ['svg', 'png', 'webp', 'jpg', 'ico'];

/**
 * Resolve a logo path for a given entity type and slug.
 * Checks the public/logos directory for matching files.
 */
export function resolveLogo(type: string, slug: string, custom?: string | null): string | null {
  if (custom) return custom;
  for (const ext of EXTENSIONS) {
    const path = `/logos/${type}/${slug}.${ext}`;
    const filePath = join(process.cwd(), 'public', path);
    if (existsSync(filePath)) return path;
  }
  return null;
}

/** A model's own logo, else its company's: most models carry the maker's mark. */
export function resolveModelLogo(slug: string, companySlug: string | null | undefined): string | null {
  return resolveLogo('models', slug) ?? (companySlug ? resolveLogo('companies', companySlug) : null);
}