'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

export function CreateNewButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/10 active:scale-[0.98] transition-all flex items-center gap-2"
      >
        + Create New
        <span className={`text-[10px] transition-transform duration-150 inline-block ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden min-w-[160px]">
          <Link
            href="/dashboard/leads/new"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-3 text-xs font-bold text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors border-b border-slate-100"
          >
            <span className="text-sm">🎯</span> New Lead
          </Link>
          <Link
            href="/dashboard/quick-quotes/new"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-3 text-xs font-bold text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
          >
            <span className="text-sm">📄</span> New Quote
          </Link>
        </div>
      )}
    </div>
  );
}
