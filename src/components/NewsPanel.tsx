import React, { useCallback, useEffect, useState } from 'react';
import TrashButton from './TrashButton';

/** The news panel of the admin dashboard: paste a link, and the admin
 *  server reads its title, source and publication date from the page
 *  (scripts/lib/news.mjs). Anything it reads wrong is corrected here. */

const ADMIN_ORIGIN = 'http://localhost:4322';

interface NewsItem {
  url: string;
  title: string;
  source: string;
  date: string;
  added: string;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ADMIN_ORIGIN}${path}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `${path} failed`);
  return data as T;
}

const inputClass = 'bg-nord-950 border border-nord-700 rounded px-2 py-1 text-xs text-nord-200 focus:outline-none focus:border-frost-600';

function EditRow({ item, onDone }: { item: NewsItem; onDone: (error?: string) => void }) {
  const [title, setTitle] = useState(item.title);
  const [source, setSource] = useState(item.source);
  const [date, setDate] = useState(item.date);
  const save = () => call('/news/update', { url: item.url, title, source, date })
    .then(() => onDone(), e => onDone(e.message));
  return (
    <li className="px-4 py-2 flex flex-wrap items-center gap-2">
      <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputClass} />
      <input value={title} onChange={e => setTitle(e.target.value)} className={`${inputClass} flex-1 min-w-[16rem]`} />
      <input value={source} onChange={e => setSource(e.target.value)} className={`${inputClass} w-40`} />
      <button onClick={save} className="text-xs px-2.5 py-1 rounded bg-frost-600 hover:bg-frost-500 text-white">Save</button>
      <button onClick={() => onDone()} className="text-xs text-nord-500 hover:text-nord-300">Cancel</button>
    </li>
  );
}

export default function NewsPanel() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    call<{ items: NewsItem[] }>('/news').then(d => setItems(d.items), e => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await call('/news/add', { url: url.trim(), title: title.trim() || undefined });
      setUrl('');
      setTitle('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = (item: NewsItem) => {
    if (!confirm(`Remove "${item.title}" from the feed?`)) return;
    call('/news/delete', { url: item.url }).then(load, err => setError(err.message));
  };

  return (
    <div className="border border-nord-800 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-nord-900">
        <h2 className="text-base font-semibold text-nord-100">News</h2>
      </div>
      <form onSubmit={add} className="px-4 py-2.5 border-b border-nord-800 bg-nord-900/40 flex flex-wrap items-center gap-2">
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://…"
          disabled={busy}
          className={`${inputClass} flex-1 min-w-[16rem]`}
        />
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Title (blank: read from the page)"
          disabled={busy}
          className={`${inputClass} flex-1 min-w-[16rem]`}
        />
        <button type="submit" disabled={busy || !url.trim()}
          className="text-xs px-2.5 py-1 rounded border border-frost-700 bg-frost-900/50 text-frost-200 hover:bg-frost-800/60 disabled:opacity-40">
          {busy ? 'Reading…' : 'Add'}
        </button>
      </form>
      {error && <p className="px-4 py-2 text-xs text-red-400">{error}</p>}
      {items.length === 0
        ? <p className="px-4 py-3 text-xs text-nord-500">No news yet.</p>
        : (
          <ul className="divide-y divide-nord-800/70">
            {items.map(item => editing === item.url
              ? <EditRow key={item.url} item={item} onDone={err => { setEditing(null); if (err) setError(err); load(); }} />
              : (
                <li key={item.url} className="px-4 py-1.5 flex items-baseline gap-3 text-xs group">
                  <span className="text-nord-500 tabular-nums whitespace-nowrap">{item.date}</span>
                  <a href={item.url} target="_blank" rel="noopener" className="text-nord-200 hover:text-frost-400 truncate">{item.title}</a>
                  <span className="text-nord-500 whitespace-nowrap">({item.source})</span>
                  <span className="ml-auto flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setEditing(item.url)} className="text-nord-400 hover:text-nord-200">Edit</button>
                    <TrashButton title={`Remove "${item.title}"`} onClick={() => remove(item)} />
                  </span>
                </li>
              ))}
          </ul>
        )}
    </div>
  );
}
