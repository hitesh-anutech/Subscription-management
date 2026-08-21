'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
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
  const [query, setQuery] = useState('');            // committed search term

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

  const [importing, startImport] = useTransition();
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const colByKey = useMemo(() => new Map(catalog.map(c => [c.key, c])), [catalog]);

  // ---- initial load: orgs + saved views ----
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

  // ---- load column catalog whenever org changes ----
  const loadColumns = useCallback(async (oid: string) => {
    if (!oid) return;
    try {
      const res = await fetch(`${API_BASE}/organizations/${oid}/customer-columns`, { credentials: 'include' });
      const d = await res.json() as { columns: CustomizableColumn[] };
      setCatalog(d.columns ?? []);
    } catch { setCatalog([]); }
  }, []);

  // ---- fetch rows ----
  const fetchRows = useCallback(async (oid: string, q: string, goToPage: number, pp: number) => {
    if (!oid) return;
    setLoading(true);
    const p = new URLSearchParams({ q, page: String(goToPage), limit: String(pp) });
    try {
      const res = await fetch(`${API_BASE}/organizations/${oid}/customer-rows?${p}`, { credentials: 'include' });
      if (!res.ok) { setMsg('❌ Customers load nahi ho paaye'); setRows([]); setTotal(0); return; }
      const d = await res.json() as { rows: CustomerRow[]; total: number; page: number };
      setRows(d.rows ?? []);
      setTotal(d.total ?? 0);
      setPage(d.page ?? goToPage);
      setMsg((d.rows?.length ?? 0) === 0 ? 'Koi customer nahi mila.' : null);
    } catch {
      setMsg('Server se connect nahi ho paaya');
      setRows([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // org change → reload catalog + rows (reset to page 1)
  useEffect(() => {
    if (!orgId) return;
    void loadColumns(orgId);
    void fetchRows(orgId, query, 1, perPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const runSearch = () => { setQuery(search); void fetchRows(orgId, search, 1, perPage); };
  const clearSearch = () => { setSearch(''); setQuery(''); void fetchRows(orgId, '', 1, perPage); };
  const changePerPage = (pp: number) => { setPerPage(pp); void fetchRows(orgId, query, 1, pp); };
  const gotoPage = (n: number) => void fetchRows(orgId, query, n, perPage);

  const runImport = () => {
    setImportMsg(null);
    startImport(async () => {
      const res = await syncCustomersAction(orgId);
      if (res.error) setImportMsg(`❌ ${res.error}`);
      else {
        setImportMsg(`✅ Synced ${res.synced ?? 0}`);
        await loadColumns(orgId);
        await fetchRows(orgId, query, 1, perPage);
      }
    });
  };

  // ---- client-side sort (current page) ----
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
      return (
        <Link href={`/dashboard/customers/${row.zohoId}?org_id=${orgId}`} className="font-medium text-blue-700 hover:underline">
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

  // ---- CSV export (current page, selected columns) ----
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

  // ---- saved views ----
  const applyView = (view: SavedView) => {
    setActiveViewId(view.id);
    setSelectedCols(view.columns.length ? view.columns : DEFAULT_COLUMNS);
    setSort(view.sort ?? null);
    const q = view.search ?? '';
    setSearch(q); setQuery(q);
    if (view.orgId && orgs.some(o => o.id === view.orgId) && view.orgId !== orgId) {
      setOrgId(view.orgId);   // org change effect will re-fetch
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Customers</h1>
          <p className="text-xs font-semibold text-slate-400 mt-1 bg-slate-100 border border-slate-200/50 inline-block px-2.5 py-1 rounded-lg">
            👥 {total} customer{total === 1 ? '' : 's'} · Zoho Books master
          </p>
        </div>
        <div className="flex items-center gap-3">
          {importMsg && <span className="text-xs font-semibold text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-200">{importMsg}</span>}
          {isAdmin && orgId && (
            <button type="button" onClick={runImport} disabled={importing}
              className="px-4 py-2.5 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-xs font-bold rounded-xl transition-all shadow-sm bg-white">
              {importing ? '⏳ Importing…' : '🔄 Import from Zoho'}
            </button>
          )}
        </div>
      </div>

      {/* Org pills (Modern Pill-Shape design) */}
      {orgs.length > 0 && (
        <div className="flex gap-2 flex-wrap bg-white/50 border border-slate-200/50 p-2 rounded-2xl max-w-max">
          {orgs.map((o) => (
            <button key={o.id} type="button" onClick={() => { setActiveViewId(''); setOrgId(o.id); }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ${
                o.id === orgId ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/10 border-transparent' : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200/60'
              }`}>
              {o.name}
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="flex gap-2 bg-white border border-slate-200/80 p-2.5 rounded-2xl shadow-sm">
        <input value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
          placeholder="Search name, email, GSTIN…"
          className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-slate-50/50" />
        <button type="button" onClick={runSearch} className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/10 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] transition-all">Search</button>
        {query && (
          <button type="button" onClick={clearSearch} className="px-4 py-2.5 border border-slate-200 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 transition-all">Clear</button>
        )}
      </div>

      {/* Saved views + column/export toolbar */}
      <div className="flex flex-wrap items-center gap-3 bg-white/40 border border-slate-200/50 p-3 rounded-2xl">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Views:</span>
        <select value={activeViewId}
          onChange={e => { const v = views.find(x => x.id === e.target.value); if (v) applyView(v); else setActiveViewId(''); }}
          className="px-2.5 py-2 border border-slate-200 rounded-xl text-xs font-bold bg-white min-w-40 focus:outline-none">
          <option value="">— Select a view —</option>
          {views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        {activeViewId && (
          <button type="button" onClick={() => deleteView(activeViewId)}
            className="px-2.5 py-2 text-xs font-bold text-red-500 hover:text-red-700 transition-colors">Delete View</button>
        )}
        <button type="button" onClick={saveCurrentView}
          className="px-3.5 py-2 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl bg-white hover:bg-slate-50 transition-all shadow-sm">
          💾 Save current view
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setShowColsModal(true)}
            className="px-3.5 py-2 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl bg-white hover:bg-slate-50 transition-all shadow-sm">
            ⚙ Customize Columns ({shownCols.length})
          </button>
          {isAdmin && (
            <button type="button" onClick={exportCsv} disabled={rows.length === 0}
              className="px-4 py-2 bg-gradient-to-r from-slate-800 to-slate-900 hover:from-slate-700 hover:to-slate-800 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition-all shadow-sm">
              ⬇ Export CSV
            </button>
          )}
        </div>
      </div>

      {msg && <div className="text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200/50 rounded-xl px-4 py-3 shadow-inner">{msg}</div>}

      {/* Table */}
      <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
        {rows.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="font-bold text-slate-700">{loading ? '⏳ Loading…' : 'कोई customer नहीं मिला'}</p>
            {!loading && <p className="text-xs mt-1 text-slate-500">ऊपर “Import from Zoho” से customers sync करो।</p>}
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
