'use client';

import Link from 'next/link';
import { useState, useRef, useEffect, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, API_BASE } from '@/lib/api';
import { Trash2 } from 'lucide-react';
import { deleteMultipleSubscriptionsAction } from '../actions';
import { EditSubscriptionButton } from '../[id]/_components/edit-subscription-modal';

interface RenewalHistoryLine {
  id: string;
  quoteId: string | null;
  quoteNumber: string | null;
  quoteDate: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  quantity: string | null;
  sellingPrice: string | null;
  subtotalAmount: string | null;
  currency: string;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
  businessType: string;
  renewalStatus: string;
  zohoEstimateStatus: string | null;
  zohoInvoiceStatus: string | null;
  domain: { domainName: string };
}

interface Comment {
  id: string;
  text: string;
  createdByEmail: string;
  createdAt: string;
}

interface Subscription {
  id: string;
  subscriptionNumber: string;
  zohoCustomerId: string | null;
  zohoCustomerName: string | null;
  zohoItemId: string;
  zohoItemName: string | null;
  quantity: string;
  subscriptionPrice: string;
  currency?: string;
  exchangeRate: string | null;
  billingCycle: string;
  startDate: string;
  endDate: string;
  autoRenew: boolean;
  lifecycleStatus: string;
  processStatus: string;
  lastQuoteNumber: string | null;
  lastQuoteDate: string | null;
  nextRenewalPrice: string | null;
  lastInvoiceNumber: string | null;
  lastInvoiceDate: string | null;
  organization: { id: string; name: string; zohoOrgId: string; dataCenter: string };
  domain: { id: string; domainName: string; googleCustomerId: string | null; googleResellerEmail: string | null };
  subscriptionCategory: string | null;
  _count: { renewalHistory: number; comments: number; googleResellerMatches: number };
  renewalHistory: RenewalHistoryLine[];
}

const CYCLE_BADGE_CLASS: Record<string, string> = {
  monthly:     'bg-blue-100 text-blue-700',
  quarterly:   'bg-violet-100 text-violet-700',
  half_yearly: 'bg-amber-100 text-amber-700',
  annual:      'bg-green-100 text-green-700',
  biennial:    'bg-teal-100 text-teal-700',
  triennial:   'bg-indigo-100 text-indigo-700',
  one_time:    'bg-slate-100 text-slate-500',
};

const CYCLE_LABEL: Record<string, string> = {
  monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-Yearly',
  annual: 'Annual', biennial: 'Biennial', triennial: 'Triennial', one_time: 'One-Time',
};

