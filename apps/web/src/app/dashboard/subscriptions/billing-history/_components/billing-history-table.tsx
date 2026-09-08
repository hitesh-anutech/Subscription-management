'use client';

import Link from 'next/link';
import { useState, useTransition, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ViewPdfButton } from '@/components/view-pdf-button';
import { SendEmailModal } from '@/components/send-email-modal';
import {
  sendProformaAction, getEmailPreviewAction, refreshProformaAction,
  sendInvoiceAction, getInvoiceEmailPreviewAction, convertProformaToInvoiceAction,
} from '../../[id]/actions';
import { Mail, RefreshCw, Zap, ArrowRight, FileText, Activity, X } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

interface BillingHistoryItem {
  id: string;
  createdAt: string;
  businessType: string;
  billingCycle: string;
  renewalStatus: string;
  zohoEstimateStatus: string | null;
  zohoInvoiceStatus: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  amount: number;
  currency: string;
  zohoCustomerName: string | null;
  zohoCustomerId: string | null;
  zohoItemName: string | null;
  domainCount: number;
  domainName: string | null;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
  quantity: string | null;
  sellingPrice: string | null;
  organization: {
    id: string;
    name: string;
    zohoOrgId: string;
    dataCenter: string;
  };
}

const DC_TLD: Record<string, string> = { in: 'in', com: 'com', eu: 'eu', com_au: 'com.au', jp: 'jp', sa: 'sa' };

function zohoUrl(org: BillingHistoryItem['organization'], entity: 'estimates' | 'invoices', id: string) {
  const tld = DC_TLD[org.dataCenter] ?? 'com';
  const path = entity === 'estimates' ? 'quotes' : entity;
  return `https://books.zoho.${tld}/app/${org.zohoOrgId}#/${path}/${id}`;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', AUD: 'A$', CAD: 'C$', JPY: '¥',
};

