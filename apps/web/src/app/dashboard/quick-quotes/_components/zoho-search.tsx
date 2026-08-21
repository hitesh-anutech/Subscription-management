'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

interface CacheEntry {
  id: string;
  zohoId: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
}

interface ZohoItemEntry {
  id: string;
  zohoId: string;
  displayName: string | null;
  extra: Record<string, unknown> | null;
}

// ------------------------------------------------------------------
// Customer Search
// ------------------------------------------------------------------
export function ZohoCustomerSearch({
  orgId,
  onSelect,
}: {
  orgId: string;
  onSelect: (id: string, name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CacheEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (!orgId || q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/organizations/${orgId}/cache/customers?q=${encodeURIComponent(q)}&limit=10`,
        { credentials: 'include' },
      );
      if (res.ok) setResults(await res.json() as CacheEntry[]);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => {
    const t = setTimeout(() => void search(query), 250);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={orgId ? 'Customer name / email / GSTIN search…' : 'पहले Organization select करो'}
        disabled={!orgId}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
      />
      {loading && <span className="absolute right-3 top-2.5 text-xs text-slate-400 animate-pulse">…</span>}

      {open && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-30 max-h-52 overflow-y-auto">
          {results.length === 0 && !loading && (
            <p className="px-3 py-2 text-xs text-slate-400">No customers found — पहले sync करो</p>
          )}
          {results.map((c) => (
            <button key={c.id} type="button"
              onClick={() => {
                onSelect(c.zohoId, c.displayName ?? c.zohoId);
                setQuery(c.displayName ?? c.zohoId);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
            >
              <p className="text-sm font-medium text-slate-800">{c.displayName}</p>
              <p className="text-xs text-slate-400">{c.email ?? ''}{c.gstin ? ` · ${c.gstin}` : ''}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Customer Search across ALL orgs — the quote's org auto-derives from
// the picked customer (Zoho customer IDs are org-specific; BUG-017).
// ------------------------------------------------------------------
interface CrossOrgCustomer extends CacheEntry {
  organizationId: string;
  organization: { name: string } | null;
}

export function ZohoCustomerSearchAllOrgs({
  onSelect,
}: {
  onSelect: (c: { zohoId: string; name: string; orgId: string; orgName: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CrossOrgCustomer[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/customers/cross-org-search?q=${encodeURIComponent(q)}&limit=10`,
        { credentials: 'include' },
      );
      if (res.ok) setResults(await res.json() as CrossOrgCustomer[]);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void search(query), 250);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Customer name / email / GSTIN search (सभी orgs में)…"
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {loading && <span className="absolute right-3 top-2.5 text-xs text-slate-400 animate-pulse">…</span>}

      {open && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-30 max-h-52 overflow-y-auto">
          {results.length === 0 && !loading && (
            <p className="px-3 py-2 text-xs text-slate-400">No customers found — पहले orgs sync करो</p>
          )}
          {results.map((c) => (
            <button key={c.id} type="button"
              onClick={() => {
                onSelect({
                  zohoId: c.zohoId,
                  name: c.displayName ?? c.zohoId,
                  orgId: c.organizationId,
                  orgName: c.organization?.name ?? '',
                });
                setQuery(c.displayName ?? c.zohoId);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-800">{c.displayName}</p>
                <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
                  {c.organization?.name ?? '—'}
                </span>
              </div>
              <p className="text-xs text-slate-400">{c.email ?? ''}{c.gstin ? ` · ${c.gstin}` : ''}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Item Search — controlled: value/onChange for typing, onSelect for dropdown pick
// ------------------------------------------------------------------
export function ZohoItemSearch({
  orgId,
  value,
  onChange,
  onSelect,
}: {
  orgId: string;
  value: string;
  onChange: (name: string) => void;
  onSelect: (zohoItemId: string, name: string, rate: number, description: string) => void;
}) {
  const [results, setResults] = useState<ZohoItemEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (!orgId || q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/organizations/${orgId}/cache/items?q=${encodeURIComponent(q)}&limit=10`,
        { credentials: 'include' },
      );
      if (res.ok) setResults(await res.json() as ZohoItemEntry[]);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => {
    const t = setTimeout(() => void search(value), 250);
    return () => clearTimeout(t);
  }, [value, search]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={boxRef} className="relative flex-1">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={orgId ? 'Item search या manually type करो…' : 'Item name type करो'}
        className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {loading && <span className="absolute right-2 top-1.5 text-xs text-slate-400 animate-pulse">…</span>}

      {open && value.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-lg shadow-lg z-30 max-h-44 overflow-y-auto">
          {results.length === 0 && !loading && (
            <p className="px-3 py-2 text-xs text-slate-500">
              Items नहीं मिले —{' '}
              <span className="text-amber-600 font-medium">ऊपर 🔄 Sync Items button click करो</span>
              <br />
              <span className="text-slate-400">या item name manually type करो।</span>
            </p>
          )}
          {results.map((item) => {
            const extra = item.extra as Record<string, unknown> ?? {};
            const rate  = Number(extra['rate'] ?? 0);
            const hsn   = String(extra['hsn_or_sac'] ?? '');
            const desc  = String(extra['description'] ?? extra['item_description'] ?? '');
            return (
              <button key={item.id} type="button"
                onClick={() => {
                  onSelect(item.zohoId, item.displayName ?? item.zohoId, rate, desc);
                  onChange(item.displayName ?? item.zohoId);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-50 border-b border-slate-100 last:border-0"
              >
                <p className="text-sm font-medium text-slate-800">{item.displayName}</p>
                {desc && <p className="text-xs text-slate-500 truncate">{desc}</p>}
                <p className="text-xs text-slate-400">
                  {rate > 0 ? `₹${rate.toLocaleString('en-IN')}` : ''}
                  {hsn ? ` · HSN ${hsn}` : ''}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
