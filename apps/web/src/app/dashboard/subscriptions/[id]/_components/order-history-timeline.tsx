'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ViewPdfButton } from '@/components/view-pdf-button';
import { ProformaActions } from './proforma-actions';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

interface RenewalHistory {
  id: string;
  businessType: string;
  renewalStatus: string;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
  quantity: string | null;
  sellingPrice: string | null;
  subtotalAmount: string | null;
  currency: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  quoteDate: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  zohoEstimateStatus: string | null;
  zohoInvoiceStatus: string | null;
  sentAt: string | null;
  createdAt: string;
}

type TimelineRow = RenewalHistory & { synthetic?: boolean };

interface LineItem {
  name: string; qty: number; rate: number;
  domain: string; startDate: string; endDate: string;
}

interface Org {
  id: string;
  name: string;
  zohoOrgId: string;
  dataCenter: string;
}

interface Props {
  timeline: TimelineRow[];
  org: Org;
  currency: string;
  zohoItemName: string | null;
  domainName: string;
  originQuickQuote: { id: string; quoteNumber: string } | null;
}


const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', AUD: 'A$', CAD: 'C$', JPY: '¥',
};

const DC_TLD: Record<string, string> = { in: 'in', com: 'com', eu: 'eu', com_au: 'com.au', jp: 'jp', sa: 'sa' };

const BUSINESS_TYPE_LABEL: Record<string, string> = {
  Renewal: '🔄 Renewal',
  ProRata: '📐 Pro-rata',
  Fresh:   '✨ Fresh Sale',
};

const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  paid:           { label: 'Paid',          cls: 'bg-emerald-100 text-emerald-800' },
  partially_paid: { label: 'Partially Paid', cls: 'bg-teal-100 text-teal-800' },
  sent:           { label: 'Sent',          cls: 'bg-amber-100 text-amber-800' },
  unpaid:         { label: 'Unpaid',        cls: 'bg-amber-100 text-amber-800' },
  overdue:        { label: 'Overdue',       cls: 'bg-red-100 text-red-700' },
  draft:          { label: 'Draft',         cls: 'bg-slate-100 text-slate-600' },
  void:           { label: 'Void',          cls: 'bg-slate-100 text-slate-500 line-through' },
};

const ESTIMATE_STATUS: Record<string, { label: string; cls: string }> = {
  draft:    { label: 'Draft',    cls: 'bg-slate-100 text-slate-600' },
  sent:     { label: 'Sent',     cls: 'bg-blue-100 text-blue-700' },
  accepted: { label: 'Accepted', cls: 'bg-emerald-100 text-emerald-800' },
  declined: { label: 'Declined', cls: 'bg-red-100 text-red-700' },
  invoiced: { label: 'Invoiced', cls: 'bg-indigo-100 text-indigo-700' },
  expired:  { label: 'Expired',  cls: 'bg-orange-100 text-orange-700' },
};

const STATUS_BADGE_COLOR: Record<string, string> = {
  draft:    'bg-slate-100 text-slate-600',
  sent:     'bg-blue-100 text-blue-700',
  accepted: 'bg-emerald-100 text-emerald-800',
  invoiced: 'bg-purple-100 text-purple-700',
  declined: 'bg-red-100 text-red-700',
  expired:  'bg-orange-100 text-orange-700',
  paid:     'bg-emerald-100 text-emerald-700',
  overdue:  'bg-red-100 text-red-700',
  partially_paid: 'bg-teal-100 text-teal-700',
};

function money(amount: number, currency = 'INR'): string {
  const code = (currency || 'INR').toUpperCase();
  const sym = CURRENCY_SYMBOL[code] ?? `${code} `;
  return `${sym}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function buildZohoUrl(org: Org, entity: 'estimates' | 'invoices', id: string) {
  const tld = DC_TLD[org.dataCenter] ?? 'com';
  const path = entity === 'estimates' ? 'quotes' : entity;
  return `https://books.zoho.${tld}/app/${org.zohoOrgId}#/${path}/${id}`;
}