function money(amount: number, currency = 'INR'): string {
  const code = (currency || 'INR').toUpperCase();
  const sym = CURRENCY_SYMBOL[code] ?? `${code} `;
  return `${sym}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

const TOOLTIP_W = 380;

const STATUS_COLOR: Record<string, string> = {
  draft:    'bg-slate-100 text-slate-600',
  sent:     'bg-blue-100 text-blue-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  invoiced: 'bg-purple-100 text-purple-700',
  declined: 'bg-red-100 text-red-700',
  expired:  'bg-orange-100 text-orange-700',
  paid:     'bg-emerald-100 text-emerald-700',
  overdue:  'bg-red-100 text-red-700',
};

interface ZohoLineItem { name: string; qty: number; rate: number; domain: string; startDate: string; endDate: string; }

function BillingLineItemTooltip({ item, type }: { item: BillingHistoryItem; type: 'quote' | 'invoice' }) {
  const orgId = item.organization.id;
  const docId = type === 'invoice' ? item.invoiceId : item.quoteId;
  const kind: 'invoice' | 'estimate' = type === 'invoice' ? 'invoice' : 'estimate';
  const fallbackStatus = type === 'invoice'
    ? (item.zohoInvoiceStatus ?? item.renewalStatus ?? 'draft')
    : (item.zohoEstimateStatus ?? item.renewalStatus ?? 'draft');

  const [state, setState] = useState<{ loading: boolean; items: ZohoLineItem[]; docStatus: string | null; balance: number | null; error: string | null }>({
    loading: false, items: [], docStatus: null, balance: null, error: null,
  });
  const fetched = useRef(false);

  useEffect(() => {
    if (!docId || !orgId || fetched.current) return;
    fetched.current = true;
    setState(s => ({ ...s, loading: true }));
    fetch(`${API_BASE}/organizations/${orgId}/zoho-doc-line-items?kind=${kind}&doc_id=${encodeURIComponent(docId)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: { lineItems: ZohoLineItem[]; docStatus: string | null; balance: number | null }) =>
        setState({ loading: false, items: data.lineItems ?? [], docStatus: data.docStatus ?? null, balance: data.balance ?? null, error: null }),
      )
      .catch((err: Error) => setState(s => ({ ...s, loading: false, error: err.message })));
  }, [docId, orgId, kind]);

  const statusKey = (state.docStatus ?? fallbackStatus).toLowerCase();
  const colorCls = STATUS_COLOR[statusKey] ?? 'bg-slate-100 text-slate-600';
  const liveTotal = state.items.reduce((s, li) => s + li.qty * li.rate, 0);
  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '?';

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
      {state.error && <div className="px-4 py-3 text-xs text-red-500">❌ {state.error}</div>}

      {/* Live items from Zoho */}
      {!state.loading && !state.error && state.items.length > 0 && (
        <>
          <div className="divide-y divide-slate-50">
            {state.items.map((li, idx) => (
              <div key={idx} className="px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-800 text-xs truncate">{li.name}</div>
                    {li.domain && <div className="text-[10px] text-slate-500 font-mono mt-0.5">{li.domain}</div>}
                    {(li.startDate || li.endDate) && (
                      <div className="text-[10px] text-slate-400 mt-0.5">{fmt(li.startDate)} → {fmt(li.endDate)}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-slate-500">{li.qty} × ₹{li.rate.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                    <div className="font-semibold text-slate-800 text-xs">₹{(li.qty * li.rate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-slate-50 border-t border-slate-200 px-3 py-2">
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-slate-500 font-medium">{item.billingCycle} · {item.businessType}</span>
              <span className="font-bold text-slate-900 text-xs">Total ₹{liveTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
            </div>
            {state.balance !== null && state.balance > 0 && (
              <div className="flex justify-between items-center mt-1">
                <span className="text-[10px] text-red-500 font-medium">Balance Due</span>
                <span className="text-[11px] font-bold text-red-600 tabular-nums">
                  ₹{state.balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Fallback: local data before Zoho fetch or when no doc ID */}
      {!state.loading && !state.error && state.items.length === 0 && (
        <>
          <div className="p-3">
            <div className="flex items-start justify-between gap-2 py-1">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800 text-xs truncate">{item.zohoItemName ?? 'Item'}</div>
                {item.domainCount <= 1 && item.domainName && (
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">{item.domainName}</div>
                )}
                {item.domainCount > 1 && (
                  <div className="text-[10px] text-slate-500 mt-0.5">{item.domainCount} domains (Bulk)</div>
                )}
                {item.domainCount <= 1 && (item.serviceStartDate || item.serviceEndDate) && (
                  <div className="text-[10px] text-slate-400 mt-0.5">{fmtDate(item.serviceStartDate)} → {fmtDate(item.serviceEndDate)}</div>
                )}
              </div>
              <div className="text-right shrink-0">
                {item.domainCount <= 1 && item.quantity && item.sellingPrice && (
                  <div className="text-[10px] text-slate-500">{item.quantity} × {money(Number(item.sellingPrice), item.currency)}</div>
                )}
                <div className="font-semibold text-slate-800 text-xs">{money(item.amount, item.currency)}</div>
              </div>
            </div>
          </div>
          <div className="bg-slate-50 border-t border-slate-200 px-3 py-2 flex justify-between items-center">
            <span className="text-[10px] text-slate-500 font-medium">{item.billingCycle} · {item.businessType}</span>
            <span className="font-bold text-slate-900 text-xs">{money(item.amount, item.currency)}</span>
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
    <div className="flex items-center gap-1.5">
      <span
        ref={triggerRef}
        onMouseEnter={onNumEnter}
        onMouseLeave={() => setLinePos(null)}
        className="font-mono text-xs font-medium text-blue-600 cursor-default underline decoration-dotted decoration-blue-300"
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
          className="text-slate-400 hover:text-blue-600 transition-colors leading-none text-xs"
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
    </div>
  );
}

type Mode = 'quote' | 'invoice';

function BillingHistoryRow({ item, idx }: { item: BillingHistoryItem; idx: number }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [modal, setModal] = useState<Mode | 'activity' | null>(null);
  const [activityData, setActivityData] = useState<{ quoteComments: any[], invoiceComments: any[] } | null>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);

  const handleRefresh = () => {
    setMsg(null);
    startRefresh(async () => {
      const res = await refreshProformaAction(item.id);
      if (res.error) setMsg(res.error);
      else router.refresh();
    });
  };

  const handleConvert = () => {
    setMsg(null);
    startRefresh(async () => {
      const res = await convertProformaToInvoiceAction(item.id);
      if (res.error) setMsg(res.error);
      else router.refresh();
    });
  };

  const handleActivity = () => {
    setMsg(null);
    setModal('activity');
    setLoadingActivity(true);
    fetch(`/api/subscriptions/billing-history/${item.id}/activity`)
      .then(res => res.json())
      .then(d => { setActivityData(d); setLoadingActivity(false); })
      .catch(() => setLoadingActivity(false));
  };

  const estStatus = (item.zohoEstimateStatus ?? 'draft').toLowerCase();
  const quoteSent = ['sent', 'accepted', 'invoiced'].includes(estStatus);
  const hasInvoice = Boolean(item.invoiceId);
  const invoicePaid = (item.zohoInvoiceStatus ?? '').toLowerCase() === 'paid';
  const isInvoice = modal === 'invoice';

  return (
    <>
      <tr className="hover:bg-slate-50/50 transition-colors">
        <td className="py-3 px-4 text-center text-slate-400">{idx + 1}</td>
        <td className="py-3 px-4">
          <span className="text-slate-700 block">{new Date(item.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          <span className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
        </td>
        <td className="py-3 px-4">
          {item.zohoCustomerId ? (
            <Link
              href={`/dashboard/customers/${item.zohoCustomerId}?org_id=${item.organization.zohoOrgId}`}
              className="text-blue-600 hover:underline font-medium block truncate max-w-48"
            >
              {item.zohoCustomerName ?? 'Customer'}
            </Link>
          ) : (
            <span className="text-slate-700 font-medium block truncate max-w-48">
              {item.zohoCustomerName ?? 'Unknown'}
            </span>
          )}
          <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 rounded">{item.organization.name}</span>
        </td>
        <td className="py-3 px-4">
          <span className="block text-slate-800 font-medium">{item.businessType}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100 mt-0.5 inline-block">{item.billingCycle || 'N/A'}</span>
        </td>
        <td className="py-3 px-4">
          <span className="text-slate-600 block truncate max-w-48" title={item.zohoItemName || ''}>
            {item.zohoItemName}
          </span>
          <span className="text-xs text-slate-500 block mt-0.5 font-medium">
            {item.domainCount > 1 ? `${item.domainCount} domains (Bulk)` : item.domainName ?? '1 domain'}
          </span>
        </td>
        <td className="py-3 px-4">
          <span className="font-semibold text-slate-800">{money(item.amount, item.currency)}</span>
        </td>
        <td className="py-3 px-4">
          {item.quoteNumber ? (
            <div className="flex flex-col gap-1.5">
              <DocNumberCell
                number={item.quoteNumber}
                zohoHref={item.quoteId ? zohoUrl(item.organization, 'estimates', item.quoteId) : undefined}
                tooltipNode={<BillingLineItemTooltip item={item} type="quote" />}
              />
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                  {item.zohoEstimateStatus || item.renewalStatus}
                </span>
                {item.quoteId && (
                  <>
                    <ViewPdfButton
                      orgId={item.organization.zohoOrgId}
                      kind="estimate"
                      docId={item.quoteId}
                      label="PDF"
                      className="text-[10px] border border-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-50 text-slate-600 transition-colors font-medium"
                    />
                    <button
                      type="button"
                      disabled={!!item.invoiceId}
                      onClick={() => { setMsg(null); setModal('quote'); }}
                      title={item.invoiceId ? 'Quote is already invoiced' : (quoteSent ? 'Resend Quote' : 'Send Quote')}
                      className={`p-1 rounded-md transition-colors ${
                        item.invoiceId 
                          ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                          : quoteSent 
                          ? 'bg-slate-400 hover:bg-slate-500 text-white' 
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}
                    >
                      <Mail size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <span className="text-slate-300 text-xs italic">No Quote</span>
          )}
        </td>
        <td className="py-3 px-4">
          {item.invoiceId ? (
            <div className="flex flex-col gap-1.5">
              <DocNumberCell
                number={item.invoiceNumber ?? ''}
                zohoHref={zohoUrl(item.organization, 'invoices', item.invoiceId)}
                tooltipNode={<BillingLineItemTooltip item={item} type="invoice" />}
              />
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
                  item.zohoInvoiceStatus === 'paid' ? 'bg-emerald-100 text-emerald-800' :
                  item.zohoInvoiceStatus === 'sent' ? 'bg-amber-100 text-amber-800' :
                  item.zohoInvoiceStatus === 'overdue' ? 'bg-red-100 text-red-800' :
                  'bg-slate-100 text-slate-600'
                }`}>
                  {item.zohoInvoiceStatus === 'sent' ? 'SENT' : (item.zohoInvoiceStatus || 'draft')}
                </span>
                <ViewPdfButton
                  orgId={item.organization.zohoOrgId}
                  kind="invoice"
                  docId={item.invoiceId}
                  label="PDF"
                  className="text-[10px] border border-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-50 text-slate-600 transition-colors font-medium"
                />
                <button
                  type="button"
                  onClick={() => { setMsg(null); setModal('invoice'); }}
                  disabled={invoicePaid}
                  title={invoicePaid ? 'Invoice Paid' : 'Send Invoice'}
                  className="p-1 rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 transition-colors"
                >
                  <Mail size={14} />
                </button>
              </div>
            </div>
          ) : item.quoteId ? (
            <div className="flex items-center">
              <button
                type="button"
                disabled={refreshing}
                onClick={handleConvert}
                title="Convert Quote to Tax Invoice"
                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md font-medium text-white bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 transition-colors shadow-sm"
              >
                <Zap size={12} fill="currentColor" /> Convert to Invoice
              </button>
            </div>
          ) : (
            <span className="text-slate-300 text-[11px] italic">No Invoice</span>
          )}
        </td>
        <td className="py-3 px-4 bg-slate-50/30">
          <div className="flex flex-col gap-2 items-start">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={refreshing}
                onClick={handleRefresh}
                title="Sync status from Zoho Books"
                className={`p-1.5 rounded-md border border-slate-200 text-slate-500 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 transition-colors ${refreshing ? 'animate-spin opacity-50' : ''}`}
              >
                <RefreshCw size={14} />
              </button>
              <button
                type="button"
                onClick={handleActivity}
                title="View Activity History"
                className="p-1.5 rounded-md border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 transition-colors"
              >
                <Activity size={14} />
              </button>
            </div>

            {msg && <span className="text-[10px] text-red-600 max-w-[120px] leading-tight block">{msg}</span>}

            {item.domainCount > 1 ? (
              <Link
                href={`/dashboard/subscriptions?search=${item.quoteNumber || item.invoiceNumber || item.zohoCustomerName}`}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-700 font-medium transition-colors border border-slate-200"
              >
                <FileText size={12} /> View Subs ({item.domainCount}) <ArrowRight size={12} />
              </Link>
            ) : (
              <Link
                href={`/dashboard/subscriptions?search=${item.domainName}`}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-700 font-medium transition-colors border border-slate-200"
              >
                <FileText size={12} /> View Sub <ArrowRight size={12} />
              </Link>
            )}
          </div>
        </td>
      </tr>

      {(modal === 'quote' || modal === 'invoice') && (
        <SendEmailModal
          title={isInvoice ? '🧾 Send Tax Invoice' : '✉ Send Quote Email'}
          sendLabel={isInvoice ? '🧾 Send Invoice' : '✉ Send Quote'}
          docLabel={isInvoice ? 'Tax Invoice' : 'Quote'}
          previewFn={(tpl?: string) => (isInvoice ? getInvoiceEmailPreviewAction : getEmailPreviewAction)(item.id, tpl)}
          sendFn={(override?: { toMailIds?: string[]; ccMailIds?: string[]; bccMailIds?: string[]; subject?: string; body?: string }) => (isInvoice ? sendInvoiceAction : sendProformaAction)(item.id, override)}
          onClose={() => setModal(null)}
          onSent={() => { setModal(null); router.refresh(); }}
        />
      )}

      {modal === 'activity' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-800 flex items-center gap-2">
                <Activity size={18} className="text-blue-500" />
                Quote & Invoice Activity
              </h2>
              <button onClick={() => setModal(null)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto bg-slate-50 flex-1">
              {loadingActivity ? (
                <div className="flex justify-center p-8"><RefreshCw className="animate-spin text-slate-400" /></div>
              ) : (
                <div className="space-y-6">
                  {activityData?.quoteComments && activityData.quoteComments.length > 0 && (
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Quote Activity</h3>
                      <div className="space-y-3">
                        {activityData.quoteComments.map(c => (
                          <div key={c.comment_id} className="bg-white border border-slate-200 p-3 rounded-lg shadow-sm text-sm">
                            <div className="text-slate-800">{c.description}</div>
                            <div className="text-xs text-slate-400 mt-1">
                              {c.date ? new Date(c.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''} {c.time}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {activityData?.invoiceComments && activityData.invoiceComments.length > 0 && (
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Invoice Activity</h3>
                      <div className="space-y-3">
                        {activityData.invoiceComments.map(c => (
                          <div key={c.comment_id} className="bg-white border border-slate-200 p-3 rounded-lg shadow-sm text-sm">
                            <div className="text-slate-800">{c.description}</div>
                            <div className="text-xs text-slate-400 mt-1">
                              {c.date ? new Date(c.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''} {c.time}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(!activityData?.quoteComments?.length && !activityData?.invoiceComments?.length) && (
                    <div className="text-center text-slate-500 italic p-4">No activity found in Zoho Books.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function BillingHistoryTable({ items }: { items: BillingHistoryItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
            <th className="py-3 px-4 w-12 text-center">#</th>
            <th className="py-3 px-4">Date</th>
            <th className="py-3 px-4">Customer</th>
            <th className="py-3 px-4">Type & Cycle</th>
            <th className="py-3 px-4">Item & Domains</th>
            <th className="py-3 px-4">Amount</th>
            <th className="py-3 px-4 min-w-[200px]">Quote</th>
            <th className="py-3 px-4 min-w-[200px]">Invoice</th>
            <th className="py-3 px-4 w-40">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item, idx) => (
            <BillingHistoryRow key={item.id} item={item} idx={idx} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
