'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CustomizeColumnsModal, type CustomizableColumn } from '@/components/customize-columns-modal';
import { ViewPdfButton } from '@/components/view-pdf-button';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

const DC_TLD: Record<string, string> = { in: 'in', com: 'com', eu: 'eu', com_au: 'com.au', jp: 'jp', sa: 'sa' };

type DocType = 'estimates' | 'invoices';

interface Org { id: string; name: string; zohoOrgId: string; dataCenter: string; isActive?: boolean }
interface DocumentRow { id: string; number: string; fields: Record<string, string | number> }
interface Filters {
  status: string; dateStart: string; dateEnd: string;
  referenceNumber: string; businessType: string; expiryFrom: string; expiryTo: string;
}
interface SavedView {
  id: string; name: string; docType: DocType; orgId?: string;
  filters: Partial<Filters>; columns: string[]; sort?: { key: string; dir: 'asc' | 'desc' } | null;
}

const EMPTY_FILTERS: Filters = {
  status: '', dateStart: '', dateEnd: '', referenceNumber: '', businessType: '', expiryFrom: '', expiryTo: '',
};

const STATUS_OPTIONS: Record<DocType, { value: string; label: string }[]> = {
  estimates: [
    { value: '', label: 'All Statuses' },
    { value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' },
    { value: 'accepted', label: 'Accepted' }, { value: 'declined', label: 'Declined' },
    { value: 'expired', label: 'Expired' }, { value: 'invoiced', label: 'Invoiced' },
  ],
  invoices: [
    { value: '', label: 'All Statuses' },
    { value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' },
    { value: 'overdue', label: 'Overdue' }, { value: 'paid', label: 'Paid' },
    { value: 'partially_paid', label: 'Partially Paid' }, { value: 'unpaid', label: 'Unpaid' },
    { value: 'void', label: 'Void' },
  ],
};

const BUSINESS_TYPES = ['', 'Renewal', 'Fresh', 'Pro-rata', 'Transfer'];
const DEFAULT_COLUMNS = ['date', 'number', 'customer_name', 'status', 'total'];

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600', sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-emerald-100 text-emerald-700', declined: 'bg-red-100 text-red-700',
  expired: 'bg-orange-100 text-orange-700', invoiced: 'bg-indigo-100 text-indigo-700',
  paid: 'bg-emerald-100 text-emerald-700', overdue: 'bg-red-100 text-red-700',
  partially_paid: 'bg-amber-100 text-amber-700', unpaid: 'bg-amber-100 text-amber-700',
  void: 'bg-slate-200 text-slate-500',
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

// ── Filter popup ─────────────────────────────────────────────────────────────
interface FilterPopupProps {
  orgs: Org[];
  orgId: string; setOrgId: (v: string) => void;
  docType: DocType; setDocType: (v: DocType) => void;
  filters: Filters; setF: (patch: Partial<Filters>) => void;
  perPage: number; setPerPage: (v: number) => void;
  loading: boolean;
  onFetch: () => void;
  onReset: () => void;
  onClose: () => void;
}

function FilterPopup({ orgs, orgId, setOrgId, docType, setDocType, filters, setF, perPage, setPerPage, loading, onFetch, onReset, onClose }: FilterPopupProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const datePreset = (preset: 'month' | 'days30' | 'year') => {
    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (preset === 'month') setF({ dateStart: iso(new Date(now.getFullYear(), now.getMonth(), 1)), dateEnd: iso(now) });
    else if (preset === 'days30') { const s = new Date(now); s.setDate(s.getDate() - 30); setF({ dateStart: iso(s), dateEnd: iso(now) }); }
    else setF({ dateStart: iso(new Date(now.getFullYear(), 0, 1)), dateEnd: iso(now) });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 pb-8"
      style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden"
        style={{ animation: 'slideDown 0.18s cubic-bezier(0.16,1,0.3,1)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600">
          <div>
            <h2 className="text-white font-bold text-base tracking-tight">Fetch Documents</h2>
            <p className="text-blue-200 text-[11px] mt-0.5">Filters set karo phir Fetch karo — Zoho Books se sync hoga</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 text-white flex items-center justify-center text-lg transition-all leading-none">
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Row 1: Org + Doc type + Status + Business Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Organization</label>
              <select value={orgId} onChange={e => { setOrgId(e.target.value); }}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white">
                {orgs.length === 0 && <option value="">No organizations</option>}
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Document Type</label>
              <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200/40 w-full">
                {(['estimates', 'invoices'] as DocType[]).map(dt => (
                  <button key={dt} type="button"
                    onClick={() => { setDocType(dt); setF({ status: '' }); }}
                    className={`flex-1 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${docType === dt ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
                    {dt === 'estimates' ? 'Quotes' : 'Invoices'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Status</label>
              <select value={filters.status} onChange={e => setF({ status: e.target.value })}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white">
                {STATUS_OPTIONS[docType].map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Business Type</label>
              <select value={filters.businessType} onChange={e => setF({ businessType: e.target.value })}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white">
                {BUSINESS_TYPES.map(b => <option key={b} value={b}>{b || 'All Types'}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Reference #</label>
              <input value={filters.referenceNumber} onChange={e => setF({ referenceNumber: e.target.value })}
                placeholder="EST-000123" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
            </div>
          </div>

          {/* Date range */}
          <div className="border-t border-slate-100 pt-4">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Date Range</label>
            <div className="flex flex-wrap items-center gap-3">
              <input type="date" value={filters.dateStart} onChange={e => setF({ dateStart: e.target.value })}
                className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 flex-1 min-w-[140px]" />
              <span className="text-slate-300 font-bold text-sm select-none">→</span>
              <input type="date" value={filters.dateEnd} onChange={e => setF({ dateEnd: e.target.value })}
                className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 flex-1 min-w-[140px]" />
              <div className="flex gap-1">
                {([['month', 'This Month'], ['days30', 'Last 30d'], ['year', 'This Year']] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => datePreset(k)}
                    className="px-2.5 py-2 text-[11px] font-bold border border-slate-200 rounded-lg text-slate-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-all whitespace-nowrap">{l}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Expiry range */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Expiry Range</label>
            <div className="flex items-center gap-3">
              <input type="date" value={filters.expiryFrom} onChange={e => setF({ expiryFrom: e.target.value })}
                className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 flex-1" />
              <span className="text-slate-300 font-bold text-sm select-none">→</span>
              <input type="date" value={filters.expiryTo} onChange={e => setF({ expiryTo: e.target.value })}
                className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 flex-1" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/60">
          <button type="button" onClick={onReset}
            className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl hover:bg-white transition-all">
            Reset Filters
          </button>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Per page</span>
              <select value={perPage} onChange={e => setPerPage(Number(e.target.value))}
                className="px-2 py-2 border border-slate-200 rounded-xl text-xs font-bold bg-white focus:outline-none">
                {[25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <button type="button" onClick={onFetch} disabled={loading}
              className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/15 active:scale-[0.98] transition-all flex items-center gap-2">
              {loading ? <><span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Fetching…</> : '↓ Fetch Documents'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-16px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

// ── Main browser ──────────────────────────────────────────────────────────────
export function DocumentsBrowser({ isAdmin = false }: { isAdmin?: boolean }) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState('');
  const [docType, setDocType] = useState<DocType>('estimates');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  const [catalog, setCatalog] = useState<CustomizableColumn[]>([]);
  const [selectedCols, setSelectedCols] = useState<string[]>(DEFAULT_COLUMNS);
  const [showColsModal, setShowColsModal] = useState(false);

  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const [views, setViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState('');

  const org = useMemo(() => orgs.find(o => o.id === orgId) ?? null, [orgs, orgId]);
  const colByKey = useMemo(() => new Map(catalog.map(c => [c.key, c])), [catalog]);

  useEffect(() => {
    fetch(`${API_BASE}/organizations`, { credentials: 'include' })
      .then(r => r.json())
      .then((d: { organizations: Org[] }) => {
        const active = (d.organizations ?? []).filter(o => o.isActive !== false);
        setOrgs(active);
        if (active[0]) setOrgId(active[0].id);
      })
      .catch(() => setMsg('Organizations load nahi ho paaye'));
    fetch(`${API_BASE}/document-views`, { credentials: 'include' })
      .then(r => r.json())
      .then((d: SavedView[]) => setViews(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const loadColumns = useCallback(async (oid: string, dt: DocType) => {
    if (!oid) return;
    try {
      const res = await fetch(`${API_BASE}/organizations/${oid}/document-columns?doc_type=${dt}`, { credentials: 'include' });
      const d = await res.json() as { columns: CustomizableColumn[] };
      setCatalog(d.columns ?? []);
    } catch { setCatalog([]); }
  }, []);

  useEffect(() => { if (orgId) void loadColumns(orgId, docType); }, [orgId, docType, loadColumns]);

  const fetchDocuments = useCallback(async (goToPage: number) => {
    if (!orgId) { setMsg('Pehle organization select karein'); return; }
    setLoading(true);
    setMsg('⏳ Zoho se fetch ho raha hai…');
    const p = new URLSearchParams();
    p.set('doc_type', docType);
    p.set('page', String(goToPage));
    p.set('per_page', String(perPage));
    if (filters.status) p.set('status', filters.status);
    if (filters.dateStart) p.set('date_start', filters.dateStart);
    if (filters.dateEnd) p.set('date_end', filters.dateEnd);
    if (filters.referenceNumber.trim()) p.set('reference_number', filters.referenceNumber.trim());
    if (filters.businessType) p.set('business_type', filters.businessType);
    if (filters.expiryFrom) p.set('service_expiry_from', filters.expiryFrom);
    if (filters.expiryTo) p.set('service_expiry_to', filters.expiryTo);
    try {
      const res = await fetch(`${API_BASE}/organizations/${orgId}/documents?${p}`, { credentials: 'include' });
      if (!res.ok) { setMsg('❌ Fetch failed — Zoho connected hai? Org synced hai?'); setLoading(false); return; }
      const d = await res.json() as { rows: DocumentRow[]; page: number; hasMore: boolean };
      setRows(d.rows ?? []);
      setPage(d.page ?? goToPage);
      setHasMore(Boolean(d.hasMore));
      setFetched(true);
      setMsg((d.rows?.length ?? 0) === 0 ? 'Is filter par koi document nahi mila.' : null);
    } catch {
      setMsg('Server se connect nahi ho paaya');
    } finally {
      setLoading(false);
    }
  }, [orgId, docType, perPage, filters]);

  const handleFetch = () => {
    void fetchDocuments(1);
    setFilterOpen(false);
  };

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

  const deepLink = (row: DocumentRow): string | null => {
    if (!org?.zohoOrgId) return null;
    const tld = DC_TLD[org.dataCenter] ?? 'com';
    const entity = docType === 'estimates' ? 'quotes' : 'invoices';
    return `https://books.zoho.${tld}/app/${org.zohoOrgId}#/${entity}/${row.id}`;
  };

  const renderCell = (row: DocumentRow, key: string) => {
    const col = colByKey.get(key);
    const raw = row.fields[key];
    if (key === 'number') {
      const link = deepLink(row);
      return link
        ? <a href={link} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-blue-600 hover:underline">{row.number || '—'} ↗</a>
        : <span className="font-mono text-xs text-slate-600">{row.number || '—'}</span>;
    }
    if (col?.type === 'status') {
      const s = String(raw ?? '').toLowerCase();
      if (!s) return <span className="text-slate-400">—</span>;
      return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[s] ?? 'bg-slate-100 text-slate-600'}`}>{String(raw)}</span>;
    }
    if (col?.type === 'currency') return <span className="tabular-nums">{fmtMoney(Number(raw), String(row.fields.currency_code ?? 'INR'))}</span>;
    if (col?.type === 'date') return <span>{fmtDate(String(raw ?? ''))}</span>;
    const v = raw == null || raw === '' ? '—' : String(raw);
    return <span title={v}>{v}</span>;
  };

  const exportCsv = () => {
    const cols = selectedCols.map(k => colByKey.get(k)).filter((c): c is CustomizableColumn => !!c);
    const header = cols.map(c => `"${c.label}"`).join(',');
    const lines = sortedRows.map(r =>
      cols.map(c => {
        const v = c.key === 'number' ? r.number : (r.fields[c.key] ?? '');
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(','),
    );
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docType}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const applyView = (view: SavedView) => {
    setActiveViewId(view.id);
    setDocType(view.docType);
    setFilters({ ...EMPTY_FILTERS, ...view.filters });
    setSelectedCols(view.columns.length ? view.columns : DEFAULT_COLUMNS);
    setSort(view.sort ?? null);
    if (view.orgId && orgs.some(o => o.id === view.orgId)) setOrgId(view.orgId);
    setMsg(`View "${view.name}" applied — Fetch Data dabaayein.`);
  };

  const saveCurrentView = async () => {
    const name = prompt('Is view ka naam?');
    if (!name?.trim()) return;
    const view: SavedView = { id: '', name: name.trim(), docType, orgId, filters, columns: selectedCols, sort };
    try {
      const res = await fetch(`${API_BASE}/document-views`, {
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
      const res = await fetch(`${API_BASE}/document-views/${id}`, { method: 'DELETE', credentials: 'include' });
      const list = await res.json() as SavedView[];
      setViews(Array.isArray(list) ? list : []);
      if (activeViewId === id) setActiveViewId('');
    } catch { setMsg('View delete nahi ho paaya'); }
  };

  const setF = (patch: Partial<Filters>) => setFilters(prev => ({ ...prev, ...patch }));
  const handleReset = () => { setFilters(EMPTY_FILTERS); setActiveViewId(''); };

  const activeChips = [
    filters.status && `Status: ${filters.status}`,
    (filters.dateStart || filters.dateEnd) && `Date: ${filters.dateStart || '…'} → ${filters.dateEnd || '…'}`,
    filters.referenceNumber && `Ref: ${filters.referenceNumber}`,
    filters.businessType && `Type: ${filters.businessType}`,
    (filters.expiryFrom || filters.expiryTo) && `Expiry: ${filters.expiryFrom || '…'} → ${filters.expiryTo || '…'}`,
  ].filter(Boolean) as string[];

  const shownCols = selectedCols.map(k => colByKey.get(k)).filter((c): c is CustomizableColumn => !!c);
  const activeView = views.find(v => v.id === activeViewId);

  return (
    <div className="space-y-3">
      {/* ── Toolbar row ── */}
      <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200/80 px-3 py-2 rounded-2xl shadow-sm">

        {/* Fetch Data button */}
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-lg shadow-sm active:scale-[0.98] transition-all shrink-0 disabled:opacity-60"
        >
          {loading
            ? <><span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Fetching…</>
            : <>↓ Fetch Data</>}
        </button>

        <div className="w-px h-5 bg-slate-200 shrink-0" />

        {/* Views */}
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">Views:</span>
        <select
          value={activeViewId}
          onChange={e => { const v = views.find(x => x.id === e.target.value); if (v) applyView(v); else setActiveViewId(''); }}
          className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-bold bg-white min-w-36 focus:outline-none"
        >
          <option value="">— Select a view —</option>
          {views.map(v => <option key={v.id} value={v.id}>{v.name}{v.id === activeViewId ? ' ✓' : ''}</option>)}
        </select>
        {activeViewId && (
          <button type="button" onClick={() => deleteView(activeViewId)}
            className="text-xs font-bold text-red-400 hover:text-red-600 transition-colors shrink-0">
            Delete
          </button>
        )}
        <button type="button" onClick={() => void saveCurrentView()}
          className="px-2.5 py-1.5 border border-slate-200 text-slate-700 text-xs font-bold rounded-lg bg-white hover:bg-slate-50 transition-all shadow-sm shrink-0 whitespace-nowrap">
          💾 Save view
        </button>

        {/* Active filter chips */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {activeChips.map(c => (
              <span key={c} className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200/60 text-blue-700 text-[10px] font-bold">
                {c}
              </span>
            ))}
            <button type="button" onClick={handleReset}
              className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold hover:bg-red-50 hover:text-red-500 transition-colors">
              × Clear
            </button>
          </div>
        )}

        {/* Right side */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => setShowColsModal(true)}
            className="px-2.5 py-1.5 border border-slate-200 text-slate-700 text-xs font-bold rounded-lg bg-white hover:bg-slate-50 transition-all shadow-sm whitespace-nowrap">
            ⚙ Columns ({shownCols.length})
          </button>
          {isAdmin && (
            <button type="button" onClick={exportCsv} disabled={rows.length === 0}
              className="px-3 py-1.5 bg-gradient-to-r from-slate-800 to-slate-900 hover:from-slate-700 hover:to-slate-800 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-all shadow-sm whitespace-nowrap">
              ⬇ Export CSV
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className="text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200/50 rounded-xl px-4 py-2.5">
          {msg}
        </div>
      )}

      {/* Results table */}
      {fetched && rows.length > 0 && (
        <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
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
                  <th className="text-left px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap w-24">PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedRows.map(row => (
                  <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                    {shownCols.map(c => (
                      <td key={c.key} className="px-5 py-3 text-slate-700 whitespace-nowrap max-w-xs truncate text-xs font-medium">
                        {renderCell(row, c.key)}
                      </td>
                    ))}
                    <td className="px-5 py-3 whitespace-nowrap">
                      <ViewPdfButton
                        orgId={orgId}
                        kind={docType === 'estimates' ? 'estimate' : 'invoice'}
                        docId={row.id}
                        title="View this document's PDF"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-4 border-t border-slate-200/60 flex items-center justify-between text-xs text-slate-400 font-semibold bg-slate-50/20">
            <span>Page {page} · {rows.length} rows shown</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1 || loading} onClick={() => void fetchDocuments(page - 1)}
                className="px-3.5 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 disabled:opacity-40 font-bold transition-colors">← Prev</button>
              <button type="button" disabled={!hasMore || loading} onClick={() => void fetchDocuments(page + 1)}
                className="px-3.5 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 disabled:opacity-40 font-bold transition-colors">Next →</button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!fetched && !loading && (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-16 text-center shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center text-4xl mx-auto mb-4">
            🧾
          </div>
          <h3 className="text-lg font-bold text-slate-800">No documents loaded</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto mb-6 leading-relaxed">
            <span className="text-blue-600 font-bold cursor-pointer hover:underline" onClick={() => setFilterOpen(true)}>↓ Fetch Data</span> button dabaao, filters set karo aur documents sync karo Zoho Books se.
          </p>
          <button type="button" onClick={() => setFilterOpen(true)}
            className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-bold rounded-xl shadow-md shadow-blue-500/10 active:scale-[0.98] transition-all">
            ↓ Fetch Data
          </button>
        </div>
      )}

      {/* Filter popup */}
      {filterOpen && (
        <FilterPopup
          orgs={orgs} orgId={orgId} setOrgId={setOrgId}
          docType={docType} setDocType={setDocType}
          filters={filters} setF={setF}
          perPage={perPage} setPerPage={setPerPage}
          loading={loading}
          onFetch={handleFetch}
          onReset={handleReset}
          onClose={() => setFilterOpen(false)}
        />
      )}

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