function historyState(h: RenewalHistory): { dot: string; badge: { label: string; cls: string } | null } {
  const inv = (h.zohoInvoiceStatus ?? '').toLowerCase();
  const est = (h.zohoEstimateStatus ?? '').toLowerCase();
  if (inv) {
    const badge = INVOICE_STATUS[inv] ?? { label: inv, cls: 'bg-slate-100 text-slate-600' };
    const dot = inv === 'paid' ? 'bg-emerald-500' : inv === 'overdue' ? 'bg-red-500' : 'bg-amber-500';
    return { dot, badge };
  }
  if (est) {
    const badge = ESTIMATE_STATUS[est] ?? { label: est, cls: 'bg-slate-100 text-slate-600' };
    const dot = est === 'accepted' ? 'bg-emerald-500' : est === 'declined' || est === 'expired' ? 'bg-red-500' : 'bg-blue-500';
    return { dot, badge };
  }
  return { dot: 'bg-slate-300', badge: { label: h.renewalStatus, cls: 'bg-slate-100 text-slate-600' } };
}

const TOOLTIP_W = 420;

function LiveLineItemTooltip({ orgId, kind, docId, fallbackStatus, businessType }: {
  orgId: string;
  kind: 'estimate' | 'invoice';
  docId: string;
  fallbackStatus: string;
  businessType: string;
}) {
  const [state, setState] = useState<{ loading: boolean; items: LineItem[]; docStatus: string | null; error: string | null }>({
    loading: true, items: [], docStatus: null, error: null,
  });

  useEffect(() => {
    fetch(
      `${API_BASE}/organizations/${orgId}/zoho-doc-line-items?kind=${kind}&doc_id=${encodeURIComponent(docId)}`,
      { credentials: 'include' },
    )
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: { lineItems: LineItem[]; docStatus: string | null }) =>
        setState({ loading: false, items: data.lineItems ?? [], docStatus: data.docStatus ?? null, error: null }),
      )
      .catch((err: Error) =>
        setState({ loading: false, items: [], docStatus: null, error: err.message }),
      );
  }, [orgId, kind, docId]);

  const statusKey = (state.docStatus ?? fallbackStatus).toLowerCase();
  const colorCls = STATUS_BADGE_COLOR[statusKey] ?? 'bg-slate-100 text-slate-600';
  const total = state.items.reduce((s, li) => s + li.qty * li.rate, 0);
  const fmt = (d: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '?';

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden" style={{ width: TOOLTIP_W }}>
      <div className="bg-slate-800 text-white px-3 py-2 flex items-center justify-between">
        <span className="font-bold uppercase tracking-wider text-[10px] text-slate-300">LINE ITEMS</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${colorCls}`}>
          {statusKey}
        </span>
      </div>

      {state.loading && (
        <div className="px-4 py-3 text-xs text-slate-400 flex items-center gap-2">
          <span className="animate-spin inline-block w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full" />
          Loading…
        </div>
      )}
      {state.error && (
        <div className="px-4 py-3 text-xs text-red-500">❌ {state.error}</div>
      )}
      {!state.loading && !state.error && state.items.length === 0 && (
        <div className="px-4 py-3 text-xs text-slate-400">No line items found</div>
      )}
      {!state.loading && !state.error && state.items.length > 0 && (
        <>
          <div className="divide-y divide-slate-50">
            {state.items.map((li, idx) => (
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
                      {fmt(li.startDate)} → {fmt(li.endDate)}
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
            <span className="text-[10px] text-slate-400">{businessType} · {state.items.length} item{state.items.length !== 1 ? 's' : ''}</span>
            <span className="text-xs font-bold text-slate-800 tabular-nums">
              Total ₹{total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function DocNumberCell({
  number,
  zohoHref,
  tooltipNode,
}: {
  number: string;
  zohoHref?: string;
  tooltipNode: React.ReactNode;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [linePos, setLinePos] = useState<{ x: number; y: number } | null>(null);
  const [zohoPos, setZohoPos] = useState<{ x: number; y: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const onNumEnter = () => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const cx = r.left + r.width / 2 - TOOLTIP_W / 2;
    setLinePos({ x: Math.max(8, Math.min(cx, window.innerWidth - TOOLTIP_W - 8)), y: r.top });
  };

  const onZohoEnter = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setZohoPos({ x: r.left + r.width / 2, y: r.top });
  };

  return (
    <span className="inline-flex items-center gap-1">
      <span
        ref={triggerRef}
        onMouseEnter={onNumEnter}
        onMouseLeave={() => setLinePos(null)}
        className="font-mono text-blue-600 cursor-default underline decoration-dotted decoration-blue-300"
      >
        {number}
      </span>
      {zohoHref && (
        <a
          href={zohoHref}
          target="_blank"
          rel="noopener noreferrer"
          onMouseEnter={onZohoEnter}
          onMouseLeave={() => setZohoPos(null)}
          className="text-slate-400 hover:text-blue-600 transition-colors"
          aria-label="Open in Zoho Books"
        >
          ↗
        </a>
      )}
      {mounted && linePos && createPortal(
        <div style={{ position: 'fixed', left: linePos.x, top: linePos.y, transform: 'translateY(calc(-100% - 8px))', zIndex: 9999 }}>
          {tooltipNode}
        </div>,
        document.body,
      )}
      {mounted && zohoPos && createPortal(
        <div style={{ position: 'fixed', left: zohoPos.x, top: zohoPos.y, transform: 'translate(-50%, calc(-100% - 4px))', zIndex: 9999 }}>
          <div className="bg-slate-800 text-white text-[10px] px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
            Open in Zoho Books
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}

export function OrderHistoryTimeline({ timeline, org, currency, zohoItemName, domainName, originQuickQuote }: Props) {
  const [syncState, setSyncState] = useState<Record<string, 'idle' | 'syncing' | 'error'>>({});
  const [localDates, setLocalDates] = useState<Record<string, { start: string; end: string }>>({});

  const syncDates = async (historyId: string) => {
    setSyncState(prev => ({ ...prev, [historyId]: 'syncing' }));
    try {
      const res = await fetch(`${API_BASE}/subscriptions/renewal-history/${historyId}/sync-dates`, {
        method: 'POST', credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = await res.json() as { serviceStartDate: string | null; serviceEndDate: string | null };
      setLocalDates(prev => ({
        ...prev,
        [historyId]: { start: updated.serviceStartDate ?? '', end: updated.serviceEndDate ?? '' },
      }));
      setSyncState(prev => ({ ...prev, [historyId]: 'idle' }));
    } catch {
      setSyncState(prev => ({ ...prev, [historyId]: 'error' }));
      setTimeout(() => setSyncState(prev => ({ ...prev, [historyId]: 'idle' })), 3000);
    }
  };

  if (timeline.length === 0) {
    return <p className="px-5 py-6 text-sm text-slate-400">अभी तक कोई order history नहीं।</p>;
  }

  return (
    <div className="px-5 py-5">
      <div className="relative pl-6 border-l-2 border-slate-200 space-y-6">
        {timeline.map((h) => {
          const { dot, badge } = historyState(h);
          const internalQuote =
            h.businessType === 'Fresh' && !h.quoteId && h.quoteNumber && originQuickQuote
              ? originQuickQuote
              : null;
          const overrideDates = localDates[h.id];
          const displayStart = overrideDates?.start ?? h.serviceStartDate;
          const displayEnd   = overrideDates?.end   ?? h.serviceEndDate;
          const hasDoc = !!(h.invoiceId || h.quoteId);

          return (
            <div key={h.id} className="relative">
              <div className={`absolute -left-[31px] top-0.5 w-4 h-4 rounded-full border-2 border-white ${dot}`} />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-800">
                      {BUSINESS_TYPE_LABEL[h.businessType] ?? h.businessType}
                    </span>
                    <span className="text-xs text-slate-400">{fmtDate(h.quoteDate ?? h.createdAt)}</span>
                  </div>

                  {/* Quote → Invoice → Status chain */}
                  <div className="flex items-center gap-2 flex-wrap mt-1 text-xs">
                    {internalQuote ? (
                      <Link href={`/dashboard/quick-quotes/${internalQuote.id}`}
                        className="font-mono text-blue-600 hover:underline">
                        {h.quoteNumber}
                      </Link>
                    ) : h.quoteId ? (
                      <span className="inline-flex items-center gap-1">
                        <DocNumberCell
                          number={h.quoteNumber ?? 'Quote'}
                          zohoHref={buildZohoUrl(org, 'estimates', h.quoteId)}
                          tooltipNode={
                            <LiveLineItemTooltip
                              orgId={org.id}
                              kind="estimate"
                              docId={h.quoteId}
                              fallbackStatus={h.zohoEstimateStatus ?? h.renewalStatus ?? 'draft'}
                              businessType={h.businessType}
                            />
                          }
                        />
                        <ViewPdfButton orgId={org.id} kind="estimate" docId={h.quoteId}
                          label="📄" title="View quote PDF"
                          className="inline-flex items-center px-1.5 py-0.5 text-[11px] rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40" />
                      </span>
                    ) : h.quoteNumber ? (
                      <span className="font-mono text-slate-500">{h.quoteNumber}</span>
                    ) : (
                      <span className="text-slate-300">no quote</span>
                    )}

                    <span className="text-slate-300">→</span>

                    {h.invoiceId ? (
                      <span className="inline-flex items-center gap-1">
                        <DocNumberCell
                          number={h.invoiceNumber ?? 'Invoice'}
                          zohoHref={buildZohoUrl(org, 'invoices', h.invoiceId)}
                          tooltipNode={
                            <LiveLineItemTooltip
                              orgId={org.id}
                              kind="invoice"
                              docId={h.invoiceId}
                              fallbackStatus={h.zohoInvoiceStatus ?? 'draft'}
                              businessType={h.businessType}
                            />
                          }
                        />
                        <ViewPdfButton orgId={org.id} kind="invoice" docId={h.invoiceId}
                          label="📄" title="View invoice PDF"
                          className="inline-flex items-center px-1.5 py-0.5 text-[11px] rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40" />
                      </span>
                    ) : h.invoiceNumber ? (
                      <span className="font-mono text-slate-500">{h.invoiceNumber}</span>
                    ) : (
                      <span className="text-slate-300">not invoiced</span>
                    )}

                    {badge && (
                      <>
                        <span className="text-slate-300">→</span>
                        <span className={`px-2 py-0.5 rounded font-medium ${badge.cls}`}>{badge.label}</span>
                      </>
                    )}
                  </div>

                  <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                    <span>
                      {fmtDate(displayStart)} → {fmtDate(displayEnd)}
                      {h.subtotalAmount && ` · ${money(Number(h.subtotalAmount), h.currency ?? currency)}`}
                    </span>
                    {hasDoc && !h.synthetic && (
                      <button
                        onClick={() => void syncDates(h.id)}
                        disabled={syncState[h.id] === 'syncing'}
                        title="Sync dates from Zoho invoice/quote line items"
                        className="text-slate-300 hover:text-blue-500 disabled:opacity-40 transition-colors leading-none"
                      >
                        {syncState[h.id] === 'syncing' ? (
                          <span className="inline-block w-3 h-3 border border-slate-300 border-t-blue-500 rounded-full animate-spin" />
                        ) : syncState[h.id] === 'error' ? (
                          <span className="text-red-400 text-[10px]">!</span>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                            <path fillRule="evenodd" d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.932.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-1.242l.842.84V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44 1.241l-.84-.84v1.371a.75.75 0 0 1-1.5 0V9.591a.75.75 0 0 1 .75-.75H5.35a.75.75 0 0 1 0 1.5H3.98l.841.841a4.5 4.5 0 0 0 7.08-.932.75.75 0 0 1 1.025-.273Z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    )}
                  </p>
                </div>

                {!h.synthetic && (
                  <ProformaActions
                    historyId={h.id}
                    quoteId={h.quoteId}
                    quoteNumber={h.quoteNumber}
                    invoiceId={h.invoiceId}
                    invoiceNumber={h.invoiceNumber}
                    renewalStatus={h.renewalStatus}
                    zohoEstimateStatus={h.zohoEstimateStatus}
                    zohoInvoiceStatus={h.zohoInvoiceStatus}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
