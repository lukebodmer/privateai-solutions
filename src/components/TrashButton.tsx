import React from 'react';

/** The admin dashboard's delete control: a small trash can that turns red on hover. */
export default function TrashButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      className="p-1 rounded text-nord-600 hover:text-red-400 hover:bg-red-950/40 transition-colors">
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5" />
      </svg>
    </button>
  );
}
