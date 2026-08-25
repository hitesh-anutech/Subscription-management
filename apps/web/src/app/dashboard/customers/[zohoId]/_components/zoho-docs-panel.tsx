'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { TruncatedTooltip } from '@/components/truncated-tooltip';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

// ── Types ────────────────────────────────────────────────────────────

interface SubOption {
  id: string;
  subscriptionNumber: string;
  zohoItemName: string | null;
  domain: { domainName: string } | null;
}

interface LinkedSub {
  id: string;
  subscriptionNumber: string;
  zohoItemName: string | null;
  domain: { domainName: string } | null;
}

interface ZohoDoc {
  quoteId: string | null;   quoteNumber: string | null;   quoteDate: string | null;
  quoteStatus: string | null;  quoteTotal: number | null;
  invoiceId: string | null; invoiceNumber: string | null; invoiceDate: string | null;
  invoiceStatus: string | null; invoiceTotal: number | null;
  businessType: string | null;
  linkedSub: LinkedSub | null;
}

interface LineItem {
  name: string; qty: number; rate: number;
  domain: string; startDate: string; endDate: string;
  suggestedSub: SubOption | null;
}

// Per-row line-item state (after "Map" is clicked)
interface RowMapState {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  lineItems: LineItem[];
  selections: Record<number, string>;
  error?: string;
  saving: boolean;
  saveError?: string;
  historyStatus: 'idle' | 'saving' | 'done' | 'error';
  historyError?: string;
}

interface Props {
  orgId: string;
  zohoCustomerId: string;
  subs: SubOption[];
}

// ── Style helpers ─────────────────────────────────────────────────────

const Q_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-500', sent: 'bg-blue-100 text-blue-600',
  accepted: 'bg-emerald-100 text-emerald-700', declined: 'bg-red-100 text-red-600',
  invoiced: 'bg-violet-100 text-violet-700', expired: 'bg-orange-100 text-orange-600',
};
const I_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-500', sent: 'bg-blue-100 text-blue-600',
  paid: 'bg-emerald-100 text-emerald-700', overdue: 'bg-red-100 text-red-600',
  void: 'bg-slate-100 text-slate-400', partially_paid: 'bg-amber-100 text-amber-700',
};

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const inr = (n: number | null) =>
  n != null ? n.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—';

const BT_STYLES: Record<string, string> = {
  renewal:  'bg-amber-50 text-amber-700 border-amber-200',
  fresh:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  prorata:  'bg-blue-50 text-blue-600 border-blue-200',
  transfer: 'bg-violet-50 text-violet-700 border-violet-200',
};
const btStyle = (bt: string | null) => {
  if (!bt) return null;
  const key = bt.toLowerCase().replace(/[^a-z]/g, '');
  return BT_STYLES[key] ?? 'bg-slate-100 text-slate-500 border-slate-200';
};

// ── Component ─────────────────────────────────────────────────────────

