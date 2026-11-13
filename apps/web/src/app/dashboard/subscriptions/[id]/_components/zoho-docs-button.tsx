'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
const POPUP_W = 500;

const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', AUD: 'A$', CAD: 'C$', JPY: '¥',
};

const DC_TLD: Record<string, string> = { in: 'in', com: 'com', eu: 'eu', com_au: 'com.au', jp: 'jp', sa: 'sa' };

function buildZohoUrl(org: { zohoOrgId: string; dataCenter: string }, entity: 'estimates' | 'invoices', id: string) {
  const tld = DC_TLD[org.dataCenter] ?? 'com';
  const path = entity === 'estimates' ? 'quotes' : entity;
  return `https://books.zoho.${tld}/app/${org.zohoOrgId}#/${path}/${id}`;
}

const fmtD = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

interface RZDLine {
  id: string; lineOrder: number; name: string;
  qty: number; rate: number; domain: string | null;
  startDate: string | null; endDate: string | null;
}
interface RZDoc {
  id: string; docKey: string;
  quoteId: string | null; quoteNumber: string | null; quoteDate: string | null;
  quoteStatus: string | null; quoteTotal: number | null;
  invoiceId: string | null; invoiceNumber: string | null; invoiceDate: string | null;
  invoiceStatus: string | null; invoiceTotal: number | null; invoiceBalance: number | null;
  businessType: string | null;
  domainLines: RZDLine[];
}
interface RZSub {
  id: string; startDate: string; endDate: string;
  quantity: string; subscriptionPrice: string;
  billingCycle: string; currency: string; exchangeRate: string | null;
  domainName: string;
  renewalHistory: Array<{
    id: string; invoiceNumber: string | null; quoteNumber: string | null;
    businessType: string; renewalStatus: string;
    serviceStartDate: string | null; serviceEndDate: string | null;
  }>;
}
interface RZResponse { subscription: RZSub; docs: RZDoc[] }

interface Props {
  subscriptionId: string;
  zohoCustomerId: string;
  org: { id: string; zohoOrgId: string; dataCenter: string };
  domainName: string;
  currency: string;
}

