'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface SearchResult {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  status?: string;
  extra?: string;
  href: string;
}

// Left accent colour by entity type
const TYPE_COLOR: Record<string, string> = {
  subscription: '#286FAD',
  lead:         '#F59E0B',
  quote:        '#8B5CF6',
  domain:       '#0EA5E9',
  customer:     '#10B981',
};

const TYPE_LABEL: Record<string, string> = {
  subscription: 'Sub',
  lead:         'Lead',
  quote:        'Quote',
  domain:       'Domain',
  customer:     'Customer',
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

export function GlobalSearch() {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState<SearchResult[]>([]);
  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState(-1);
  const inputRef  = useRef<HTMLInputElement>(null);
  const boxRef    = useRef<HTMLDivElement>(null);
  const router    = useRouter();

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}&limit=15`, {
        credentials: 'include',
      });
      if (res.ok) setResults(await res.json() as SearchResult[]);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void search(query); }, 250);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && selected >= 0) {
      const r = results[selected];
      if (r) { router.push(r.href as never); setOpen(false); setQuery(''); }
    }
  };

  return (
    <div ref={boxRef} className="relative w-[420px]">
      <div className="relative">
        {/* Search icon */}
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setSelected(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder="Search… (Ctrl+K)"
          className="w-full pl-9 pr-4 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-[#286FAD]/30 focus:border-[#286FAD]/60 focus:bg-white transition-colors"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <span className="inline-block w-3.5 h-3.5 border-2 border-slate-200 border-t-[#286FAD] rounded-full animate-spin" />
          </span>
        )}
      </div>

      {open && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden max-h-[420px] overflow-y-auto">
          {results.length === 0 && !loading && (
            <p className="px-4 py-4 text-sm text-slate-400 text-center">No results for &ldquo;{query}&rdquo;</p>
          )}
          {results.map((r, i) => {
            const accentColor = TYPE_COLOR[r.type] ?? '#64748b';
            const typeLabel   = TYPE_LABEL[r.type] ?? r.type;
            return (
              <button
                key={r.id + r.type}
                type="button"
                onClick={() => { router.push(r.href as never); setOpen(false); setQuery(''); }}
                className={`w-full text-left flex items-stretch gap-0 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0 ${
                  i === selected ? 'bg-blue-50/70' : ''
                }`}
              >
                {/* Left accent strip */}
                <div className="w-1 shrink-0 rounded-l" style={{ backgroundColor: accentColor }} />

                <div className="flex items-start gap-2.5 px-3 py-2.5 flex-1 min-w-0">
                  {/* Type label chip */}
                  <span
                    className="shrink-0 mt-0.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: accentColor + '18', color: accentColor }}
                  >
                    {typeLabel}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-slate-800 truncate leading-tight">{r.title}</p>
                    {r.subtitle && (
                      <p className="text-[11px] text-slate-400 truncate mt-0.5 leading-tight">{r.subtitle}</p>
                    )}
                    {r.extra && (
                      <span className="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200/80">
                        {r.extra}
                      </span>
                    )}
                  </div>

                  {r.status && (
                    <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-semibold uppercase tracking-wide mt-0.5 self-start">
                      {r.status.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
