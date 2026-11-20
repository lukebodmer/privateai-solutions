/**
 * Reader for src/data/news.json, which the admin dashboard writes
 * (scripts/lib/news.mjs). Already sorted newest first.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface NewsItem {
  url: string;
  title: string;
  source: string;
  date: string;
  added: string;
}

export function loadNews(): NewsItem[] {
  const path = join(process.cwd(), 'src/data/news.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
}