export function ZohoDocsButton({ subscriptionId, org, domainName, currency }: Props) {
  const router = useRouter();
  const btnRef  = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen]       = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  const [loading, setLoading]   = useState(false);
  const [result,  setResult]    = useState<RZResponse | null>(null);
  const [error,   setError]     = useState<string | null>(null);
  const [actionStates, setActionStates] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  function computePos() {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const left = Math.min(rect.right - POPUP_W, window.innerWidth - POPUP_W - 16);
    setPopupPos({ top: rect.bottom + 8, left: Math.max(8, left) });
  }

  async function doFetch() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/${subscriptionId}/refresh-zoho-docs`, {
        method: 'POST', credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as RZResponse;
      setResult(data);
      setActionStates({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setLoading(false);
    }
  }

  function openPopup() {
    computePos();
    setOpen(true);
    if (!result) void doFetch();
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        popupRef.current && !popupRef.current.contains(e.target as Node) &&
        btnRef.current   && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Reposition on scroll / resize
  useEffect(() => {
    if (!open) return;
    const rp = () => computePos();
    window.addEventListener('resize', rp);
    window.addEventListener('scroll', rp, true);
    return () => { window.removeEventListener('resize', rp); window.removeEventListener('scroll', rp, true); };
  }, [open]);

  async function handleSyncDates(doc: RZDoc, line: RZDLine) {
    const key = `sync-${doc.id}`;
    setActionStates(prev => ({ ...prev, [key]: 'loading' }));
    try {
      const res = await fetch(`${API_BASE}/subscriptions/${subscriptionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startDate: line.startDate,
          endDate:   line.endDate,
          quantity:  line.qty,
          subscriptionPrice: line.rate,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult(prev => prev ? {
        ...prev,
        subscription: {
          ...prev.subscription,
          startDate: line.startDate ?? prev.subscription.startDate,
          endDate:   line.endDate   ?? prev.subscription.endDate,
          quantity:  String(line.qty),
          subscriptionPrice: String(line.rate),
        },
      } : prev);
      setActionStates(prev => ({ ...prev, [key]: 'done' }));
      router.refresh();
    } catch {
      setActionStates(prev => ({ ...prev, [key]: 'error' }));
    }
  }

  async function handleAddHistory(doc: RZDoc, line: RZDLine) {
    const key = `hist-${doc.id}`;
    setActionStates(prev => ({ ...prev, [key]: 'loading' }));
    try {
      const res = await fetch(`${API_BASE}/subscriptions/${subscriptionId}/add-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          history: [{
            invoiceId:     doc.invoiceId     || undefined,
            invoiceNumber: doc.invoiceNumber || undefined,
            invoiceDate:   doc.invoiceDate   || undefined,
            invoiceStatus: doc.invoiceStatus || undefined,
            quoteId:       doc.quoteId       || undefined,
            quoteNumber:   doc.quoteNumber   || undefined,
            quoteDate:     doc.quoteDate     || undefined,
            quoteStatus:   doc.quoteStatus   || undefined,
            startDate:     line.startDate    || undefined,
            endDate:       line.endDate      || undefined,
            quantity:      line.qty,
            price:         line.rate,
            businessType:  doc.businessType  || undefined,
          }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult(prev => {
        if (!prev) return prev;
        const h = {
          id: `tmp-${doc.id}`,
          invoiceNumber: doc.invoiceNumber,
          quoteNumber:   doc.quoteNumber,
          businessType:  doc.businessType ?? 'Renewal',
          renewalStatus: doc.invoiceId ? 'Paid' : 'Quoted',
          serviceStartDate: line.startDate,
          serviceEndDate:   line.endDate,
        };
        return { ...prev, subscription: { ...prev.subscription, renewalHistory: [...prev.subscription.renewalHistory, h] } };
      });
      setActionStates(prev => ({ ...prev, [key]: 'done' }));
      router.refresh();
    } catch {
      setActionStates(prev => ({ ...prev, [key]: 'error' }));
    }
  }

  const sym = CURRENCY_SYMBOL[currency] ?? currency;

  return (
    <>
      <button
        ref={btnRef}
        onClick={openPopup}
        className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border transition-all ${
          open
            ? 'bg-amber-50 border-amber-300 text-amber-700'
            : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700'
        }`}
      >
        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
        Zoho Docs
      </button>

      {mounted && open && popupPos && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onMouseDown={() => setOpen(false)} />
          <div
            ref={popupRef}
            style={{ position: 'fixed', top: popupPos.top, left: popupPos.left, width: POPUP_W, zIndex: 9999, maxHeight: 'calc(100vh - 120px)' }}
            className="bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="px-4 py-2.5 border-b border-amber-100 bg-amber-50 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-amber-800">{domainName} — Zoho Documents</span>
                {loading && <span className="inline-block w-3.5 h-3.5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />}
              </div>
              <div className="flex items-center gap-2">
                {result && (
                  <button
                    onClick={() => void doFetch()}
                    disabled={loading}
                    className="text-xs text-slate-500 hover:text-amber-700 disabled:opacity-40 px-2 py-0.5 rounded border border-slate-200 hover:border-amber-300 transition-colors"
                  >
                    ↺ Re-sync
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="text-slate-300 hover:text-slate-500 leading-none text-sm">✕</button>
              </div>
            </div>

            {/* Body */}
            <div className="px-4 py-3 overflow-y-auto">
              {loading && !result && (
                <div className="py-8 flex flex-col items-center gap-2">
                  <span className="inline-block w-6 h-6 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
                  <p className="text-sm text-slate-500">Syncing from Zoho Books…</p>
                </div>
              )}
              {error && !loading && (
                <div className="py-4 text-center space-y-1">
                  <p className="text-sm text-red-500">{error}</p>
                  <button onClick={() => void doFetch()} className="text-xs text-amber-700 underline">Retry</button>
                </div>
              )}

              {result && (
                <>
                  <div className="mb-3 text-xs text-slate-600 flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-slate-700">Current:</span>
                    <span>{fmtD(result.subscription.startDate)}</span>
                    <span className="text-slate-300">→</span>
                    <span>{fmtD(result.subscription.endDate)}</span>
                    <span className="text-slate-300">·</span>
                    <span>Qty {Number(result.subscription.quantity)}</span>
                    <span className="text-slate-300">·</span>
                    <span>
                      {CURRENCY_SYMBOL[result.subscription.currency] ?? result.subscription.currency}
                      {Number(result.subscription.subscriptionPrice).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </span>
                  </div>

                  {result.docs.length === 0 && (
                    <p className="py-4 text-center text-sm text-slate-400">No Zoho documents found for this domain.</p>
                  )}

                  <div className="space-y-2">
                    {result.docs.map(doc => {
                      const line = doc.domainLines[0];
                      if (!line) return null;

                      const lineEnd    = line.endDate ? new Date(line.endDate) : null;
                      const subEnd     = new Date(result.subscription.endDate);
                      const datesAhead = lineEnd && !isNaN(lineEnd.getTime()) && !isNaN(subEnd.getTime()) && lineEnd > subEnd;

                      const inHistory = result.subscription.renewalHistory.some(h =>
                        (doc.invoiceNumber && h.invoiceNumber === doc.invoiceNumber) ||
                        (doc.quoteNumber   && h.quoteNumber   === doc.quoteNumber),
                      );
                      const proRata = /pro.?rata/i.test(doc.businessType ?? '');

                      const docDate   = doc.invoiceDate ?? doc.quoteDate;
                      const rawStatus = (doc.invoiceStatus ?? doc.quoteStatus ?? '').toLowerCase();

                      const syncKey = `sync-${doc.id}`;
                      const histKey = `hist-${doc.id}`;
                      const syncSt  = actionStates[syncKey] ?? 'idle';
                      const histSt  = actionStates[histKey] ?? 'idle';

                      const btNorm = (doc.businessType ?? '').toLowerCase().replace(/[-\s]/g, '');
                      const btColor = btNorm.includes('renewal')
                        ? 'bg-teal-50 text-teal-700 border-teal-200'
                        : btNorm.includes('pro') && btNorm.includes('rata')
                        ? 'bg-orange-50 text-orange-700 border-orange-200'
                        : btNorm.includes('fresh')
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-slate-50 text-slate-600 border-slate-200';

                      const statusColor = rawStatus === 'paid'
                        ? 'bg-green-100 text-green-800'
                        : rawStatus === 'sent' || rawStatus === 'accepted'
                        ? 'bg-blue-100 text-blue-800'
                        : rawStatus === 'void'
                        ? 'bg-red-100 text-red-700'
                        : rawStatus === 'draft'
                        ? 'bg-slate-100 text-slate-600'
                        : rawStatus === 'expired' || rawStatus === 'declined'
                        ? 'bg-red-100 text-red-700'
                        : rawStatus === 'invoiced'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-slate-100 text-slate-500';

                      return (
                        <div key={doc.id} className="bg-white rounded-lg border border-slate-200 px-4 py-3">
                          {/* Doc header */}
                          <div className="flex items-center gap-2 flex-wrap">
                            {doc.invoiceId && (
                              <span className="flex items-center gap-1.5">
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">Invoice</span>
                                <span className="text-sm font-bold text-slate-800">{doc.invoiceNumber}</span>
                                <a href={buildZohoUrl(org, 'invoices', doc.invoiceId)} target="_blank" rel="noreferrer"
                                  title="Open in Zoho Books" className="text-slate-400 hover:text-blue-600 transition-colors">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                  </svg>
                                </a>
                              </span>
                            )}
                            {doc.quoteId && (
                              <span className="flex items-center gap-1.5">
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">Quote</span>
                                <span className="text-sm font-bold text-slate-800">{doc.quoteNumber}</span>
                                <a href={buildZohoUrl(org, 'estimates', doc.quoteId)} target="_blank" rel="noreferrer"
                                  title="Open in Zoho Books" className="text-slate-400 hover:text-blue-600 transition-colors">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                  </svg>
                                </a>
                              </span>
                            )}
                            {docDate && <span className="text-xs text-slate-400">{fmtD(docDate)}</span>}
                            {doc.businessType && (
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${btColor}`}>
                                {doc.businessType}
                              </span>
                            )}
                            {rawStatus && (
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${statusColor}`}>
                                {doc.invoiceStatus ?? doc.quoteStatus}
                              </span>
                            )}
                            {datesAhead && (
                              <span className="ml-auto text-xs text-amber-600 font-medium">▲ dates ahead of subscription</span>
                            )}
                          </div>

                          {/* Line data */}
                          {(line.startDate || line.endDate || line.qty > 0 || line.rate > 0) && (
                            <div className="mt-1.5 text-xs text-slate-600 flex items-center gap-1.5 flex-wrap">
                              {line.startDate && line.endDate && (
                                <>
                                  <span>{fmtD(line.startDate)}</span>
                                  <span className="text-slate-300">→</span>
                                  <span className={datesAhead ? 'font-semibold text-amber-700' : ''}>{fmtD(line.endDate)}</span>
                                  <span className="text-slate-300">·</span>
                                </>
                              )}
                              {line.qty > 0 && <span>Qty {line.qty}</span>}
                              {line.rate > 0 && (
                                <>
                                  <span className="text-slate-300">·</span>
                                  <span>{sym}{line.rate.toLocaleString('en-IN', { maximumFractionDigits: 0 })}/unit</span>
                                </>
                              )}
                            </div>
                          )}

                          {/* Actions */}
                          <div className="mt-2 flex items-center gap-2 flex-wrap">
                            {datesAhead && (
                              <button
                                onClick={() => void handleSyncDates(doc, line)}
                                disabled={syncSt === 'loading' || syncSt === 'done'}
                                className={`text-xs font-medium px-3 py-1 rounded-lg border transition-colors flex items-center gap-1.5 ${
                                  syncSt === 'done'  ? 'bg-green-50 border-green-200 text-green-700' :
                                  syncSt === 'error' ? 'bg-red-50 border-red-200 text-red-600' :
                                  'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100 disabled:opacity-40'
                                }`}
                              >
                                {syncSt === 'loading' && <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                                {syncSt === 'done' ? '✓ Dates Synced' : syncSt === 'error' ? '✕ Error — retry' : '↑ Sync Dates to Subscription'}
                              </button>
                            )}
                            {!inHistory && (
                              <button
                                onClick={() => void handleAddHistory(doc, line)}
                                disabled={histSt === 'loading' || histSt === 'done'}
                                className={`text-xs font-medium px-3 py-1 rounded-lg border transition-colors flex items-center gap-1.5 ${
                                  histSt === 'done'  ? 'bg-green-50 border-green-200 text-green-700' :
                                  histSt === 'error' ? 'bg-red-50 border-red-200 text-red-600' :
                                  proRata
                                    ? 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100 disabled:opacity-40'
                                    : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 disabled:opacity-40'
                                }`}
                              >
                                {histSt === 'loading' && <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                                {histSt === 'done' ? '✓ Added to History' : histSt === 'error' ? '✕ Error — retry' : proRata ? '+ Add Pro-rata' : '+ Add to Order History'}
                              </button>
                            )}
                            {inHistory && (
                              <span className="text-xs text-slate-400 italic flex items-center gap-1">
                                <span className="text-green-500">✓</span> Already in order history
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