export default function ZohoDocsPanel({ orgId, zohoCustomerId, subs }: Props) {
  const [docs,     setDocs]     = useState<ZohoDoc[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [fetched,  setFetched]  = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [syncedAt, setSyncedAt]  = useState<string | null>(null);

  // ── Hover line-item popover ────────────────────────────────────────
  type LineCacheEntry = { status: 'loading' | 'loaded' | 'error'; items: LineItem[]; error?: string };
  const [lineCache, setLineCache] = useState<Record<string, LineCacheEntry>>({});
  const [hoverCard, setHoverCard] = useState<{ docId: string; x: number; y: number } | null>(null);
  const hoverTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-row mapping state (keyed by doc index)
  const [rowMap, setRowMap] = useState<Record<number, RowMapState>>({});

  // Bulk checkboxes
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // ── Auto-load from cache on mount ─────────────────────────────────
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/organizations/${orgId}/customers/${zohoCustomerId}/zoho-documents-cached`,
          { credentials: 'include' },
        );
        if (!res.ok) return;
        const data = await res.json() as { docs: ZohoDoc[]; fromCache: boolean; syncedAt: string | null };
        if ((data.docs ?? []).length > 0) {
          setDocs(data.docs);
          setFetched(true);
          setFromCache(true);
          setSyncedAt(data.syncedAt);
        }
      } catch { /* silent — user can still click sync */ }
    })();
  }, [orgId, zohoCustomerId]);

  // ── Live sync from Zoho ────────────────────────────────────────────
  const sync = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/organizations/${orgId}/customers/${zohoCustomerId}/zoho-documents`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { docs: ZohoDoc[]; fromCache: boolean };
      setDocs(data.docs ?? []);
      setFetched(true);
      setFromCache(false);
      setSyncedAt(new Date().toISOString());
      setSelected(new Set());
      setRowMap({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, [orgId, zohoCustomerId]);

  // ── Doc-number hover: lazy-load line items, show popover ─────────
  const handleDocNumEnter = useCallback((
    e: React.MouseEvent<HTMLElement>,
    kind: 'estimate' | 'invoice',
    docId: string,
  ) => {
    // Kick off fetch if not already cached
    if (!lineCache[docId]) {
      setLineCache(prev => ({ ...prev, [docId]: { status: 'loading', items: [] } }));
      void fetch(
        `${API_BASE}/organizations/${orgId}/zoho-doc-line-items?kind=${kind}&doc_id=${encodeURIComponent(docId)}`,
        { credentials: 'include' },
      )
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data: { lineItems: LineItem[] }) =>
          setLineCache(prev => ({ ...prev, [docId]: { status: 'loaded', items: data.lineItems ?? [] } })),
        )
        .catch(err =>
          setLineCache(prev => ({ ...prev, [docId]: { status: 'error', items: [], error: err instanceof Error ? err.message : 'Failed' } })),
        );
    }
    // Show popover after 350ms (avoids flicker on quick mouse-over)
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    hoverTimer.current = setTimeout(() => {
      const x = Math.min(rect.left, window.innerWidth - 430);
      setHoverCard({ docId, x, y: rect.bottom + 6 });
    }, 350);
  }, [lineCache, orgId]);

  const handleDocNumLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoverCard(null);
  }, []);

  // ── Fetch line items for a doc row ────────────────────────────────
  const openMap = useCallback(async (i: number, doc: ZohoDoc) => {
    // If already open, close it
    if (rowMap[i]?.status === 'loaded' || rowMap[i]?.status === 'loading') {
      setRowMap(prev => { const n = { ...prev }; delete n[i]; return n; });
      return;
    }

    const kind  = doc.invoiceId ? 'invoice'  : 'estimate';
    const docId = doc.invoiceId ?? doc.quoteId;
    if (!docId) return;

    setRowMap(prev => ({
      ...prev,
      [i]: { status: 'loading', lineItems: [], selections: {}, saving: false, historyStatus: 'idle' },
    }));

    try {
      const res = await fetch(
        `${API_BASE}/organizations/${orgId}/zoho-doc-line-items?kind=${kind}&doc_id=${encodeURIComponent(docId)}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { lineItems: LineItem[] };
      const items = data.lineItems ?? [];
      // Build default selections from suggested subs
      const selections: Record<number, string> = {};
      items.forEach((li, idx) => { if (li.suggestedSub) selections[idx] = li.suggestedSub.id; });
      setRowMap(prev => ({
        ...prev,
        [i]: { status: 'loaded', lineItems: items, selections, saving: false, historyStatus: 'idle' },
      }));
    } catch (err) {
      setRowMap(prev => ({
        ...prev,
        [i]: { status: 'error', lineItems: [], selections: {}, error: err instanceof Error ? err.message : 'Failed', saving: false, historyStatus: 'idle' },
      }));
    }
  }, [orgId, rowMap]);

  // ── Apply all line-item mappings for a doc row ────────────────────
  const applyMap = useCallback(async (i: number, doc: ZohoDoc) => {
    const rm = rowMap[i];
    if (!rm || rm.saving) return;

    const patches = Object.entries(rm.selections)
      .filter(([, subId]) => !!subId)
      .map(([, subId]) => ({ subId }));

    if (patches.length === 0) return;

    setRowMap(prev => ({ ...prev, [i]: { ...prev[i], saving: true, saveError: undefined } }));

    const body: Record<string, string> = {};
    if (doc.invoiceNumber) body.lastInvoiceNumber = doc.invoiceNumber;
    if (doc.quoteNumber)   body.lastQuoteNumber   = doc.quoteNumber;

    const results = await Promise.allSettled(
      patches.map(({ subId }) =>
        fetch(`${API_BASE}/subscriptions/${subId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return subId; }),
      ),
    );

    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) {
      setRowMap(prev => ({
        ...prev,
        [i]: { ...prev[i], saving: false, saveError: `${failed} mapping(s) failed` },
      }));
      return;
    }

    // Close the row + refresh docs
    setRowMap(prev => { const n = { ...prev }; delete n[i]; return n; });
    await sync();
  }, [rowMap, sync]);

  // ── Create RenewalHistory entries from line-item mappings ─────────
  const createHistory = useCallback(async (i: number, doc: ZohoDoc) => {
    const rm = rowMap[i];
    if (!rm || rm.status !== 'loaded' || rm.historyStatus === 'saving') return;

    const mappings = Object.entries(rm.selections)
      .filter(([, subId]) => !!subId)
      .map(([idxStr, subId]) => {
        const li = rm.lineItems[Number(idxStr)];
        return { subId, startDate: li?.startDate ?? '', endDate: li?.endDate ?? '', qty: li?.qty ?? 0, rate: li?.rate ?? 0 };
      });

    if (mappings.length === 0) return;

    setRowMap(prev => ({ ...prev, [i]: { ...prev[i], historyStatus: 'saving', historyError: undefined } }));

    try {
      const res = await fetch(`${API_BASE}/organizations/${orgId}/create-doc-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          quoteId: doc.quoteId, quoteNumber: doc.quoteNumber, quoteDate: doc.quoteDate, quoteStatus: doc.quoteStatus,
          invoiceId: doc.invoiceId, invoiceNumber: doc.invoiceNumber, invoiceDate: doc.invoiceDate, invoiceStatus: doc.invoiceStatus,
          businessType: doc.businessType,
          mappings,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRowMap(prev => ({ ...prev, [i]: { ...prev[i], historyStatus: 'done' } }));
    } catch (err) {
      setRowMap(prev => ({
        ...prev,
        [i]: { ...prev[i], historyStatus: 'error', historyError: err instanceof Error ? err.message : 'Failed' },
      }));
    }
  }, [orgId, rowMap]);

  // ── Helpers ───────────────────────────────────────────────────────
  const importUrl = (doc: ZohoDoc) => {
    const ref = doc.invoiceNumber ?? doc.quoteNumber ?? '';
    const src = doc.invoiceNumber ? 'invoices' : 'estimates';
    return `/dashboard/subscriptions/import?org_id=${encodeURIComponent(orgId)}&ref_number=${encodeURIComponent(ref)}&doc_source=${src}`;
  };

  const bulkImportUrl = (() => {
    const first = [...selected][0];
    return first !== undefined ? importUrl(docs[first]) : '#';
  })();

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(docs.map((_, i) => i)) : new Set());
  const toggleOne = (i: number, checked: boolean) => {
    const s = new Set(selected);
    if (checked) s.add(i); else s.delete(i);
    setSelected(s);
  };

  const linked   = docs.filter(d => d.linkedSub).length;
  const unlinked = docs.length - linked;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">📂 Zoho Documents</h2>
          {fetched && (
            <p className="text-xs text-slate-400 mt-0.5">
              {docs.length} documents · {linked} linked · {unlinked} unlinked
              {syncedAt && (
                <span className="ml-1.5 text-slate-300">
                  · {fromCache ? 'cached' : 'synced'} {new Date(syncedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <a href={bulkImportUrl} target="_blank" rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors">
              ↑ Import Selected ({selected.size})
            </a>
          )}
          <button type="button" onClick={() => void sync()} disabled={loading}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white transition-colors">
            {loading ? '⏳ Syncing…' : fetched ? '↺ Re-sync' : '↓ Sync from Zoho'}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-5 py-3 text-sm text-red-600 bg-red-50 border-b border-red-100">❌ {error}</div>
      )}

      {!fetched && !loading && !error && (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-slate-400">Zoho Books के quotes और invoices देखने के लिए</p>
          <p className="text-xs text-slate-300 mt-1">"Sync from Zoho" press करो</p>
        </div>
      )}

      {fetched && docs.length === 0 && (
        <p className="px-5 py-4 text-sm text-slate-400">इस customer के Zoho में कोई documents नहीं मिले।</p>
      )}

      {fetched && docs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2.5 w-8">
                  <input type="checkbox" className="rounded"
                    checked={selected.size === docs.length && docs.length > 0}
                    onChange={e => toggleAll(e.target.checked)} />
                </th>
                <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Quote</th>
                <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Invoice</th>
                <th className="text-right px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
                <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Subscription Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map((doc, i) => {
                const rm = rowMap[i];
                const isExpanded = rm?.status === 'loaded' || rm?.status === 'loading' || rm?.status === 'error';
                return (
                  <>
                    {/* ── Main doc row ── */}
                    <tr key={`doc-${i}`} className={`transition-colors ${selected.has(i) ? 'bg-blue-50/40' : 'hover:bg-slate-50'}`}>
                      {/* Checkbox */}
                      <td className="px-3 py-2.5 text-center">
                        <input type="checkbox" className="rounded border-slate-300 text-blue-600"
                          checked={selected.has(i)} onChange={e => toggleOne(i, e.target.checked)} />
                      </td>

                      {/* Quote */}
                      <td className="px-3 py-2.5">
                        {doc.quoteNumber && doc.quoteId ? (
                          <>
                            <p
                              className="font-mono text-indigo-700 font-medium cursor-default underline decoration-dotted underline-offset-2"
                              onMouseEnter={e => handleDocNumEnter(e, 'estimate', doc.quoteId!)}
                              onMouseLeave={handleDocNumLeave}
                            >
                              {doc.quoteNumber}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5">{fmt(doc.quoteDate)}</p>
                            {doc.businessType && btStyle(doc.businessType) && (
                              <span className={`inline-flex mt-1 text-[9px] px-1.5 py-0.5 rounded border font-medium ${btStyle(doc.businessType)}`}>
                                {doc.businessType}
                              </span>
                            )}
                          </>
                        ) : <span className="text-slate-300">—</span>}
                      </td>

                      {/* Invoice */}
                      <td className="px-3 py-2.5">
                        {doc.invoiceNumber && doc.invoiceId ? (
                          <>
                            <p
                              className="font-mono text-emerald-700 font-medium cursor-default underline decoration-dotted underline-offset-2"
                              onMouseEnter={e => handleDocNumEnter(e, 'invoice', doc.invoiceId!)}
                              onMouseLeave={handleDocNumLeave}
                            >
                              {doc.invoiceNumber}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5">{fmt(doc.invoiceDate)}</p>
                            {!doc.quoteNumber && doc.businessType && btStyle(doc.businessType) && (
                              <span className={`inline-flex mt-1 text-[9px] px-1.5 py-0.5 rounded border font-medium ${btStyle(doc.businessType)}`}>
                                {doc.businessType}
                              </span>
                            )}
                          </>
                        ) : <span className="text-slate-300">—</span>}
                      </td>

                      {/* Amount */}
                      <td className="px-3 py-2.5 text-right font-medium text-slate-700">
                        {inr(doc.invoiceTotal ?? doc.quoteTotal)}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-1">
                          {doc.quoteStatus && (
                            <span className={`inline-flex w-fit text-[10px] px-1.5 py-0.5 rounded font-medium capitalize ${Q_STYLES[doc.quoteStatus] ?? 'bg-slate-100 text-slate-500'}`}>
                              Q: {doc.quoteStatus}
                            </span>
                          )}
                          {doc.invoiceStatus && (
                            <span className={`inline-flex w-fit text-[10px] px-1.5 py-0.5 rounded font-medium ${I_STYLES[doc.invoiceStatus] ?? 'bg-slate-100 text-slate-500'}`}>
                              I: {doc.invoiceStatus.replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Subscription link / actions */}
                      <td className="px-3 py-2.5">
                        {doc.linkedSub ? (
                          <div className="flex items-start gap-2">
                            <div className="min-w-0">
                              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                                ✓ Linked
                              </span>
                              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                                <Link href={`/dashboard/subscriptions/${doc.linkedSub.id}`} className="hover:underline text-blue-600">
                                  {doc.linkedSub.subscriptionNumber}
                                </Link>
                                {doc.linkedSub.domain && <> · {doc.linkedSub.domain.domainName}</>}
                              </p>
                            </div>
                            <button type="button"
                              onClick={() => void openMap(i, doc)}
                              className="shrink-0 text-[10px] text-slate-400 hover:text-indigo-600 underline mt-0.5 whitespace-nowrap">
                              {isExpanded ? 'close' : 're-map'}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <a href={importUrl(doc)} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] px-2 py-1 rounded bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100 whitespace-nowrap transition-colors">
                              ↑ Import
                            </a>
                            {(doc.invoiceId || doc.quoteId) && (
                              <button type="button"
                                onClick={() => void openMap(i, doc)}
                                className={`text-[10px] px-2 py-1 rounded border whitespace-nowrap transition-colors ${isExpanded ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                                {isExpanded ? '✕ Close' : '🔗 Map'}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* ── Expanded line-items panel ── */}
                    {isExpanded && (
                      <tr key={`map-${i}`}>
                        <td colSpan={6} className="bg-slate-50/80 border-b border-slate-200 px-0 py-0">
                          <div className="px-6 py-3">
                            {rm.status === 'loading' && (
                              <p className="text-xs text-slate-400 py-2">⏳ Line items fetch हो रही हैं…</p>
                            )}
                            {rm.status === 'error' && (
                              <p className="text-xs text-red-600 py-2">❌ {rm.error}</p>
                            )}
                            {rm.status === 'loaded' && (
                              <>
                                {rm.lineItems.length === 0 ? (
                                  <p className="text-xs text-slate-400 py-2">कोई line items नहीं मिले।</p>
                                ) : (
                                  <table className="w-full text-xs mb-3">
                                    <thead>
                                      <tr className="text-left">
                                        <th className="py-1.5 pr-4 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Item</th>
                                        <th className="py-1.5 pr-4 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Domain</th>
                                        <th className="py-1.5 pr-4 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Period</th>
                                        <th className="py-1.5 pr-4 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Qty</th>
                                        <th className="py-1.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Map to Subscription</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {rm.lineItems.map((li, liIdx) => (
                                        <tr key={liIdx} className="hover:bg-white/70">
                                          <td className="py-2 pr-4 text-slate-700 max-w-[160px]">
                                            <TruncatedTooltip text={li.name} maxWidth="max-w-[150px]" />
                                          </td>
                                          <td className="py-2 pr-4 font-mono text-blue-700">{li.domain || <span className="text-slate-300">—</span>}</td>
                                          <td className="py-2 pr-4 whitespace-nowrap text-slate-500">
                                            {li.startDate ? fmt(li.startDate) : '—'} → {li.endDate ? fmt(li.endDate) : '—'}
                                          </td>
                                          <td className="py-2 pr-4 text-center text-slate-700">{li.qty}</td>
                                          <td className="py-2">
                                            <select
                                              value={rm.selections[liIdx] ?? ''}
                                              onChange={e => setRowMap(prev => ({
                                                ...prev,
                                                [i]: { ...prev[i], selections: { ...prev[i].selections, [liIdx]: e.target.value } },
                                              }))}
                                              className="w-full px-2 py-1 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                                            >
                                              <option value="">— Skip —</option>
                                              {subs.map(s => (
                                                <option key={s.id} value={s.id}>
                                                  {s.subscriptionNumber}
                                                  {s.domain ? ` · ${s.domain.domainName}` : ''}
                                                  {s.zohoItemName ? ` (${s.zohoItemName.slice(0, 20)})` : ''}
                                                </option>
                                              ))}
                                            </select>
                                            {li.suggestedSub && rm.selections[liIdx] === li.suggestedSub.id && (
                                              <p className="text-[10px] text-emerald-600 mt-0.5">✓ Auto-matched</p>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}

                                {rm.saveError && (
                                  <p className="text-xs text-red-600 mb-2">❌ {rm.saveError}</p>
                                )}

                                <div className="flex items-center gap-2 flex-wrap">
                                  <button type="button"
                                    onClick={() => void applyMap(i, doc)}
                                    disabled={rm.saving || Object.values(rm.selections).every(v => !v)}
                                    className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white transition-colors">
                                    {rm.saving ? 'Saving…' : `✓ Apply All (${Object.values(rm.selections).filter(Boolean).length} mappings)`}
                                  </button>
                                  <button type="button"
                                    onClick={() => void createHistory(i, doc)}
                                    disabled={rm.historyStatus === 'saving' || Object.values(rm.selections).every(v => !v)}
                                    className={`px-4 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                                      rm.historyStatus === 'done'
                                        ? 'bg-violet-50 text-violet-700 border-violet-300'
                                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 disabled:opacity-50'
                                    }`}>
                                    {rm.historyStatus === 'saving' ? '⏳ Creating…'
                                      : rm.historyStatus === 'done' ? '✓ History Created'
                                      : `📋 Create History (${Object.values(rm.selections).filter(Boolean).length})`}
                                  </button>
                                  <button type="button"
                                    onClick={() => setRowMap(prev => { const n = { ...prev }; delete n[i]; return n; })}
                                    className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-500 hover:bg-white transition-colors">
                                    Cancel
                                  </button>
                                  {rm.historyError && (
                                    <span className="text-[11px] text-red-600">❌ {rm.historyError}</span>
                                  )}
                                  <span className="text-[11px] text-slate-400 ml-auto">
                                    {doc.invoiceNumber ? `lastInvoiceNumber = ${doc.invoiceNumber}` : `lastQuoteNumber = ${doc.quoteNumber}`} set होगा
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {fetched && docs.length > 0 && (
        <div className="px-5 py-2 border-t border-slate-100 text-[11px] text-slate-400">
          ✓ Linked = already mapped · ↑ Import = Zoho import page pre-fill · 🔗 Map = line items fetch करके auto-match + apply
        </div>
      )}

      {/* ── Hover line-item popover (fixed-position, pointer-events-none) ── */}
      {hoverCard && (() => {
        const entry = lineCache[hoverCard.docId];
        if (!entry) return null;
        const total = entry.items.reduce((s, li) => s + (li.qty * li.rate), 0);
        return (
          <div
            className="fixed z-[9999] bg-white border border-slate-200 rounded-xl shadow-2xl pointer-events-none"
            style={{ left: hoverCard.x, top: hoverCard.y, minWidth: 380, maxWidth: 500 }}
          >
            {entry.status === 'loading' && (
              <div className="px-4 py-3 text-xs text-slate-400 flex items-center gap-2">
                <span className="animate-spin inline-block w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full" />
                Line items load हो रहे हैं…
              </div>
            )}
            {entry.status === 'error' && (
              <div className="px-4 py-3 text-xs text-red-500">❌ {entry.error}</div>
            )}
            {entry.status === 'loaded' && entry.items.length === 0 && (
              <div className="px-4 py-3 text-xs text-slate-400">कोई line items नहीं मिले।</div>
            )}
            {entry.status === 'loaded' && entry.items.length > 0 && (
              <>
                <div className="px-3 pt-2.5 pb-1 border-b border-slate-100">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Line Items</p>
                </div>
                <div className="divide-y divide-slate-50">
                  {entry.items.map((li, idx) => (
                    <div key={idx} className="px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs font-medium text-slate-700 leading-tight flex-1 min-w-0 truncate">{li.name}</p>
                        <p className="text-xs font-semibold text-slate-800 shrink-0 tabular-nums">
                          ₹{(li.qty * li.rate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {li.domain && (
                          <span className="text-[10px] font-mono text-blue-600">{li.domain}</span>
                        )}
                        {(li.startDate || li.endDate) && (
                          <span className="text-[10px] text-slate-400">
                            {li.startDate ? fmt(li.startDate) : '?'} → {li.endDate ? fmt(li.endDate) : '?'}
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400">
                          {li.qty} × ₹{li.rate.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-3 py-2 border-t border-slate-100 bg-slate-50 rounded-b-xl flex justify-between items-center">
                  <span className="text-[10px] text-slate-400">{entry.items.length} item{entry.items.length !== 1 ? 's' : ''}</span>
                  <span className="text-xs font-bold text-slate-800 tabular-nums">
                    Total ₹{total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                </div>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}