function cycleLabel(cycle: string) {
  return CYCLE_LABEL[cycle] ?? cycle.replace(/_/g, ' ');
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function initials(email: string) {
  const name = email.split('@')[0];
  const parts = name.split(/[._-]/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', AUD: 'A$', CAD: 'C$', JPY: '¥',
};
/** Format an amount in its billing currency (falls back to the code for unknown currencies). */
function money(amount: number, currency = 'INR'): string {
  const code = (currency || 'INR').toUpperCase();
  const sym = CURRENCY_SYMBOL[code] ?? `${code} `;
  return `${sym}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const PROCESS_STATUS_STYLES: Record<string, string> = {
  Renewal_Quoted:   'bg-blue-100 text-blue-700',
  Renewal_Invoiced: 'bg-indigo-100 text-indigo-700',
  Renewal_Paid:     'bg-emerald-100 text-emerald-800',
  Prorata_Quoted:   'bg-blue-100 text-blue-700',
  Prorata_Invoiced: 'bg-indigo-100 text-indigo-700',
  Prorata_Paid:     'bg-emerald-100 text-emerald-800',
};

function ProcessStatusBadge({ status }: { status: string }) {
  if (!status || status === 'None') return null;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold mt-1 ${PROCESS_STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  Active:         'bg-green-100 text-green-700',
  Expiring_Soon:  'bg-amber-100 text-amber-700',
  Expired:        'bg-red-100 text-red-700',
  Pending:        'bg-slate-100 text-slate-600',
  Cancelled:      'bg-slate-100 text-slate-500 line-through',
  Inactive:       'bg-slate-100 text-slate-400',
};

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function effectiveStatus(stored: string, endDate: string): string {
  // Compute from endDate so stale DB status doesn't show wrong badge
  const days = daysUntil(endDate);
  if (days < 0) return 'Expired';
  if (days <= 30) return 'Expiring_Soon';
  return stored;
}

function fmtShort(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return Infinity;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

const DC_TLD: Record<string, string> = { in: 'in', com: 'com', eu: 'eu', com_au: 'com.au', jp: 'jp', sa: 'sa' };

function zohoUrl(org: Subscription['organization'], entity: 'estimates' | 'invoices', id: string) {
  const tld = DC_TLD[org.dataCenter] ?? 'com';
  const path = entity === 'estimates' ? 'quotes' : entity;
  return `https://books.zoho.${tld}/app/${org.zohoOrgId}#/${path}/${id}`;
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600', sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700', declined: 'bg-red-100 text-red-700',
  invoiced: 'bg-purple-100 text-purple-700', expired: 'bg-orange-100 text-orange-700',
  paid: 'bg-emerald-100 text-emerald-700', overdue: 'bg-red-100 text-red-700',
  partially_paid: 'bg-teal-100 text-teal-700',
  quoted: 'bg-blue-100 text-blue-700',
};

interface LiveLineItem { name: string; qty: number; rate: number; domain: string; startDate: string; endDate: string; }
interface DocFetchState { loading: boolean; items: LiveLineItem[]; docStatus: string | null; balance: number | null; error: string | null; }

const EMPTY_FETCH: DocFetchState = { loading: false, items: [], docStatus: null, balance: null, error: null };

function fetchDoc(orgId: string, docId: string, kind: 'invoice' | 'estimate', set: (s: DocFetchState) => void) {
  set({ loading: true, items: [], docStatus: null, balance: null, error: null });
  fetch(`${API_BASE}/organizations/${orgId}/zoho-doc-line-items?kind=${kind}&doc_id=${encodeURIComponent(docId)}`, { credentials: 'include' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then((data: { lineItems: LiveLineItem[]; docStatus: string | null; balance: number | null }) =>
      set({ loading: false, items: data.lineItems ?? [], docStatus: data.docStatus ?? null, balance: data.balance ?? null, error: null })
    )
    .catch((err: Error) => set({ loading: false, items: [], docStatus: null, balance: null, error: err.message }));
}

// Pure display component — no fetching; receives fetchState from parent cell
function QuoteLineItemsTooltip({ sub, mode = 'quote', fetchState }: { sub: Subscription; mode?: 'quote' | 'invoice'; fetchState: DocFetchState }) {
  const h = mode === 'invoice'
    ? sub.renewalHistory.find(r => r.invoiceNumber === sub.lastInvoiceNumber)
    : sub.renewalHistory.find(r => r.quoteNumber === sub.lastQuoteNumber);
  const fallbackStatus = mode === 'invoice'
    ? (h?.zohoInvoiceStatus ?? h?.renewalStatus ?? '')
    : (h?.zohoInvoiceStatus ?? h?.zohoEstimateStatus ?? h?.renewalStatus ?? '');

  const { loading, items, docStatus, balance, error } = fetchState;
  const statusKey = (docStatus ?? fallbackStatus).toLowerCase();
  const badgeCls = STATUS_BADGE[statusKey] ?? 'bg-slate-100 text-slate-600';
  const total = items.reduce((s, li) => s + li.qty * li.rate, 0);
  const fmt = (d: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '?';

  const localLines = mode === 'invoice'
    ? sub.renewalHistory.filter(r => r.invoiceNumber === sub.lastInvoiceNumber)
    : sub.renewalHistory.filter(r => r.quoteNumber === sub.lastQuoteNumber);
  const localTotal = localLines.reduce((s, r) => s + Number(r.subtotalAmount ?? 0), 0);
  const cur = localLines[0]?.currency ?? sub.currency ?? 'INR';

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xl text-xs overflow-hidden">
      <div className="bg-slate-800 text-white px-3 py-2 flex items-center justify-between">
        <span className="font-bold uppercase tracking-wider text-[10px] text-slate-300">LINE ITEMS</span>
        {(docStatus ?? fallbackStatus) && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${badgeCls}`}>
            {statusKey || fallbackStatus}
          </span>
        )}
      </div>

      {loading && (
        <div className="px-4 py-3 text-slate-400 flex items-center gap-2">
          <span className="animate-spin inline-block w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full" />
          Loading…
        </div>
      )}
      {error && <div className="px-4 py-3 text-red-500">❌ {error}</div>}

      {!loading && !error && items.length > 0 && (
        <>
          <div className="divide-y divide-slate-50">
            {items.map((li, idx) => (
              <div key={idx} className="px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-slate-700 leading-tight flex-1 min-w-0 truncate">{li.name}</p>
                  <p className="font-semibold text-slate-800 shrink-0 tabular-nums">
                    ₹{(li.qty * li.rate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {li.domain && <span className="font-mono text-blue-600 text-[10px]">{li.domain}</span>}
                  {(li.startDate || li.endDate) && (
                    <span className="text-slate-400 text-[10px]">{fmt(li.startDate)} → {fmt(li.endDate)}</span>
                  )}
                  <span className="text-slate-400 text-[10px]">{li.qty} × ₹{li.rate.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-slate-100 bg-slate-50 rounded-b-xl">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-[10px]">{h?.businessType} · {items.length} item{items.length !== 1 ? 's' : ''}</span>
              <span className="font-bold text-slate-800 tabular-nums">Total ₹{total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
            </div>
            {balance !== null && balance > 0 && (
              <div className="flex justify-between items-center mt-1">
                <span className="text-[10px] text-red-500 font-medium">Balance Due</span>
                <span className="text-[11px] font-bold text-red-600 tabular-nums">
                  ₹{balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {!loading && !error && items.length === 0 && localLines.length > 0 && (
        <>
          <div className="divide-y divide-slate-50">
            {localLines.map((r) => (
              <div key={r.id} className="px-3 py-2">
                <p className="font-medium text-slate-800 mb-0.5 truncate">{sub.zohoItemName ?? 'Item'}</p>
                <div className="flex items-center justify-between text-slate-500">
                  <span>
                    <span className="text-blue-600 font-medium">{r.domain.domainName}</span>
                    {r.serviceStartDate && r.serviceEndDate && (
                      <> · {fmtShort(r.serviceStartDate)} → {fmtShort(r.serviceEndDate)}</>
                    )}
                  </span>
                  <span className="ml-4 shrink-0">{r.quantity} × {money(Number(r.sellingPrice ?? 0), r.currency)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-slate-100 bg-slate-50 rounded-b-xl flex justify-between">
            <span className="text-slate-400 text-[10px]">{localLines.length} item{localLines.length !== 1 ? 's' : ''}</span>
            <span className="font-bold text-slate-800">Total {money(localTotal, cur)}</span>
          </div>
        </>
      )}

      {!loading && !error && items.length === 0 && localLines.length === 0 && (
        <div className="px-4 py-3 text-slate-400 italic">No line item data available</div>
      )}
    </div>
  );
}

const TOOLTIP_W = 420;

function DocCell({ sub, mode }: { sub: Subscription; mode: 'quote' | 'invoice' }) {
  const router = useRouter();
  const triggerRef = useRef<HTMLDivElement>(null);
  const zohoRef = useRef<HTMLAnchorElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [zohoTipPos, setZohoTipPos] = useState<{ x: number; y: number } | null>(null);
  const [fetchState, setFetchState] = useState<DocFetchState>(EMPTY_FETCH);
  const [mounted, setMounted] = useState(false);

  const docNumber = mode === 'invoice' ? sub.lastInvoiceNumber : sub.lastQuoteNumber;
  const docDate   = mode === 'invoice' ? sub.lastInvoiceDate   : sub.lastQuoteDate;
  const h = mode === 'invoice'
    ? sub.renewalHistory.find(r => r.invoiceNumber === sub.lastInvoiceNumber)
    : sub.renewalHistory.find(r => r.quoteNumber === sub.lastQuoteNumber);
  const docId = mode === 'invoice' ? (h?.invoiceId ?? null) : (h?.invoiceId ?? h?.quoteId ?? null);
  const kind: 'invoice' | 'estimate' = (mode === 'invoice' || !!h?.invoiceId) ? 'invoice' : 'estimate';
  const zohoEntity: 'invoices' | 'estimates' = mode === 'invoice' ? 'invoices' : 'estimates';
  const zohoDocId = mode === 'invoice' ? h?.invoiceId : h?.quoteId;
  const zohoHref = zohoDocId ? zohoUrl(sub.organization, zohoEntity, zohoDocId) : null;

  useEffect(() => { setMounted(true); }, []);

  // Fetch live from Zoho on mount — no DB status used for badge
  useEffect(() => {
    if (!docNumber || !docId) return;
    fetchDoc(sub.organization.id, docId, kind, setFetchState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally once on mount

  // When quote is invoiced in Zoho but lastInvoiceNumber is missing, silently sync
  useEffect(() => {
    if (mode !== 'quote') return;
    if (fetchState.loading || fetchState.docStatus?.toLowerCase() !== 'invoiced') return;
    if (sub.lastInvoiceNumber) return; // already linked
    fetch(`${API_BASE}/subscriptions/${sub.id}/sync-invoice-from-estimate`, {
      method: 'POST', credentials: 'include',
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: { invoiceNumber?: string } | null) => { if (data?.invoiceNumber) router.refresh(); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchState.docStatus, fetchState.loading]);

  if (!docNumber) return <span className="text-slate-300">—</span>;

  const days = daysSince(docDate);
  const liveStatus = fetchState.docStatus?.toLowerCase() ?? null;
  const badgeCls = liveStatus ? (STATUS_BADGE[liveStatus] ?? '') : '';

  const handleMouseEnter = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const centeredX = rect.left + rect.width / 2 - TOOLTIP_W / 2;
    const clampedX = Math.max(8, Math.min(centeredX, window.innerWidth - TOOLTIP_W - 8));
    setTooltipPos({ x: clampedX, y: rect.top });
  };

  return (
    <>
      <div className="inline-flex items-start gap-1">
        <div
          ref={triggerRef}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={() => setTooltipPos(null)}
          className="inline-block cursor-default"
        >
          <div className="text-[11px] font-mono text-slate-500">{docNumber}</div>
          <div className="text-[10px] mt-0.5 text-slate-400 flex items-center gap-1">
            {days === 0 ? 'Today' : days === 1 ? '1d ago' : `${days}d ago`}
            {fetchState.loading && (
              <span className="inline-block w-2 h-2 rounded-full border border-slate-300 border-t-blue-400 animate-spin" />
            )}
            {!fetchState.loading && liveStatus && badgeCls && (
              <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${badgeCls}`}>{liveStatus}</span>
            )}
          </div>
        </div>
        {zohoHref && (
          <a
            ref={zohoRef}
            href={zohoHref}
            target="_blank"
            rel="noopener noreferrer"
            onMouseEnter={() => {
              if (!zohoRef.current) return;
              const r = zohoRef.current.getBoundingClientRect();
              setZohoTipPos({ x: r.left + r.width / 2, y: r.top });
            }}
            onMouseLeave={() => setZohoTipPos(null)}
            className="text-slate-300 hover:text-blue-500 transition-colors text-xs leading-none mt-0.5"
          >
            ↗
          </a>
        )}
      </div>

      {tooltipPos && mounted && createPortal(
        <div
          style={{ position: 'fixed', left: tooltipPos.x, top: tooltipPos.y, transform: 'translateY(calc(-100% - 8px))', width: TOOLTIP_W, zIndex: 9999 }}
          onMouseEnter={() => setTooltipPos(tooltipPos)}
          onMouseLeave={() => setTooltipPos(null)}
        >
          <QuoteLineItemsTooltip sub={sub} mode={mode} fetchState={fetchState} />
        </div>,
        document.body
      )}
      {zohoTipPos && mounted && createPortal(
        <div style={{ position: 'fixed', left: zohoTipPos.x, top: zohoTipPos.y, transform: 'translate(-50%, calc(-100% - 4px))', zIndex: 9999 }}>
          <div className="bg-slate-800 text-white text-[10px] px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
            Open in Zoho Books
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function LastQuoteCell({ sub }: { sub: Subscription }) { return <DocCell sub={sub} mode="quote" />; }
function LastInvoiceCell({ sub }: { sub: Subscription }) { return <DocCell sub={sub} mode="invoice" />; }

const COMMENTS_POPUP_W = 340;

// ─── Google Reseller Types ────────────────────────────────────────────────────

interface GSubData {
  subscriptionId: string; skuId: string; skuName: string | null; status: string;
  plan: { planName: string; isCommitmentPlan?: boolean } | null;
  seats: { numberOfSeats?: number; maximumNumberOfSeats?: number } | null;
  renewalSettings: { renewalType: string } | null;
  trialSettings: { isInTrial?: boolean } | null;
  creationTime: string | null;
}
interface GData {
  customerId: string; customerDomain: string;
  alternateEmail: string | null; resourceUiUrl: string | null;
  postalAddress: { organizationName?: string; countryCode?: string } | null;
  resellerEmail: string | null;
  subscriptions: GSubData[];
}
interface GApiResp {
  googleCustomerId: string | null; consoleUrl: string | null;
  syncedAt: string | null; googleData: GData | null;
  resellerEmail?: string | null;
}

interface SyncJobStatus {
  jobId: string;
  status: 'running' | 'done' | 'not_found';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  results: Array<{ domainId: string; domainName?: string; success: boolean; error?: string }>;
}

const G_STATUS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  SUSPENDED: 'bg-amber-100 text-amber-800',
  CANCELLED: 'bg-red-100 text-red-700',
};
const G_PLAN: Record<string, string> = {
  FLEXIBLE: 'Flexible', ANNUAL_MONTHLY_PAY: 'Annual (mo)', ANNUAL_YEARLY_PAY: 'Annual (yr)',
  TRIAL: 'Trial', FREE: 'Free',
};

// ─── GoogleResellerButton ────────────────────────────────────────────────────

const G_POPUP_W = 320;

const RESELLER_BADGE_COLORS = [
  { bg: 'bg-blue-100',   text: 'text-blue-700',   border: 'border-blue-300'   },
  { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-300' },
  { bg: 'bg-emerald-100',text: 'text-emerald-700',border: 'border-emerald-300'},
  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  { bg: 'bg-pink-100',   text: 'text-pink-700',   border: 'border-pink-300'   },
  { bg: 'bg-teal-100',   text: 'text-teal-700',   border: 'border-teal-300'   },
];

function resellerBadgeColor(email: string) {
  const domain = email.includes('@') ? email.split('@')[1] : email;
  let h = 0;
  for (let i = 0; i < domain.length; i++) h += domain.charCodeAt(i);
  return RESELLER_BADGE_COLORS[h % RESELLER_BADGE_COLORS.length];
}

export function GoogleResellerButton({ domainId, domainName, googleCustomerId, showAlert = false }: {
  domainId: string; domainName: string; googleCustomerId: string | null; showAlert?: boolean;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const [openAbove, setOpenAbove] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<GApiResp | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  async function openPopup() {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const x = Math.min(rect.right + 8, window.innerWidth - G_POPUP_W - 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < 280;
    setOpenAbove(above);
    const y = above ? rect.top - 4 : rect.bottom + 4;
    setPopupPos({ x, y });
    setOpen(true);

    if (!loaded) {
      setLoading(true);
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
        const res = await fetch(`${apiBase}/google-workspace/customers/${domainId}`, {
          credentials: 'include', cache: 'no-store',
        });
        if (res.ok) setData(await res.json() as GApiResp);
      } catch { /* non-critical */ }
      setLoaded(true);
      setLoading(false);
    }
  }

  function closePopup() { setOpen(false); }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
      const res = await fetch(`${apiBase}/google-workspace/customers/fetch`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domainId }),
      });
      const json = await res.json() as GApiResp & { error?: string };
      if (!res.ok || (json as { error?: unknown }).error) {
        const rawErr = (json as { error?: unknown; message?: string }).error;
        setError(typeof rawErr === 'string' ? rawErr : (json as { message?: string }).message ?? 'Sync failed');
      } else {
        setData({ ...json, googleData: json.googleData ?? null });
        setLoaded(true);
      }
    } catch {
      setError('Server se connect nahi ho paya');
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const gd = data?.googleData ?? null;

  const popup = open && popupPos && (
    <div
      style={{ position: 'fixed', ...(openAbove ? { bottom: window.innerHeight - popupPos.y, left: popupPos.x } : { top: popupPos.y, left: popupPos.x }), width: G_POPUP_W, zIndex: 9999 }}
      className="bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/60">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span className="text-xs font-semibold text-slate-700">Google Reseller</span>
          </div>
          {data?.resellerEmail && (() => {
            const domain = data.resellerEmail!.includes('@') ? data.resellerEmail!.split('@')[1] : data.resellerEmail!;
            const c = resellerBadgeColor(data.resellerEmail!);
            return (
              <span className={`ml-[22px] mt-0.5 inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${c.bg} ${c.text} ${c.border} leading-tight tracking-wide`}>
                {domain}
              </span>
            );
          })()}
        </div>
        {gd && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">● Synced</span>}
      </div>

      <div className="px-4 py-3 space-y-3 max-h-[440px] overflow-y-auto">
        {loading && <p className="text-xs text-slate-400 text-center py-4">Loading…</p>}

        {error && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
        )}

        {!loading && !gd && (
          <div className="space-y-3 py-2">
            <p className="text-xs text-slate-500">
              <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{domainName}</span> — Google data अभी sync नहीं है।
            </p>
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={syncing}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-semibold transition-colors"
            >
              <span className={syncing ? 'animate-spin inline-block' : ''}>🔄</span>
              {syncing ? 'Fetching…' : 'Fetch from Google'}
            </button>
          </div>
        )}

        {!loading && gd && (
          <>
            {/* Customer details */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Customer</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <div>
                  <p className="text-[10px] text-slate-400">Customer ID</p>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-slate-700 text-[10px]">{gd.customerId}</span>
                    <button type="button" onClick={() => { navigator.clipboard.writeText(gd.customerId).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }} className="text-slate-400 hover:text-slate-600 text-[10px]">
                      {copied ? '✓' : '📋'}
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400">Domain</p>
                  <p className="font-mono text-slate-700 text-[10px]">{gd.customerDomain}</p>
                </div>
                {gd.postalAddress?.organizationName && (
                  <div>
                    <p className="text-[10px] text-slate-400">Organization</p>
                    <p className="text-slate-700 text-[11px] font-medium">{gd.postalAddress.organizationName}</p>
                  </div>
                )}
                {gd.postalAddress?.countryCode && (
                  <div>
                    <p className="text-[10px] text-slate-400">Country</p>
                    <p className="text-slate-700 text-[11px] font-medium">{gd.postalAddress.countryCode}</p>
                  </div>
                )}
                {gd.alternateEmail && (
                  <div className="col-span-2">
                    <p className="text-[10px] text-slate-400">Alt Email</p>
                    <p className="text-slate-700 text-[11px]">{gd.alternateEmail}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Console links */}
            <div className="flex flex-wrap gap-1.5">
              <a href={`https://channelservices.cloud.google.com/customers/${gd.customerId}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-semibold border border-blue-200 transition-colors">
                Partner Console
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
              </a>
              {gd.resourceUiUrl && (
                <a href={gd.resourceUiUrl} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 text-[10px] font-semibold border border-slate-200 transition-colors">
                  Admin Console
                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                </a>
              )}
            </div>

            {/* Subscriptions */}
            {gd.subscriptions.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                  Subscriptions ({gd.subscriptions.length})
                </p>
                {gd.subscriptions.map((s) => (
                  <div key={s.subscriptionId} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-[11px] font-semibold text-slate-800 leading-snug">{s.skuName ?? s.skuId}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        {s.trialSettings?.isInTrial && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold">Trial</span>
                        )}
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${G_STATUS[s.status] ?? 'bg-slate-100 text-slate-600'}`}>
                          {s.status}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                      {s.seats?.numberOfSeats !== undefined && (
                        <span>{s.seats.numberOfSeats} seats</span>
                      )}
                      {s.plan?.planName && (
                        <span>{G_PLAN[s.plan.planName] ?? s.plan.planName}</span>
                      )}
                      {s.renewalSettings?.renewalType && (
                        <span className="text-slate-400">{s.renewalSettings.renewalType.replace(/_/g, ' ')}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Sync footer */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              {data?.syncedAt && (
                <p className="text-[10px] text-slate-400">
                  Synced {new Date(data.syncedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
              )}
              <button
                type="button"
                onClick={() => void handleSync()}
                disabled={syncing}
                className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 disabled:text-slate-300 font-medium ml-auto"
              >
                <span className={syncing ? 'animate-spin inline-block' : ''}>🔄</span>
                {syncing ? 'Syncing…' : 'Sync'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? closePopup() : void openPopup())}
        title="Google Reseller"
        className={`relative w-7 h-7 rounded-lg border flex items-center justify-center transition-all ${
          googleCustomerId
            ? 'bg-white border-slate-200 hover:bg-slate-50'
            : 'bg-slate-50 border-slate-200 opacity-40 hover:opacity-70'
        } ${open ? 'ring-1 ring-blue-400' : ''}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill={googleCustomerId ? '#4285F4' : '#94a3b8'}/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill={googleCustomerId ? '#34A853' : '#94a3b8'}/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill={googleCustomerId ? '#FBBC05' : '#94a3b8'}/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill={googleCustomerId ? '#EA4335' : '#94a3b8'}/>
        </svg>
        {showAlert && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-orange-500 border border-white" />
        )}
      </button>
      {mounted && popup && createPortal(popup, document.body)}
    </>
  );
}

// ─── Comments ────────────────────────────────────────────────────────────────

function RowCommentsButton({ subscriptionId, commentCount: initialCount }: { subscriptionId: string; commentCount: number }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [count, setCount] = useState(initialCount);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const openPopup = async () => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(rect.right - COMMENTS_POPUP_W, window.innerWidth - COMMENTS_POPUP_W - 8));
    const y = rect.bottom + 6;
    setPopupPos({ x, y });
    setOpen(true);
    if (!loaded) {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/subscriptions/${subscriptionId}`, { credentials: 'include' });
        const data = await res.json() as { comments?: Comment[] };
        setComments(data.comments ?? []);
        setCount(data.comments?.length ?? initialCount);
        setLoaded(true);
      } catch { /* keep empty */ } finally {
        setLoading(false);
      }
    }
  };

  const handlePost = async () => {
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/${subscriptionId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: trimmed }),
      });
      const data = await res.json() as Comment;
      if (!res.ok) throw new Error('Failed');
      setComments(prev => [...prev, data]);
      setCount(prev => prev + 1);
      setText('');
      textareaRef.current?.focus();
    } catch { /* ignore */ } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    setDeletingId(commentId);
    try {
      await fetch(`${API_BASE}/subscriptions/${subscriptionId}/comments/${commentId}`, {
        method: 'DELETE', credentials: 'include',
      });
      setComments(prev => prev.filter(c => c.id !== commentId));
      setCount(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : void openPopup())}
        title={`Comments (${count})`}
        className={`relative w-7 h-7 rounded-lg border flex items-center justify-center transition-all ${
          open
            ? 'bg-indigo-50 border-indigo-200 text-indigo-600'
            : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600'
        }`}
      >
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-indigo-600 text-white text-[8px] font-bold flex items-center justify-center border border-white leading-none">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && popupPos && mounted && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
          <div
            style={{ position: 'fixed', left: popupPos.x, top: popupPos.y, width: COMMENTS_POPUP_W, zIndex: 9999 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
              <div className="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                  <svg width="12" height="12" fill="none" stroke="#4F46E5" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  Comments {count > 0 && <span className="text-slate-400 font-normal">({count})</span>}
                </span>
                <button onClick={() => setOpen(false)} className="text-slate-300 hover:text-slate-500 text-sm leading-none">✕</button>
              </div>

              <div className="max-h-56 overflow-y-auto">
                {loading && (
                  <div className="px-3 py-4 text-center">
                    <span className="inline-block w-4 h-4 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
                  </div>
                )}
                {!loading && comments.length === 0 && (
                  <p className="px-3 py-4 text-center text-[11px] text-slate-400">No comments yet.</p>
                )}
                {!loading && comments.map(c => (
                  <div key={c.id} className="px-3 py-2 border-b border-slate-50 flex gap-2 group last:border-0">
                    <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {initials(c.createdByEmail)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[10px] font-semibold text-slate-700">{c.createdByEmail.split('@')[0]}</span>
                        <span className="text-[9px] text-slate-400">{fmtDateTime(c.createdAt)}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5 whitespace-pre-wrap break-words">{c.text}</p>
                    </div>
                    <button
                      onClick={() => void handleDelete(c.id)}
                      disabled={deletingId === c.id}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-red-500 disabled:opacity-30 shrink-0 mt-0.5"
                    >
                      {deletingId === c.id
                        ? <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                        : <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      }
                    </button>
                  </div>
                ))}
              </div>

              <div className="px-3 py-2.5 border-t border-slate-100 flex gap-2">
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void handlePost(); }}
                  placeholder="Comment likhao… (Ctrl+Enter)"
                  rows={2}
                  className="flex-1 px-2.5 py-1.5 text-[11px] border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 placeholder:text-slate-300"
                />
                <button
                  onClick={() => void handlePost()}
                  disabled={!text.trim() || posting}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[11px] font-bold rounded-lg self-end transition-colors"
                >
                  {posting ? <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Post'}
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

function StatusBadge({ status, endDate }: { status: string; endDate: string }) {
  const eff = effectiveStatus(status, endDate);
  const label = eff.replace('_', ' ');
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[eff] ?? 'bg-slate-100 text-slate-600'}`}>
      {label}
    </span>
  );
}

// ─── Column Customization ────────────────────────────────────────────────────

const COLUMN_DEFS = [
  { id: 'domain',       label: 'Domain',       defaultOn: true,  defaultW: 160, sortable: true  },
  { id: 'item',         label: 'Item',         defaultOn: true,  defaultW: 240, sortable: true  },
  { id: 'qty_price',    label: 'Qty / Price',  defaultOn: true,  defaultW: 120, sortable: false },
  { id: 'status',       label: 'Status',       defaultOn: true,  defaultW: 110, sortable: true  },
  { id: 'last_quote',   label: 'Last Quote',   defaultOn: true,  defaultW: 140, sortable: true  },
  { id: 'last_invoice', label: 'Last Invoice', defaultOn: true,  defaultW: 140, sortable: true  },
  { id: 'reseller',     label: 'Reseller',     defaultOn: false, defaultW: 150, sortable: false },
  { id: 'gws_recon',    label: 'Recon',        defaultOn: true,  defaultW: 90,  sortable: false },
] as const;

type ColId = (typeof COLUMN_DEFS)[number]['id'];
type ColDef = (typeof COLUMN_DEFS)[number];

// ── localStorage helpers ──────────────────────────────────────────────────────
const SK_VIS    = 'subs_columns_v2';
const SK_ORDER  = 'subs_col_order_v1';
const SK_WIDTHS = 'subs_col_widths_v1';

function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
}
function lsSet(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

function loadVisible(): Set<ColId> {
  return new Set(lsGet<ColId[]>(SK_VIS, COLUMN_DEFS.filter(c => c.defaultOn).map(c => c.id)));
}
function loadOrder(): ColId[] {
  const saved = lsGet<ColId[]>(SK_ORDER, []);
  const allIds = COLUMN_DEFS.map(c => c.id);
  if (!saved.length) return [...allIds] as ColId[];
  const savedSet = new Set(saved);
  return [
    ...saved.filter((id): id is ColId => (allIds as readonly string[]).includes(id)),
    ...allIds.filter(id => !savedSet.has(id)),
  ];
}
function loadWidths(): Partial<Record<ColId, number>> {
  return lsGet<Partial<Record<ColId, number>>>(SK_WIDTHS, {});
}

// ── Column state hook ─────────────────────────────────────────────────────────
function useColState() {
  const [visibleCols, setVisibleCols] = useState<Set<ColId>>(
    () => new Set(COLUMN_DEFS.filter(c => c.defaultOn).map(c => c.id)),
  );
  const [colOrder, setColOrder] = useState<ColId[]>(() => COLUMN_DEFS.map(c => c.id));
  const [colWidths, setColWidths] = useState<Partial<Record<ColId, number>>>({});

  useEffect(() => {
    setVisibleCols(loadVisible());
    setColOrder(loadOrder());
    setColWidths(loadWidths());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getW = (id: ColId) => colWidths[id] ?? COLUMN_DEFS.find(c => c.id === id)?.defaultW ?? 130;

  const orderedVisible: ColDef[] = colOrder
    .filter(id => visibleCols.has(id))
    .map(id => COLUMN_DEFS.find(c => c.id === id)!)
    .filter(Boolean) as ColDef[];

  const toggle = (id: ColId) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      lsSet(SK_VIS, [...next]);
      return next;
    });
  };

  return { visibleCols, setVisibleCols, colOrder, setColOrder, colWidths, setColWidths, getW, orderedVisible, toggle };
}

// ── Visual helpers ────────────────────────────────────────────────────────────
function GripIcon() {
  return (
    <svg className="w-3 h-3 text-slate-400 flex-shrink-0" viewBox="0 0 8 12" fill="currentColor">
      <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
      <circle cx="2" cy="6" r="1.2" /><circle cx="6" cy="6" r="1.2" />
      <circle cx="2" cy="10" r="1.2" /><circle cx="6" cy="10" r="1.2" />
    </svg>
  );
}
function SortIcon({ active, dir }: { active: boolean; dir?: 'asc' | 'desc' }) {
  if (!active) return (
    <svg className="w-3 h-3 text-slate-300 flex-shrink-0" viewBox="0 0 12 12" fill="currentColor">
      <path d="M6 2L9 6H3L6 2Z" /><path d="M6 10L3 6H9L6 10Z" />
    </svg>
  );
  return dir === 'desc'
    ? <svg className="w-3 h-3 text-[#286FAD] flex-shrink-0" viewBox="0 0 12 12" fill="currentColor"><path d="M6 10L3 4H9L6 10Z" /></svg>
    : <svg className="w-3 h-3 text-[#286FAD] flex-shrink-0" viewBox="0 0 12 12" fill="currentColor"><path d="M6 2L9 8H3L6 2Z" /></svg>;
}

function ColumnsPanel({ visibleCols, toggle }: { visibleCols: Set<ColId>; toggle: (id: ColId) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`px-3 py-1.5 border text-xs font-semibold rounded-lg shadow-sm transition-all ${
          open ? 'bg-slate-100 border-slate-300 text-slate-800' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
        }`}
      >
        Columns ▾
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg p-3 w-44">
          {COLUMN_DEFS.map((col) => (
            <label key={col.id} className="flex items-center gap-2 py-1.5 cursor-pointer text-[13px] text-slate-700 hover:text-slate-900">
              <input
                type="checkbox"
                checked={visibleCols.has(col.id)}
                onChange={() => toggle(col.id)}
                className="rounded border-slate-300 text-[#286FAD] focus:ring-[#286FAD]/20"
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Cell helpers ─────────────────────────────────────────────────────────────

const CELL_CLS: Record<ColId, string> = {
  domain:       'px-4 py-2.5 overflow-hidden',
  item:         'px-4 py-2.5 overflow-hidden',
  qty_price:    'px-4 py-2.5 text-right overflow-hidden',
  status:       'px-4 py-2.5 text-center overflow-hidden',
  last_quote:   'px-4 py-2.5 text-center overflow-hidden',
  last_invoice: 'px-4 py-2.5 text-center overflow-hidden',
  reseller:     'px-4 py-2.5 overflow-hidden',
  gws_recon:    'px-4 py-2.5 text-center overflow-hidden',
};

const COPY_SVG = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
    <path d="M5.5 3.5A1.5 1.5 0 0 1 7 2h4.5A1.5 1.5 0 0 1 13 3.5v7a1.5 1.5 0 0 1-1.5 1.5H11v-1h.5a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5H7a.5.5 0 0 0-.5.5V4H5.5v-.5Z" />
    <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h4A1.5 1.5 0 0 1 10 5.5v7A1.5 1.5 0 0 1 8.5 14h-4A1.5 1.5 0 0 1 3 12.5v-7Zm1.5-.5a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5h-4Z" />
  </svg>
);

function renderCell(sub: Subscription, colId: ColId, resellerNames: Record<string, string>): React.ReactNode {
  switch (colId) {
    case 'domain':
      return (
        <span className="inline-flex items-center gap-1 group max-w-full">
          <span className="text-[13px] font-mono text-slate-500 group-hover:text-blue-600 transition-colors truncate">{sub.domain.domainName}</span>
          <button type="button" title="Copy domain name"
            onClick={e => { e.stopPropagation(); void navigator.clipboard.writeText(sub.domain.domainName); }}
            className="opacity-0 group-hover:opacity-100 transition-all text-slate-400 group-hover:text-blue-500 hover:text-blue-700 p-0.5 rounded hover:bg-blue-50 flex-shrink-0">
            {COPY_SVG}
          </button>
        </span>
      );
    case 'item':
      return (
        <>
          <p className="text-slate-700 text-[13px] leading-snug truncate">{sub.zohoItemName ?? '—'}</p>
          <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1 flex-wrap">
            {fmt(sub.startDate)} <span className="text-slate-300">→</span> {fmt(sub.endDate)}
            <span className="text-slate-300">·</span>
            <span className={`text-[9px] font-bold px-1.5 py-px rounded ${CYCLE_BADGE_CLASS[sub.billingCycle] ?? 'bg-slate-100 text-slate-500'}`}>
              {cycleLabel(sub.billingCycle)}
            </span>
          </p>
        </>
      );
    case 'qty_price':
      return (
        <>
          <p className="text-[13px] text-slate-700 font-medium">{sub.quantity}</p>
          <p className="text-[11px] text-slate-400">{money(Number(sub.subscriptionPrice), sub.currency)}</p>
        </>
      );
    case 'status':
      return (
        <div className="flex flex-col items-center gap-0.5">
          <StatusBadge status={sub.lifecycleStatus} endDate={sub.endDate} />
          <ProcessStatusBadge status={sub.processStatus} />
        </div>
      );
    case 'last_quote':
      return <LastQuoteCell sub={sub} />;
    case 'last_invoice':
      return <LastInvoiceCell sub={sub} />;
    case 'reseller':
      return sub.domain.googleResellerEmail
        ? <span className="text-[11px] text-slate-600 font-medium truncate block">{resellerNames[sub.domain.googleResellerEmail] ?? (sub.domain.googleResellerEmail.includes('@') ? sub.domain.googleResellerEmail.split('@')[1] : sub.domain.googleResellerEmail)}</span>
        : <span className="text-slate-300 text-xs">—</span>;
    case 'gws_recon':
      return sub.subscriptionCategory === 'google_workspace'
        ? sub._count.googleResellerMatches > 0
          ? <span className="inline-block text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">✓ Matched</span>
          : <span className="inline-block text-[10px] font-semibold text-orange-700 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded">✗ Unmatched</span>
        : <span className="text-slate-300 text-xs">—</span>;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export function SubscriptionsTable({
  subscriptions,
  initialSelectedIds,
  isAdmin = false,
  categories = [],
  resellerNames = {},
}: {
  subscriptions: Subscription[];
  initialSelectedIds?: string[];
  isAdmin?: boolean;
  categories?: { itemValue: string; itemLabel: string }[];
  resellerNames?: Record<string, string>; // email → display name
}) {
  // ── Column state (order, widths, visibility) ─────────────────────────────
  const { visibleCols, colOrder, setColOrder, colWidths, setColWidths, getW, orderedVisible, toggle } = useColState();

  // ── Sort state from URL ───────────────────────────────────────────────────
  const searchParams = useSearchParams();
  const sortBy  = searchParams.get('sortBy')  ?? '';
  const sortDir = (searchParams.get('sortDir') ?? 'asc') as 'asc' | 'desc';

  const handleSort = (colId: ColId) => {
    const col = COLUMN_DEFS.find(c => c.id === colId);
    if (!col?.sortable) return;
    const cur = sortBy === colId ? sortDir : undefined;
    const next = cur === 'asc' ? 'desc' : 'asc';
    const p = new URLSearchParams(searchParams.toString());
    p.set('sortBy', colId); p.set('sortDir', next); p.delete('page');
    router.push(`/dashboard/subscriptions?${p.toString()}`);
  };

  // ── Drag-to-reorder ───────────────────────────────────────────────────────
  const dragColRef  = useRef<ColId | null>(null);
  const [dragOverCol, setDragOverCol] = useState<ColId | null>(null);

  const reorderCol = (fromId: ColId, toId: ColId) => {
    if (fromId === toId) return;
    const next = [...colOrder];
    const fi = next.indexOf(fromId), ti = next.indexOf(toId);
    next.splice(fi, 1); next.splice(ti, 0, fromId);
    setColOrder(next); lsSet(SK_ORDER, next);
  };

  // ── Resize columns ────────────────────────────────────────────────────────
  const resizingRef = useRef<{ id: ColId; startX: number; startW: number } | null>(null);

  const startResize = (e: React.MouseEvent, id: ColId) => {
    e.preventDefault(); e.stopPropagation();
    resizingRef.current = { id, startX: e.clientX, startW: getW(id) };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const newW = Math.max(60, resizingRef.current.startW + ev.clientX - resizingRef.current.startX);
      setColWidths(prev => ({ ...prev, [resizingRef.current!.id]: newW }));
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setColWidths(prev => { lsSet(SK_WIDTHS, prev); return prev; });
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Table layout ──────────────────────────────────────────────────────────
  const CUSTOMER_W = 180;
  const CHECKBOX_W = 44;
  const ACTIONS_W  = 64;
  const tableMinWidth = CHECKBOX_W + CUSTOMER_W + orderedVisible.reduce((s, c) => s + getW(c.id), 0) + ACTIONS_W;

  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds ?? []);
  const [isUpdatingPrice, setIsUpdatingPrice] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isUpdatingCategory, setIsUpdatingCategory] = useState(false);
  const [showBulkCategoryModal, setShowBulkCategoryModal] = useState(false);
  const [bulkCategoryValue, setBulkCategoryValue] = useState('');
  const [isBulkUpdateDropdownOpen, setIsBulkUpdateDropdownOpen] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [recentQuoteWarning, setRecentQuoteWarning] = useState<{ id: string; name: string; quoteNumber: string; daysAgo: number }[]>([]);
  const [groupByCustomer, setGroupByCustomer] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [pendingQuoteIds, setPendingQuoteIds] = useState<string[] | null>(null);
  const [pendingCombined, setPendingCombined] = useState(false);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [importResult, setImportResult] = useState<{
    importLogId?: string;
    totalRows: number;
    updatedCount: number;
    skippedCount?: number;
    errorCount?: number;
    skipped?: string[];
    errors?: string[];
  } | null>(null);
  const [gSyncJobId, setGSyncJobId] = useState<string | null>(null);
  const [gSyncStatus, setGSyncStatus] = useState<SyncJobStatus | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkUpdateDropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bulkUpdateDropdownRef.current && !bulkUpdateDropdownRef.current.contains(e.target as Node)) {
        setIsBulkUpdateDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  // Restore pending sync job from sessionStorage (survives page refresh)
  useEffect(() => {
    const savedId = typeof window !== 'undefined' ? sessionStorage.getItem('gSyncJobId') : null;
    if (savedId) setGSyncJobId(savedId);
  }, []);

  // Poll job status every 2s while a job is active
  useEffect(() => {
    if (!gSyncJobId) return;
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

    const poll = async () => {
      try {
        const res = await fetch(`${apiBase}/google-workspace/customers/sync-job/${gSyncJobId}`, { credentials: 'include' });
        if (!res.ok) { sessionStorage.removeItem('gSyncJobId'); setGSyncJobId(null); return; }
        const data = await res.json() as SyncJobStatus;
        if (data.status === 'not_found') { sessionStorage.removeItem('gSyncJobId'); setGSyncJobId(null); return; }
        setGSyncStatus(data);
        if (data.status === 'done') {
          sessionStorage.removeItem('gSyncJobId');
          setGSyncJobId(null);
          router.refresh();
        }
      } catch { /* non-fatal */ }
    };

    void poll();
    const interval = setInterval(() => void poll(), 2000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gSyncJobId]);

  if (subscriptions.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="text-center py-16 text-slate-400">
          <p className="font-medium">कोई subscription नहीं मिली</p>
          <p className="text-sm mt-1">Filter change करो या नई subscription create करो।</p>
        </div>
      </div>
    );
  }

  const toggleAll = () => {
    if (selectedIds.length === subscriptions.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(subscriptions.map(s => s.id));
    }
  };

  const toggleOne = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleBulkUpdatePrice = async () => {
    const priceStr = prompt(`Update price for ${selectedIds.length} subscriptions:\nEnter new unit price:`);
    if (!priceStr) return;
    const newPrice = Number(priceStr);
    if (isNaN(newPrice) || newPrice <= 0) return alert('Invalid price');

    setIsUpdatingPrice(true);
    try {
      await api.post('/subscriptions/bulk-update-price', {
        subscriptionIds: selectedIds,
        newPrice
      });
      alert('Price updated successfully');
      setSelectedIds([]);
      router.refresh();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsUpdatingPrice(false);
    }
  };

  const handleBulkUpdateCategory = async () => {
    setIsUpdatingCategory(true);
    try {
      await api.post('/subscriptions/bulk-update-category', {
        subscriptionIds: selectedIds,
        newCategory: bulkCategoryValue || undefined,
      });
      alert(`Category updated for ${selectedIds.length} subscription(s)`);
      setShowBulkCategoryModal(false);
      setBulkCategoryValue('');
      setSelectedIds([]);
      router.refresh();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsUpdatingCategory(false);
    }
  };

  const doGenerateQuotes = async (explicitIds?: string[]) => {
    const idsToQuote = explicitIds ?? selectedIds;
    setRecentQuoteWarning([]);
    setPendingQuoteIds(null);
    setIsQuoting(true);
    try {
      const res = await api.post<{
        totalGroups: number;
        createdCount: number;
        failedCount: number;
        estimateNumbers: string[];
        batchIds: string[];
        errors: string[];
      }>('/subscriptions/bulk-renewal-quote', {
        subscriptionIds: idsToQuote,
      });

      // Surface any group-level failures, but still proceed to review the ones that succeeded.
      if (res.failedCount > 0) {
        alert(
          `${res.createdCount} of ${res.totalGroups} quote group(s) created.\n\n` +
          `${res.failedCount} failed:\n- ${res.errors.join('\n- ')}`,
        );
      }
      if (!explicitIds) setSelectedIds([]);

      // Next step: land on the batch review screen for the just-created quotes
      // (review → bulk-send → track status). Fall back to a refresh if nothing was created.
      if (res.batchIds?.length) {
        router.push(`/dashboard/subscriptions/renewal-batches?ids=${res.batchIds.join(',')}`);
      } else {
        router.refresh();
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsQuoting(false);
    }
  };

  const doGenerateCombinedQuote = async (groupIds: string[]) => {
    setIsQuoting(true);
    try {
      const res = await api.post<{
        renewalBatchId: string;
        zohoEstimateNumber: string | null;
        lineCount: number;
        domainCount: number;
        skippedCount: number;
      }>('/subscriptions/combined-renewal-quote', { subscriptionIds: groupIds });

      if (res.skippedCount > 0) {
        alert(`${res.skippedCount} subscriptions skipped (not renewable status).`);
      }
      if (res.renewalBatchId) {
        router.push(`/dashboard/subscriptions/renewal-batches?ids=${res.renewalBatchId}`);
      } else {
        router.refresh();
      }
    } catch (err: any) {
      alert(`Combined Quote Error: ${err.message}`);
    } finally {
      setIsQuoting(false);
    }
  };

  const handleBulkQuote = () => {
    // Check if any selected subscription already has a recent quote (≤ 30 days)
    const selected = subscriptions.filter(s => selectedIds.includes(s.id));
    const recent = selected
      .filter(s => s.lastQuoteNumber && daysSince(s.lastQuoteDate) <= 30)
      .map(s => ({
        id: s.id,
        name: s.zohoCustomerName ?? s.domain.domainName,
        quoteNumber: s.lastQuoteNumber!,
        daysAgo: daysSince(s.lastQuoteDate),
      }));

    if (recent.length > 0) {
      setRecentQuoteWarning(recent);
    } else {
      doGenerateQuotes();
    }
  };

  const startGoogleSync = async (body: { domainIds?: string[]; syncAll?: boolean }) => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
    const res = await fetch(`${apiBase}/google-workspace/customers/fetch-bulk`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json() as { message?: string };
      throw new Error(err.message ?? 'Sync failed to start');
    }
    const { jobId, total } = await res.json() as { jobId: string; total: number };
    sessionStorage.setItem('gSyncJobId', jobId);
    setGSyncJobId(jobId);
    setGSyncStatus({ jobId, status: 'running', total, processed: 0, succeeded: 0, failed: 0, results: [] });
  };

  const handleBulkGoogleSync = async () => {
    const uniqueDomainIds = [...new Set(
      subscriptions
        .filter(s => selectedIds.includes(s.id) && s.zohoItemName?.toLowerCase().includes('google workspace'))
        .map(s => s.domain.id),
    )];
    if (!uniqueDomainIds.length) {
      alert('Selected subscriptions mein koi Google Workspace subscription nahi hai.');
      return;
    }
    try { await startGoogleSync({ domainIds: uniqueDomainIds }); }
    catch (err: unknown) { alert(`Google Sync Error: ${err instanceof Error ? err.message : 'Unknown error'}`); }
  };

  const handleSyncAllGoogle = async () => {
    if (!confirm('Sync ALL Google Workspace domains? This may take a while.')) return;
    try { await startGoogleSync({ syncAll: true }); }
    catch (err: unknown) { alert(`Sync All Error: ${err instanceof Error ? err.message : 'Unknown error'}`); }
  };

  const handleExportCsv = () => {
    window.open('/api/subscriptions/export-csv' + window.location.search);
  };

  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('Please select a valid CSV file.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    setIsImportingCsv(true);
    setImportResult(null);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/import-csv`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Import failed');
      // Full skipped/error detail is shown inline below (and persisted server-side
      // in csv_import_logs) rather than truncated in an alert().
      setImportResult(data);
      router.refresh();
    } catch (err: any) {
      setImportResult({ totalRows: 0, updatedCount: 0, errors: [err.message] });
    } finally {
      setIsImportingCsv(false);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleBulkCancel = async () => {
    if (!confirm(`Are you sure you want to cancel ${selectedIds.length} subscriptions?`)) return;
    
    setIsUpdatingStatus(true);
    try {
      await api.post('/subscriptions/bulk-update-status', {
        subscriptionIds: selectedIds,
        status: 'Cancelled',
      });
      alert('Subscriptions cancelled successfully');
      setSelectedIds([]);
      router.refresh();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleBulkActivate = async () => {
    if (!confirm(`Are you sure you want to activate ${selectedIds.length} subscriptions?`)) return;
    
    setIsUpdatingStatus(true);
    try {
      await api.post('/subscriptions/bulk-update-status', {
        subscriptionIds: selectedIds,
        status: 'Active',
      });
      alert('Subscriptions activated successfully');
      setSelectedIds([]);
      router.refresh();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`क्या आप सच में इन ${selectedIds.length} subscriptions को डिलीट करना चाहते हैं? इससे सारा संबंधित डेटा भी डिलीट हो जाएगा।`)) return;
    
    setIsUpdatingStatus(true);
    try {
      await deleteMultipleSubscriptionsAction(selectedIds);
      alert('Subscriptions deleted successfully');
      setSelectedIds([]);
      router.refresh();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const toggleGroupCollapse = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleGroupSelection = (groupSubs: Subscription[]) => {
    const ids = groupSubs.map(s => s.id);
    const allSelected = ids.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !ids.includes(id)));
    } else {
      setSelectedIds(prev => [...new Set([...prev, ...ids])]);
    }
  };

  const handleGroupQuote = (groupSubs: Subscription[]) => {
    const groupIds = groupSubs.map(s => s.id);
    const recent = groupSubs
      .filter(s => s.lastQuoteNumber && daysSince(s.lastQuoteDate) <= 30)
      .map(s => ({
        id: s.id,
        name: s.zohoCustomerName ?? s.domain.domainName,
        quoteNumber: s.lastQuoteNumber!,
        daysAgo: daysSince(s.lastQuoteDate),
      }));

    if (recent.length > 0) {
      setPendingQuoteIds(groupIds);
      setRecentQuoteWarning(recent);
    } else {
      void doGenerateQuotes(groupIds);
    }
  };

  const handleGroupCombinedQuote = (groupSubs: Subscription[]) => {
    const groupIds = groupSubs.map(s => s.id);
    const recent = groupSubs
      .filter(s => s.lastQuoteNumber && daysSince(s.lastQuoteDate) <= 30)
      .map(s => ({
        id: s.id,
        name: s.zohoCustomerName ?? s.domain.domainName,
        quoteNumber: s.lastQuoteNumber!,
        daysAgo: daysSince(s.lastQuoteDate),
      }));

    if (recent.length > 0) {
      setPendingQuoteIds(groupIds);
      setPendingCombined(true);
      setRecentQuoteWarning(recent);
    } else {
      void doGenerateCombinedQuote(groupIds);
    }
  };

  // Compute customer groups for grouped view (null = flat mode)
  const customerGroups: Map<string, Subscription[]> | null = groupByCustomer
    ? subscriptions.reduce((map, sub) => {
        const key = sub.zohoCustomerName ?? '(No Customer)';
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(sub);
        return map;
      }, new Map<string, Subscription[]>())
    : null;

  const handlePasteSelect = () => {
    const domainsToSelect = pasteText.split(/[\n,]+/).map(d => d.trim().toLowerCase()).filter(Boolean);
    const idsToSelect = subscriptions
      .filter(s => domainsToSelect.includes(s.domain.domainName.toLowerCase()))
      .map(s => s.id);
    
    if (idsToSelect.length === 0) {
      alert('No matching domains found in the current view.');
      return;
    }
    
    const newSelected = new Set([...selectedIds, ...idsToSelect]);
    setSelectedIds(Array.from(newSelected));
    setIsPasteModalOpen(false);
    setPasteText('');
    alert(`Selected ${idsToSelect.length} matching subscriptions.`);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Bulk action bar — sticky so it stays visible while scrolling */}
      {selectedIds.length > 0 && (
        <div className="sticky top-0 z-20 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 flex items-center justify-between shadow-sm">
          <div className="text-blue-800 text-sm font-semibold">
            {selectedIds.length} subscriptions selected
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleBulkCancel}
              disabled={isUpdatingPrice || isQuoting || isUpdatingStatus}
              className="px-3 py-1.5 bg-red-100 border border-red-200 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-200 disabled:opacity-50"
            >
              {isUpdatingStatus ? 'Updating...' : 'Cancel Subscriptions'}
            </button>
            <button
              onClick={handleBulkActivate}
              disabled={isUpdatingPrice || isQuoting || isUpdatingStatus}
              className="px-3 py-1.5 bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-semibold rounded-lg hover:bg-emerald-200 disabled:opacity-50"
            >
              {isUpdatingStatus ? 'Updating...' : 'Activate Subscriptions'}
            </button>
            <div className="relative" ref={bulkUpdateDropdownRef}>
              <button
                onClick={() => setIsBulkUpdateDropdownOpen(o => !o)}
                disabled={isUpdatingPrice || isUpdatingCategory || isQuoting || isUpdatingStatus}
                className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1"
              >
                {(isUpdatingPrice || isUpdatingCategory) ? 'Updating...' : 'Bulk Update'} ▾
              </button>
              {isBulkUpdateDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-44">
                  <button
                    onClick={() => { setIsBulkUpdateDropdownOpen(false); handleBulkUpdatePrice(); }}
                    className="w-full text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 font-medium"
                  >
                    Update Price
                  </button>
                  <button
                    onClick={() => { setIsBulkUpdateDropdownOpen(false); setShowBulkCategoryModal(true); }}
                    className="w-full text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 font-medium"
                  >
                    Update Category
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handleBulkQuote}
              disabled={isUpdatingPrice || isQuoting || isUpdatingStatus}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isQuoting ? 'Generating...' : 'Generate Quotes'}
            </button>
            <button
              onClick={() => void handleBulkGoogleSync()}
              disabled={!!gSyncJobId || isQuoting || isUpdatingPrice || isUpdatingStatus}
              className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {gSyncJobId
                ? `Syncing ${gSyncStatus?.processed ?? 0}/${gSyncStatus?.total ?? '…'}`
                : `G Sync (${[...new Set(subscriptions.filter(s => selectedIds.includes(s.id) && s.zohoItemName?.toLowerCase().includes('google workspace')).map(s => s.domain.id))].length} domains)`}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPasteModalOpen(true)}
            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50 shadow-sm"
          >
            Bulk Select by Domains
          </button>
          <button
            onClick={() => void handleSyncAllGoogle()}
            disabled={!!gSyncJobId}
            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50 shadow-sm inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {gSyncJobId ? `Syncing ${gSyncStatus?.processed ?? 0}/${gSyncStatus?.total ?? '…'}` : 'Sync All Google'}
          </button>
          <button
            onClick={() => { setGroupByCustomer(v => !v); setCollapsedGroups(new Set()); }}
            className={`px-3 py-1.5 border text-xs font-semibold rounded-lg shadow-sm transition-all ${
              groupByCustomer
                ? 'bg-blue-600 text-white border-blue-700 hover:bg-blue-700'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {groupByCustomer ? '▼ Grouped by Customer' : '⊞ Group by Customer'}
          </button>
          <ColumnsPanel visibleCols={visibleCols} toggle={toggle} />
          {isAdmin && (
            <button
              onClick={handleBulkDelete}
              disabled={selectedIds.length === 0 || isUpdatingStatus}
              title={selectedIds.length === 0 ? "Select at least one subscription to delete" : "Delete selected subscriptions"}
              className={`p-2 border rounded-lg transition-all active:scale-95 flex items-center justify-center ${
                selectedIds.length > 0
                  ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
                  : 'border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed'
              }`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              className="px-3 py-1.5 border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg bg-white hover:bg-slate-50 transition-all shadow-sm inline-flex items-center gap-1.5"
            >
              📤 Export CSV
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImportingCsv}
              className="px-3 py-1.5 border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg bg-white hover:bg-slate-50 transition-all shadow-sm inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              📥 {isImportingCsv ? 'Importing…' : 'Import CSV'}
            </button>
            <input type="file" className="hidden" ref={fileInputRef} onChange={handleImportCsv} />
          </div>
        )}
      </div>

      {importResult && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          (importResult.errorCount ?? importResult.errors?.length ?? 0) > 0
            ? 'bg-amber-50 border-amber-200'
            : 'bg-green-50 border-green-200'
        }`}>
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium text-slate-800">
              {importResult.updatedCount} updated
              {typeof importResult.skippedCount === 'number' && `, ${importResult.skippedCount} skipped`}
              {typeof importResult.errorCount === 'number' && `, ${importResult.errorCount} errors`}
              {' '}out of {importResult.totalRows} row{importResult.totalRows === 1 ? '' : 's'}.
            </p>
            <div className="flex items-center gap-3 shrink-0">
              {importResult.importLogId && (
                <a
                  href={`/api/subscriptions/import-logs/${importResult.importLogId}/errors-csv`}
                  className="text-blue-600 text-xs font-medium hover:underline"
                >
                  Download report
                </a>
              )}
              <button onClick={() => setImportResult(null)} className="text-slate-400 hover:text-slate-600 text-xs">
                Dismiss
              </button>
            </div>
          </div>
          {(importResult.skipped?.length || importResult.errors?.length) ? (
            <div className="mt-2 max-h-40 overflow-y-auto space-y-0.5">
              {importResult.errors?.map((msg, i) => (
                <p key={`err-${i}`} className="text-xs text-red-600">❌ {msg}</p>
              ))}
              {importResult.skipped?.map((msg, i) => (
                <p key={`skip-${i}`} className="text-xs text-slate-500">⏭ {msg}</p>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Live progress while sync is running */}
      {gSyncJobId && gSyncStatus && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
          <div className="flex items-center gap-3">
            <svg className="animate-spin h-4 w-4 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            <span className="font-medium text-blue-800">
              Google Sync: {gSyncStatus.processed}/{gSyncStatus.total} domains processed
            </span>
            <span className="ml-auto text-blue-500 text-xs shrink-0">
              {gSyncStatus.succeeded} ok{gSyncStatus.failed > 0 && ` • ${gSyncStatus.failed} failed`}
            </span>
          </div>
          <div className="mt-2 h-1.5 bg-blue-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${gSyncStatus.total > 0 ? Math.round((gSyncStatus.processed / gSyncStatus.total) * 100) : 0}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-blue-500">Page se navigate karo — sync background mein continue karega.</p>
        </div>
      )}

      {/* Result banner after sync completes */}
      {!gSyncJobId && gSyncStatus?.status === 'done' && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${gSyncStatus.failed > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold text-slate-800">
              Google Sync complete: {gSyncStatus.succeeded}/{gSyncStatus.total} domain{gSyncStatus.total !== 1 ? 's' : ''} synced
              {gSyncStatus.failed > 0 && ` • ${gSyncStatus.failed} failed`}
            </p>
            <button onClick={() => setGSyncStatus(null)} className="text-slate-400 hover:text-slate-600 text-xs shrink-0">
              Dismiss
            </button>
          </div>
          {gSyncStatus.failed > 0 && (
            <div className="mt-2 max-h-32 overflow-y-auto space-y-0.5">
              {gSyncStatus.results.filter(r => !r.success).map((r, i) => (
                <p key={i} className="text-xs text-red-600">✗ {r.domainName ?? r.domainId}: {String(r.error ?? 'Unknown error')}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Scrollable table — sticky header, H + V scroll, fixed layout */}
      <div className="rounded-xl border border-slate-200 overflow-auto max-h-[calc(100vh-290px)] bg-white">
        <table className="text-sm" style={{ tableLayout: 'fixed', minWidth: tableMinWidth }}>
          <colgroup>
            <col style={{ width: CHECKBOX_W }} />
            <col style={{ width: CUSTOMER_W }} />
            {orderedVisible.map(col => <col key={col.id} style={{ width: getW(col.id) }} />)}
            <col style={{ width: ACTIONS_W }} />
          </colgroup>
          <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
            <tr>
              {/* Checkbox */}
              <th className="px-3 py-3 text-left" style={{ width: CHECKBOX_W }}>
                <input
                  type="checkbox"
                  checked={selectedIds.length > 0 && selectedIds.length === subscriptions.length}
                  ref={el => { if (el) el.indeterminate = selectedIds.length > 0 && selectedIds.length < subscriptions.length; }}
                  onChange={toggleAll}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </th>
              {/* Customer — fixed, always first */}
              <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wide" style={{ width: CUSTOMER_W }}>
                Customer
              </th>
              {/* Reorderable columns */}
              {orderedVisible.map(col => (
                <th
                  key={col.id}
                  style={{ width: getW(col.id) }}
                  className={`relative group/hdr select-none ${col.sortable ? 'cursor-pointer hover:bg-slate-100/80' : ''} ${dragOverCol === col.id ? 'border-l-2 border-l-blue-500 bg-blue-50/50' : ''}`}
                  draggable
                  onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; dragColRef.current = col.id; }}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCol(col.id); }}
                  onDrop={e => { e.preventDefault(); if (dragColRef.current) reorderCol(dragColRef.current, col.id); setDragOverCol(null); dragColRef.current = null; }}
                  onDragEnd={() => { setDragOverCol(null); dragColRef.current = null; }}
                  onClick={() => col.sortable && handleSort(col.id)}
                >
                  <div className="flex items-center gap-1.5 px-4 py-3 overflow-hidden">
                    <span className="opacity-0 group-hover/hdr:opacity-100 transition-opacity flex-shrink-0" title="Drag to reorder">
                      <GripIcon />
                    </span>
                    <span className="truncate font-semibold text-slate-600 text-xs uppercase tracking-wide">{col.label}</span>
                    {col.sortable && <SortIcon active={sortBy === col.id} dir={sortBy === col.id ? sortDir : undefined} />}
                  </div>
                  {/* Resize handle */}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10 group/resize"
                    onMouseDown={e => startResize(e, col.id)}
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="absolute inset-y-2 left-[2px] w-px bg-slate-200 group-hover/resize:bg-blue-400 transition-colors" />
                  </div>
                </th>
              ))}
              {/* Actions */}
              <th className="px-3 py-3" style={{ width: ACTIONS_W }} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customerGroups
              ? Array.from(customerGroups.entries()).map(([customerKey, groupSubs]) => {
                  const isCollapsed = collapsedGroups.has(customerKey);
                  const allSelected = groupSubs.every(s => selectedIds.includes(s.id));
                  const someSelected = groupSubs.some(s => selectedIds.includes(s.id));
                  const firstSub = groupSubs[0];
                  return (
                    <Fragment key={customerKey}>
                      {/* Group header row */}
                      <tr className="bg-slate-100/90 border-y border-slate-200">
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                            onChange={() => toggleGroupSelection(groupSubs)}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                        </td>
                        <td colSpan={1 + orderedVisible.length} className="px-4 py-2">
                          <div className="flex items-center gap-3">
                            <button onClick={() => toggleGroupCollapse(customerKey)} className="text-slate-400 hover:text-slate-700 text-[11px] font-bold w-4 text-center shrink-0">
                              {isCollapsed ? '▶' : '▼'}
                            </button>
                            {firstSub.zohoCustomerId ? (
                              <Link href={`/dashboard/customers/${firstSub.zohoCustomerId}?org_id=${firstSub.organization.id}`} className="font-bold text-blue-700 hover:underline text-[13px]">
                                {customerKey}
                              </Link>
                            ) : (
                              <span className="font-bold text-slate-800 text-[13px]">{customerKey}</span>
                            )}
                            <span className="text-[11px] text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full shrink-0">
                              {groupSubs.length} subscription{groupSubs.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => handleGroupQuote(groupSubs)} disabled={isQuoting}
                              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
                              {isQuoting ? 'Generating…' : 'Generate Quote'}
                            </button>
                            {groupSubs.length > 1 && (
                              <button onClick={() => handleGroupCombinedQuote(groupSubs)} disabled={isQuoting}
                                title="One combined estimate — all subscriptions as separate line items"
                                className="px-3 py-1 bg-violet-600 text-white text-[11px] font-semibold rounded-lg hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap">
                                🔗 Combined
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Group subscription rows */}
                      {!isCollapsed && groupSubs.map((sub) => {
                        const isSelected = selectedIds.includes(sub.id);
                        return (
                          <tr key={sub.id} onClick={() => router.push(`/dashboard/subscriptions/${sub.id}`)}
                            className={`transition-colors cursor-pointer ${isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/80'}`}>
                            <td className="px-4 py-2.5 pl-9" onClick={e => e.stopPropagation()}>
                              <input type="checkbox" checked={isSelected} onChange={() => toggleOne(sub.id)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                            </td>
                            {/* Customer (org name in grouped view) */}
                            <td className="px-4 py-2.5 overflow-hidden">
                              <p className="text-[11px] text-slate-400 truncate">{sub.organization.name}</p>
                            </td>
                            {orderedVisible.map(col => (
                              <td key={col.id} style={{ width: getW(col.id) }} className={CELL_CLS[col.id]}
                                  onClick={col.id === 'domain' ? e => e.stopPropagation() : undefined}>
                                {renderCell(sub, col.id, resellerNames)}
                              </td>
                            ))}
                            <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1.5">
                                {sub.zohoItemName?.toLowerCase().includes('google workspace') && (
                                  <GoogleResellerButton domainId={sub.domain.id} domainName={sub.domain.domainName} googleCustomerId={sub.domain.googleCustomerId} showAlert={sub.subscriptionCategory === 'google_workspace' && sub._count.googleResellerMatches === 0} />
                                )}
                                <RowCommentsButton subscriptionId={sub.id} commentCount={sub._count.comments} />
                                <EditSubscriptionButton iconOnly subscriptionId={sub.id} itemId={sub.zohoItemId} itemName={sub.zohoItemName ?? ''} orgId={sub.organization.id}
                                  quantity={Number(sub.quantity)} currency={sub.currency ?? 'INR'} exchangeRate={Number(sub.exchangeRate ?? 1)} billingCycle={sub.billingCycle}
                                  price={Number(sub.subscriptionPrice)} nextRenewalPrice={sub.nextRenewalPrice !== null ? Number(sub.nextRenewalPrice) : null}
                                  startDate={sub.startDate} endDate={sub.endDate} autoRenew={sub.autoRenew} lastQuoteNumber={sub.lastQuoteNumber} lastInvoiceNumber={sub.lastInvoiceNumber} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })
              : subscriptions.map((sub) => {
                  const isSelected = selectedIds.includes(sub.id);
                  return (
                    <tr key={sub.id} onClick={() => router.push(`/dashboard/subscriptions/${sub.id}`)}
                      className={`transition-colors cursor-pointer ${isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/80'}`}>
                      <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleOne(sub.id)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                      </td>
                      {/* Customer (full in flat view) */}
                      <td className="px-4 py-2.5 overflow-hidden" onClick={e => e.stopPropagation()}>
                        {sub.zohoCustomerId ? (
                          <Link href={`/dashboard/customers/${sub.zohoCustomerId}?org_id=${sub.organization.id}`}
                            className="font-semibold text-blue-700 hover:underline truncate block text-[13px]">
                            {sub.zohoCustomerName ?? '—'}
                          </Link>
                        ) : (
                          <p className="font-semibold text-slate-800 truncate text-[13px]">{sub.zohoCustomerName ?? '—'}</p>
                        )}
                        <p className="text-[11px] text-slate-400 mt-0.5 truncate">{sub.organization.name}</p>
                      </td>
                      {orderedVisible.map(col => (
                        <td key={col.id} style={{ width: getW(col.id) }} className={CELL_CLS[col.id]}
                            onClick={col.id === 'domain' ? e => e.stopPropagation() : undefined}>
                          {renderCell(sub, col.id, resellerNames)}
                        </td>
                      ))}
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {sub.zohoItemName?.toLowerCase().includes('google workspace') && (
                            <GoogleResellerButton domainId={sub.domain.id} domainName={sub.domain.domainName} googleCustomerId={sub.domain.googleCustomerId} showAlert={sub.subscriptionCategory === 'google_workspace' && sub._count.googleResellerMatches === 0} />
                          )}
                          <RowCommentsButton subscriptionId={sub.id} commentCount={sub._count.comments} />
                          <EditSubscriptionButton iconOnly subscriptionId={sub.id} itemId={sub.zohoItemId} itemName={sub.zohoItemName ?? ''} orgId={sub.organization.id}
                            quantity={Number(sub.quantity)} currency={sub.currency ?? 'INR'} exchangeRate={Number(sub.exchangeRate ?? 1)} billingCycle={sub.billingCycle}
                            price={Number(sub.subscriptionPrice)} nextRenewalPrice={sub.nextRenewalPrice !== null ? Number(sub.nextRenewalPrice) : null}
                            startDate={sub.startDate} endDate={sub.endDate} autoRenew={sub.autoRenew} lastQuoteNumber={sub.lastQuoteNumber} lastInvoiceNumber={sub.lastInvoiceNumber} />
                        </div>
                      </td>
                    </tr>
                  );
                })
            }
          </tbody>
        </table>
      </div>

      {/* Recent quote warning modal */}
      {recentQuoteWarning.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-w-full overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100">
              <div className="flex items-center gap-3 mb-1">
                <span className="text-2xl">⚠️</span>
                <h3 className="text-base font-bold text-slate-900">Recent Quotes Already Exist</h3>
              </div>
              <p className="text-sm text-slate-500 mt-1">
                {recentQuoteWarning.length} of the selected subscriptions already have a quote generated within the last 30 days.
                Generating again will create a duplicate quote in Zoho Books.
              </p>
            </div>
            <div className="px-6 py-4 max-h-64 overflow-y-auto divide-y divide-slate-50">
              {recentQuoteWarning.map(w => (
                <div key={w.id} className="py-2.5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{w.name}</p>
                    <p className="text-xs text-amber-600 font-mono mt-0.5">{w.quoteNumber}</p>
                  </div>
                  <span className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-2 py-1 rounded-lg font-medium shrink-0">
                    {w.daysAgo === 0 ? 'Today' : w.daysAgo === 1 ? '1 day ago' : `${w.daysAgo} days ago`}
                  </span>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button
                onClick={() => { setRecentQuoteWarning([]); setPendingQuoteIds(null); setPendingCombined(false); }}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const ids = pendingQuoteIds ?? undefined;
                  const isCombined = pendingCombined;
                  setRecentQuoteWarning([]);
                  setPendingQuoteIds(null);
                  setPendingCombined(false);
                  if (isCombined && ids) void doGenerateCombinedQuote(ids);
                  else void doGenerateQuotes(ids);
                }}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold transition-colors"
              >
                Generate Anyway ({pendingQuoteIds?.length ?? selectedIds.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulkCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-base font-bold text-slate-900 mb-1">Bulk Update Category</h2>
            <p className="text-xs text-slate-500 mb-4">
              {selectedIds.length} subscription{selectedIds.length !== 1 ? 's' : ''} selected
            </p>
            <select
              value={bulkCategoryValue}
              onChange={e => setBulkCategoryValue(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-300 mb-5"
            >
              <option value="">— Clear Category —</option>
              {categories.map(c => (
                <option key={c.itemValue} value={c.itemValue}>{c.itemLabel}</option>
              ))}
            </select>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowBulkCategoryModal(false); setBulkCategoryValue(''); }}
                className="px-4 py-2 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkUpdateCategory}
                disabled={isUpdatingCategory}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isUpdatingCategory ? 'Updating...' : 'Update Category'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isPasteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-[500px] max-w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Bulk Select Domains</h3>
              <p className="text-sm text-slate-500 mt-1">Paste a list of domains (comma separated or one per line) to select them from the current view.</p>
            </div>
            <div className="p-5">
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                rows={8}
                className="w-full border-slate-300 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                placeholder="example1.com, example2.com&#10;example3.com"
              />
            </div>
            <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button
                onClick={() => setIsPasteModalOpen(false)}
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handlePasteSelect}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700"
              >
                Select Domains
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
