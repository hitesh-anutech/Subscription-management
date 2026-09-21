'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { CustomizeColumnsModal, type CustomizableColumn } from '@/components/customize-columns-modal';
import { syncCustomersAction } from '../actions';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

interface Org { id: string; name: string; isActive?: boolean }
interface CustomerRow { zohoId: string; fields: Record<string, string | number> }
interface SavedView {
  id: string; name: string; orgId?: string;
  columns: string[]; sort?: { key: string; dir: 'asc' | 'desc' } | null; search?: string;
}

const DEFAULT_COLUMNS = ['displayName', 'email', 'phone', 'gstin', 'active_subscriptions', 'expired_subscriptions'];

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  inactive: 'bg-slate-200 text-slate-500',
  enabled: 'bg-emerald-100 text-emerald-700',
  disabled: 'bg-slate-200 text-slate-500',
  crm: 'bg-blue-100 text-blue-700',
};

const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', AUD: 'A$', CAD: 'C$', JPY: '¥',
};

function fmtDate(v: string): string {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtMoney(v: number, currency: string): string {
  const sym = CURRENCY_SYMBOL[(currency || 'INR').toUpperCase()] ?? `${currency} `;
  return `${sym}${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function CustomersBrowser({ isAdmin = false }: { isAdmin?: boolean }) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const [catalog, setCatalog] = useState<CustomizableColumn[]>([]);
  const [selectedCols, setSelectedCols] = useState<string[]>(DEFAULT_COLUMNS);
  const [showColsModal, setShowColsModal] = useState(false);

  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const [views, setViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState('');

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchMounted = useRef(false);
  const orgsRef = useRef<Org[]>([]);

  const [importing, startImport] = useTransition();
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // dropdown open states
  const [viewsOpen, setViewsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const viewsRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLDivElement>(null);

  const colByKey = useMemo(() => new Map(catalog.map(c => [c.key, c])), [catalog]);

  // keep orgsRef in sync
  useEffect(() => { orgsRef.current = orgs; }, [orgs]);

  // close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (viewsRef.current && !viewsRef.current.contains(e.target as Node)) setViewsOpen(false);
      if (importRef.current && !importRef.current.contains(e.target as Node)) setImportOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ---- initial load ----
  useEffect(() => {
    fetch(`${API_BASE}/organizations`, { credentials: 'include' })
      .then(r => r.json())
      .then((d: { organizations: Org[] }) => {
        const active = (d.organizations ?? []).filter(o => o.isActive !== false);
        setOrgs(active);
        if (active[0]) setOrgId(active[0].id);
      })
      .catch(() => setMsg('Organizations load nahi ho paaye'));
    fetch(`${API_BASE}/customer-views`, { credentials: 'include' })
      .then(r => r.json())
      .then((d: SavedView[]) => setViews(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  // ---- load columns ----
  const loadColumns = useCallback(async (oid: string) => {
    if (!oid) return;
    try {
      const res = await fetch(`${API_BASE}/organizations/${oid}/customer-columns`, { credentials: 'include' });
      const d = await res.json() as { columns: CustomizableColumn[] };
      setCatalog(d.columns ?? []);
    } catch { setCatalog([]); }
  }, []);

  // ---- fetch rows — supports orgId='' (all companies) ----
  const fetchRows = useCallback(async (oid: string, q: string, goToPage: number, pp: number) => {
    setLoading(true);
    try {
      if (oid) {
        // single org
        const p = new URLSearchParams({ q, page: String(goToPage), limit: String(pp) });
        const res = await fetch(`${API_BASE}/organizations/${oid}/customer-rows?${p}`, { credentials: 'include' });
        if (!res.ok) { setMsg('❌ Customers load nahi ho paaye'); setRows([]); setTotal(0); return; }
        const d = await res.json() as { rows: CustomerRow[]; total: number; page: number };
        setRows(d.rows ?? []); setTotal(d.total ?? 0); setPage(d.page ?? goToPage);
        setMsg((d.rows?.length ?? 0) === 0 ? 'Koi customer nahi mila.' : null);
      } else {
        // all companies — parallel fetch, client-side paginate
        const allOrgs = orgsRef.current;
        if (allOrgs.length === 0) { setRows([]); setTotal(0); setLoading(false); return; }
        const allParams = new URLSearchParams({ q, page: '1', limit: '1000' });
        const results = await Promise.all(
          allOrgs.map(o =>
            fetch(`${API_BASE}/organizations/${o.id}/customer-rows?${allParams}`, { credentials: 'include' })
              .then(r => r.ok ? r.json() as Promise<{ rows: CustomerRow[] }> : { rows: [] as CustomerRow[] })
              .catch(() => ({ rows: [] as CustomerRow[] })),
          ),
        );
        const all = results.flatMap(d => d.rows ?? []);
        const start = (goToPage - 1) * pp;
        setRows(all.slice(start, start + pp)); setTotal(all.length); setPage(goToPage);
        setMsg(all.length === 0 ? 'Koi customer nahi mila.' : null);
      }
    } catch {
      setMsg('Server se connect nahi ho paaya');
      setRows([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // org change → reload catalog + rows
  useEffect(() => {
    void loadColumns(orgId || orgsRef.current[0]?.id || '');
    void fetchRows(orgId, query, 1, perPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // live search debounce
  useEffect(() => {
    if (!searchMounted.current) { searchMounted.current = true; return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setQuery(search);
      void fetchRows(orgId, search, 1, perPage);
    }, 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const runSearch = () => { setQuery(search); void fetchRows(orgId, search, 1, perPage); };
  const clearSearch = () => { setSearch(''); setQuery(''); void fetchRows(orgId, '', 1, perPage); };
  const changePerPage = (pp: number) => { setPerPage(pp); void fetchRows(orgId, query, 1, pp); };
  const gotoPage = (n: number) => void fetchRows(orgId, query, n, perPage);

  const runImport = () => {
    setImportMsg(null);
    startImport(async () => {
      const targetOrg = orgId || orgsRef.current[0]?.id || '';
      const res = await syncCustomersAction(targetOrg);
      if (res.error) setImportMsg(`❌ ${res.error}`);
      else {
        setImportMsg(`✅ Synced ${res.synced ?? 0}`);
        await loadColumns(targetOrg);
        await fetchRows(orgId, query, 1, perPage);
      }
    });
  };

  // client-side sort
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = colByKey.get(sort.key);
    const numeric = col?.type === 'currency' || col?.type === 'number';
    return [...rows].sort((a, b) => {
      const av = a.fields[sort.key] ?? '';
      const bv = b.fields[sort.key] ?? '';
      const cmp = numeric ? Number(av) - Number(bv) : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, colByKey]);

  const toggleSort = (key: string) =>
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });

  const renderCell = (row: CustomerRow, key: string) => {
    const col = colByKey.get(key);
    const raw = row.fields[key];
    if (key === 'displayName') {
      const name = String(raw || row.zohoId);
      const linkOrgId = orgId || orgsRef.current[0]?.id || '';
      return (
        <Link href={`/dashboard/customers/${row.zohoId}?org_id=${linkOrgId}`} className="font-medium text-blue-700 hover:underline">
          {name}
        </Link>
      );
    }
    if (col?.type === 'status') {
      const s = String(raw ?? '').toLowerCase();
      if (!s) return <span className="text-slate-400">—</span>;
      return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[s] ?? 'bg-slate-100 text-slate-600'}`}>{String(raw)}</span>;
    }
    if (col?.type === 'currency') return <span className="tabular-nums">{fmtMoney(Number(raw), String(row.fields.currency_code ?? 'INR'))}</span>;
    if (col?.type === 'date') return <span>{fmtDate(String(raw ?? ''))}</span>;
    if (col?.type === 'number') return <span className="tabular-nums">{raw == null || raw === '' ? '—' : String(raw)}</span>;
    if (key === 'gstin') return <span className="font-mono text-xs text-slate-500">{raw ? String(raw) : '—'}</span>;
    const v = raw == null || raw === '' ? '—' : String(raw);
    return <span title={v}>{v}</span>;
  };

  // CSV export
  const exportCsv = () => {
    const cols = selectedCols.map(k => colByKey.get(k)).filter((c): c is CustomizableColumn => !!c);
    const header = cols.map(c => `"${c.label}"`).join(',');
    const lines = sortedRows.map(r =>
      cols.map(c => `"${String(r.fields[c.key] ?? '').replace(/"/g, '""')}"`).join(','),
    );
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // saved views
  const applyView = (view: SavedView) => {
    setActiveViewId(view.id);
    setSelectedCols(view.columns.length ? view.columns : DEFAULT_COLUMNS);
    setSort(view.sort ?? null);
    const q = view.search ?? '';
    setSearch(q); setQuery(q);
    if (view.orgId && orgs.some(o => o.id === view.orgId) && view.orgId !== orgId) {
      setOrgId(view.orgId);
    } else {
      void fetchRows(orgId, q, 1, perPage);
    }
    setMsg(`View "${view.name}" applied.`);
  };

  const saveCurrentView = async () => {
    const name = prompt('Is view ka naam?');
    if (!name?.trim()) return;
    const view: SavedView = { id: '', name: name.trim(), orgId, columns: selectedCols, sort, search: query };
    try {
      const res = await fetch(`${API_BASE}/customer-views`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(view),
      });
      const list = await res.json() as SavedView[];
      setViews(Array.isArray(list) ? list : []);
      const created = list.find(v => v.name === view.name);
      if (created) setActiveViewId(created.id);
      setMsg(`✅ View "${view.name}" saved.`);
    } catch { setMsg('View save nahi ho paaya'); }
  };

  const deleteView = async (id: string) => {
    if (!confirm('Ye saved view delete karein?')) return;
    try {
      const res = await fetch(`${API_BASE}/customer-views/${id}`, { method: 'DELETE', credentials: 'include' });
      const list = await res.json() as SavedView[];
      setViews(Array.isArray(list) ? list : []);
      if (activeViewId === id) setActiveViewId('');
    } catch { setMsg('View delete nahi ho paaya'); }
  };

  const shownCols = selectedCols.map(k => colByKey.get(k)).filter((c): c is CustomizableColumn => !!c);
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const activeView = views.find(v => v.id === activeViewId);

  return (
    <div className="space-y-3">
      {/* ── Compact single-row header ── */}
      <div className="flex items-center gap-2 bg-white border border-slate-200/80 px-3 py-2 rounded-2xl shadow-sm flex-wrap">

        {/* Title + count */}
        <div className="flex items-center gap-2 shrink-0 mr-1">
          <h1 className="text-base font-extrabold text-slate-900 tracking-tight">Customers</h1>
          <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 border border-slate-200/60 px-2 py-0.5 rounded-lg whitespace-nowrap">
            {total} total
          </span>
        </div>

        <div className="w-px h-5 bg-slate-200 shrink-0" />

        {/* Search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
          placeholder="Search name, email, GSTIN…"
          className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-slate-50/50"
        />

        {/* Company dropdown */}
        <select
          value={orgId}
          onChange={e => { setActiveViewId(''); setOrgId(e.target.value); }}
          className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
        >
          <option value="">All Companies</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>

        {/* Search + Clear */}
        <button type="button" onClick={runSearch}
          className="px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold rounded-lg shadow-sm active:scale-[0.98] transition-all shrink-0">
          Search
        </button>
        {query && (
          <button type="button" onClick={clearSearch}
            className="px-2.5 py-1.5 border border-slate-200 text-slate-500 text-xs font-semibold rounded-lg hover:bg-slate-50 transition-all shrink-0">
            Clear
          </button>
        )}

        <div className="w-px h-5 bg-slate-200 shrink-0" />

        {/* Views dropdown */}
        <div ref={viewsRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => { setViewsOpen(v => !v); setImportOpen(false); }}
            className={`px-2.5 py-1.5 border text-xs font-bold rounded-lg transition-all whitespace-nowrap flex items-center gap-1 ${
              viewsOpen || activeViewId
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'border-slate-200 text-slate-700 bg-white hover:bg-slate-50'
            }`}
          >
            ⚙ Views{activeView ? ` · ${activeView.name}` : ''} <span className="text-[10px] opacity-60">▾</span>
          </button>
          {viewsOpen && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden py-1">
              {views.length === 0 && (
                <p className="px-4 py-2 text-[11px] text-slate-400 italic">No saved views yet.</p>
              )}
              {views.map(v => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => { applyView(v); setViewsOpen(false); }}
                  className={`w-full text-left px-4 py-2 text-xs font-semibold transition-colors flex items-center justify-between gap-2 ${
                    activeViewId === v.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="truncate">{v.name}</span>
                  {activeViewId === v.id && <span className="shrink-0 text-indigo-500">✓</span>}
                </button>
              ))}
              {views.length > 0 && <div className="border-t border-slate-100 my-1" />}
              <button
                type="button"
                onClick={() => { void saveCurrentView(); setViewsOpen(false); }}
                className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                💾 Save current view
              </button>
              {activeViewId && (
                <button
                  type="button"
                  onClick={() => { void deleteView(activeViewId); setViewsOpen(false); }}
                  className="w-full text-left px-4 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 transition-colors"
                >
                  🗑 Delete this view
                </button>
              )}
              <div className="border-t border-slate-100 my-1" />
              <button
                type="button"
                onClick={() => { setShowColsModal(true); setViewsOpen(false); }}
                className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                ⚙ Customize Columns ({shownCols.length})
              </button>
            </div>
          )}
        </div>

        {/* Import/Export dropdown */}
        <div ref={importRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => { setImportOpen(v => !v); setViewsOpen(false); }}
            className={`px-2.5 py-1.5 border text-xs font-bold rounded-lg transition-all whitespace-nowrap flex items-center gap-1 ${
              importOpen ? 'bg-slate-100 border-slate-300 text-slate-800' : 'border-slate-200 text-slate-700 bg-white hover:bg-slate-50'
            }`}
          >
            {importing ? '⏳' : '↓'} Import <span className="text-[10px] opacity-60">▾</span>
          </button>
          {importOpen && (
            <div className="absolute top-full right-0 mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden py-1">
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => { runImport(); setImportOpen(false); }}
                  disabled={importing}
                  className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  🔄 Import from Zoho
                </button>
              )}
              <button
                type="button"
                onClick={() => { exportCsv(); setImportOpen(false); }}
                disabled={rows.length === 0}
                className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                ⬇ Export CSV
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Notification messages */}
      {(msg || importMsg) && (
        <div className="text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200/50 rounded-xl px-4 py-2">
          {importMsg ?? msg}
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
        {rows.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="font-bold text-slate-700">{loading ? '⏳ Loading…' : 'कोई customer नहीं मिला'}</p>
            {!loading && <p className="text-xs mt-1 text-slate-500">↓ Import dropdown se customers sync karo.</p>}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/50 backdrop-blur-md border-b border-slate-200/60">
                  <tr>
                    {shownCols.map(c => (
                      <th key={c.key} onClick={() => toggleSort(c.key)}
                        className="text-left px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-slate-800 transition-colors">
                        {c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedRows.map(row => (
                    <tr key={row.zohoId} className="hover:bg-slate-50/70 transition-colors">
                      {shownCols.map(c => (
                        <td key={c.key} className="px-5 py-3 text-slate-700 whitespace-nowrap max-w-xs truncate text-xs font-semibold">
                          {renderCell(row, c.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-5 py-4 border-t border-slate-200/60 flex items-center justify-between text-xs text-slate-400 font-semibold bg-slate-50/20">
              <div className="flex items-center gap-3">
                <span>Page {page} of {totalPages} · {total} total</span>
                <select value={perPage} onChange={e => changePerPage(Number(e.target.value))}
                  className="px-2 py-1 border border-slate-200 rounded-lg text-xs font-bold bg-white focus:outline-none">
                  {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}/page</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={page <= 1 || loading} onClick={() => gotoPage(page - 1)}
                  className="px-3.5 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 disabled:opacity-40 font-bold transition-colors">← Prev</button>
                <button type="button" disabled={page >= totalPages || loading} onClick={() => gotoPage(page + 1)}
                  className="px-3.5 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 disabled:opacity-40 font-bold transition-colors">Next →</button>
              </div>
            </div>
          </>
        )}
      </div>

      {showColsModal && (
        <CustomizeColumnsModal
          columns={catalog}
          selected={selectedCols}
          onApply={(keys) => { setSelectedCols(keys); setShowColsModal(false); }}
          onClose={() => setShowColsModal(false)}
        />
      )}
    </div>
  );
}
