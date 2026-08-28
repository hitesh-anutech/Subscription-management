'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ViewPdfButton } from '@/components/view-pdf-button';
import { ProformaActions } from './proforma-actions';

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

const TOOLTIP_W = 360;

function HistoryLineItemTooltip({ h, type, zohoItemName, domainName, currency }: {
  h: RenewalHistory;
  type: 'quote' | 'invoice';
  zohoItemName: string | null;
  domainName: string;
  currency: string;
}) {
  const rawStatus = type === 'quote'
    ? (h.zohoEstimateStatus ?? h.renewalStatus ?? 'draft')
    : (h.zohoInvoiceStatus ?? 'draft');
  const status = rawStatus.toLowerCase();
  const colorCls = STATUS_BADGE_COLOR[status] ?? 'bg-slate-100 text-slate-600';
  const effectiveCurrency = h.currency ?? currency;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden" style={{ width: TOOLTIP_W }}>
      <div className="bg-slate-800 text-white px-3 py-2 flex items-center justify-between">
        <span className="font-bold uppercase tracking-wider text-[10px] text-slate-300">LINE ITEMS</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${colorCls}`}>
          {status}
        </span>
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 py-1">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-slate-800 text-xs truncate">{zohoItemName ?? 'Item'}</div>
            <div className="text-[10px] text-slate-500 font-mono mt-0.5">{domainName}</div>
            {(h.serviceStartDate || h.serviceEndDate) && (
              <div className="text-[10px] text-slate-400 mt-0.5">
                {fmtDate(h.serviceStartDate)} → {fmtDate(h.serviceEndDate)}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            {h.quantity && h.sellingPrice && (
              <div className="text-[10px] text-slate-500">
                {h.quantity} × {money(Number(h.sellingPrice), effectiveCurrency)}
              </div>
            )}
            {h.subtotalAmount && (
              <div className="font-semibold text-slate-800 text-xs">
                {money(Number(h.subtotalAmount), effectiveCurrency)}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="bg-slate-50 border-t border-slate-200 px-3 py-2 flex justify-between items-center">
        <span className="text-[10px] text-slate-500 font-medium">{h.businessType}</span>
        {h.subtotalAmount && (
          <span className="font-bold text-slate-900 text-xs">
            {money(Number(h.subtotalAmount), effectiveCurrency)}
          </span>
        )}
      </div>
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
                            <HistoryLineItemTooltip h={h} type="quote" zohoItemName={zohoItemName} domainName={domainName} currency={currency} />
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
                            <HistoryLineItemTooltip h={h} type="invoice" zohoItemName={zohoItemName} domainName={domainName} currency={currency} />
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

                  <p className="text-xs text-slate-400 mt-1">
                    {fmtDate(h.serviceStartDate)} → {fmtDate(h.serviceEndDate)}
                    {h.subtotalAmount && ` · ${money(Number(h.subtotalAmount), h.currency ?? currency)}`}
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
