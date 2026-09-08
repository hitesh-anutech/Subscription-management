'use client';

import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { api, API_BASE } from '@/lib/api';
import { Eye, Trash2 } from 'lucide-react';
import { deleteMultipleSubscriptionsAction } from '../actions';
import { TruncatedTooltip } from '@/components/truncated-tooltip';

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

interface Subscription {
  id: string;
  subscriptionNumber: string;
  zohoCustomerId: string | null;
  zohoCustomerName: string | null;
  zohoItemName: string | null;
  quantity: string;
  subscriptionPrice: string;
  currency?: string;
  billingCycle: string;
  startDate: string;
  endDate: string;
  lifecycleStatus: string;
  processStatus: string;
  lastQuoteNumber: string | null;
  lastQuoteDate: string | null;
  organization: { id: string; name: string };
  domain: { id: string; domainName: string };
  _count: { renewalHistory: number };
  renewalHistory: RenewalHistoryLine[];
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

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600', sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700', declined: 'bg-red-100 text-red-700',
  invoiced: 'bg-purple-100 text-purple-700', expired: 'bg-orange-100 text-orange-700',
  paid: 'bg-emerald-100 text-emerald-700', overdue: 'bg-red-100 text-red-700',
  partially_paid: 'bg-teal-100 text-teal-700',
  Quoted: 'bg-blue-100 text-blue-700', Invoiced: 'bg-purple-100 text-purple-700',
  Paid: 'bg-emerald-100 text-emerald-700',
};

interface LiveLineItem { name: string; qty: number; rate: number; domain: string; startDate: string; endDate: string; }

// Tooltip on the Last Quote cell — fetches live from zoho-doc-line-items API for accurate balance
function QuoteLineItemsTooltip({ sub }: { sub: Subscription }) {
  const h = sub.renewalHistory.find(r => r.quoteNumber === sub.lastQuoteNumber);
  const orgId   = sub.organization.id;
  const docId   = h?.invoiceId ?? h?.quoteId ?? null;
  const kind: 'invoice' | 'estimate' = h?.invoiceId ? 'invoice' : 'estimate';
  const fallbackStatus = h?.zohoInvoiceStatus ?? h?.zohoEstimateStatus ?? h?.renewalStatus ?? '';

  const [state, setState] = useState<{ loading: boolean; items: LiveLineItem[]; docStatus: string | null; balance: number | null; error: string | null }>({
    loading: false, items: [], docStatus: null, balance: null, error: null,
  });
  const fetched = useRef(false);

  useEffect(() => {
    if (!docId || !orgId || fetched.current) return;
    fetched.current = true;
    setState(s => ({ ...s, loading: true }));
    fetch(`${API_BASE}/organizations/${orgId}/zoho-doc-line-items?kind=${kind}&doc_id=${encodeURIComponent(docId)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: { lineItems: LiveLineItem[]; docStatus: string | null; balance: number | null }) =>
        setState({ loading: false, items: data.lineItems ?? [], docStatus: data.docStatus ?? null, balance: data.balance ?? null, error: null }),
      )
      .catch((err: Error) => setState(s => ({ ...s, loading: false, error: err.message })));
  }, [docId, orgId, kind]);

  const statusKey = (state.docStatus ?? fallbackStatus).toLowerCase();
  const badgeCls = STATUS_BADGE[statusKey] ?? 'bg-slate-100 text-slate-600';
  const total = state.items.reduce((s, li) => s + li.qty * li.rate, 0);
  const fmt = (d: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '?';

  // Fallback to local data when no doc ID or while loading
  const localLines = sub.renewalHistory.filter(r => r.quoteNumber === sub.lastQuoteNumber);
  const localTotal = localLines.reduce((s, r) => s + Number(r.subtotalAmount ?? 0), 0);
  const cur = localLines[0]?.currency ?? sub.currency ?? 'INR';

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xl text-xs overflow-hidden">
      <div className="bg-slate-800 text-white px-3 py-2 flex items-center justify-between">
        <span className="font-bold uppercase tracking-wider text-[10px] text-slate-300">LINE ITEMS</span>
        {(state.docStatus ?? fallbackStatus) && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${badgeCls}`}>
            {statusKey || fallbackStatus}
          </span>
        )}
      </div>

      {state.loading && (
        <div className="px-4 py-3 text-slate-400 flex items-center gap-2">
          <span className="animate-spin inline-block w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full" />
          Loading…
        </div>
      )}
      {state.error && <div className="px-4 py-3 text-red-500">❌ {state.error}</div>}

      {/* Live items from Zoho */}
      {!state.loading && !state.error && state.items.length > 0 && (
        <>
          <div className="divide-y divide-slate-50">
            {state.items.map((li, idx) => (
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
              <span className="text-slate-400 text-[10px]">{h?.businessType} · {state.items.length} item{state.items.length !== 1 ? 's' : ''}</span>
              <span className="font-bold text-slate-800 tabular-nums">Total ₹{total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
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

      {/* Fallback: local renewal_history data (no doc ID or before Zoho fetch) */}
      {!state.loading && !state.error && state.items.length === 0 && localLines.length > 0 && (
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

      {!state.loading && !state.error && state.items.length === 0 && localLines.length === 0 && (
        <div className="px-4 py-3 text-slate-400 italic">No line item data available</div>
      )}
    </div>
  );
}

const TOOLTIP_W = 420;

function LastQuoteCell({ sub }: { sub: Subscription }) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!sub.lastQuoteNumber) return <span className="text-slate-300">—</span>;

  const days = daysSince(sub.lastQuoteDate);
  const isRecent = days <= 30;

  const handleMouseEnter = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // Center tooltip on the trigger, then clamp so it never goes off-screen
    const centeredX = rect.left + rect.width / 2 - TOOLTIP_W / 2;
    const clampedX = Math.max(8, Math.min(centeredX, window.innerWidth - TOOLTIP_W - 8));
    setTooltipPos({ x: clampedX, y: rect.top });
  };

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setTooltipPos(null)}
        className="inline-block cursor-default"
      >
        <div className={`text-[11px] font-mono ${isRecent ? 'text-amber-600 font-semibold' : 'text-slate-500'}`}>
          {sub.lastQuoteNumber}
        </div>
        <div className={`text-[10px] mt-0.5 ${isRecent ? 'text-amber-500' : 'text-slate-400'}`}>
          {days === 0 ? 'Today' : days === 1 ? '1d ago' : `${days}d ago`}
          {isRecent && <span className="ml-1 bg-amber-100 text-amber-700 px-1 py-0.5 rounded text-[9px] font-bold">RECENT</span>}
        </div>
      </div>

      {/* Portal: renders outside overflow container so it's never clipped */}
      {tooltipPos && mounted && createPortal(
        <div
          style={{
            position: 'fixed',
            left: tooltipPos.x,
            top: tooltipPos.y,
            transform: 'translateY(calc(-100% - 8px))',
            width: TOOLTIP_W,
            zIndex: 9999,
          }}
          onMouseEnter={() => setTooltipPos(tooltipPos)}
          onMouseLeave={() => setTooltipPos(null)}
        >
          <QuoteLineItemsTooltip sub={sub} />
        </div>,
        document.body
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

export function SubscriptionsTable({
  subscriptions,
  initialSelectedIds,
  isAdmin = false,
}: {
  subscriptions: Subscription[];
  initialSelectedIds?: string[];
  isAdmin?: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds ?? []);
  const [isUpdatingPrice, setIsUpdatingPrice] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [recentQuoteWarning, setRecentQuoteWarning] = useState<{ id: string; name: string; quoteNumber: string; daysAgo: number }[]>([]);
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

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

  const doGenerateQuotes = async () => {
    setRecentQuoteWarning([]);
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
        subscriptionIds: selectedIds,
      });

      // Surface any group-level failures, but still proceed to review the ones that succeeded.
      if (res.failedCount > 0) {
        alert(
          `${res.createdCount} of ${res.totalGroups} quote group(s) created.\n\n` +
          `${res.failedCount} failed:\n- ${res.errors.join('\n- ')}`,
        );
      }
      setSelectedIds([]);

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
            <button
              onClick={handleBulkUpdatePrice}
              disabled={isUpdatingPrice || isQuoting || isUpdatingStatus}
              className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50 disabled:opacity-50"
            >
              {isUpdatingPrice ? 'Updating...' : 'Bulk Update Price'}
            </button>
            <button
              onClick={handleBulkQuote}
              disabled={isUpdatingPrice || isQuoting || isUpdatingStatus}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isQuoting ? 'Generating...' : 'Generate Quotes'}
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

      {/* Scrollable table — sticky header, both H and V scroll */}
      <div className="rounded-xl border border-slate-200 overflow-auto max-h-[calc(100vh-290px)] bg-white">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 text-left w-10">
                <input
                  type="checkbox"
                  checked={selectedIds.length > 0 && selectedIds.length === subscriptions.length}
                  ref={el => {
                    if (el) el.indeterminate = selectedIds.length > 0 && selectedIds.length < subscriptions.length;
                  }}
                  onChange={toggleAll}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Customer / Domain</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Item</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Qty</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Price</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Subs. Period</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Status</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Last Quote</th>
              <th className="px-4 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {subscriptions.map((sub) => {
              const days = daysUntil(sub.endDate);
              const isUrgent = days <= 30 && days >= 0;
              const isSelected = selectedIds.includes(sub.id);
              return (
                <tr
                  key={sub.id}
                  className={`transition-colors ${isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/80'}`}
                >
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(sub.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    {sub.zohoCustomerId ? (
                      <Link
                        href={`/dashboard/customers/${sub.zohoCustomerId}?org_id=${sub.organization.id}`}
                        className="font-semibold text-blue-700 hover:underline truncate max-w-48 block text-[13px]"
                      >
                        {sub.zohoCustomerName ?? '—'}
                      </Link>
                    ) : (
                      <p className="font-semibold text-slate-800 truncate max-w-48 text-[13px]">
                        {sub.zohoCustomerName ?? '—'}
                      </p>
                    )}
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {sub.domain.domainName} · {sub.organization.name}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <TruncatedTooltip text={sub.zohoItemName ?? '—'} className="text-slate-700 text-[13px]" />
                    <p className="text-[11px] text-slate-400">{sub.billingCycle}</p>
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-700 text-[13px]">{sub.quantity}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700 font-medium text-[13px]">
                    {money(Number(sub.subscriptionPrice), sub.currency)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <p className={`text-[13px] ${isUrgent ? 'text-red-600 font-semibold' : 'text-slate-700'}`}>
                      {fmt(sub.startDate)} <span className="text-slate-400">→</span> {fmt(sub.endDate)}
                    </p>
                    {days >= 0 && (
                      <p className={`text-[11px] mt-0.5 ${isUrgent ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                        {days === 0 ? 'Today' : `${days} days`}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <StatusBadge status={sub.lifecycleStatus} endDate={sub.endDate} />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <LastQuoteCell sub={sub} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/dashboard/subscriptions/${sub.id}`}
                      title="View Details"
                      className="p-1.5 rounded-lg border border-blue-100 bg-blue-50/50 text-blue-500 hover:bg-blue-100 hover:text-blue-700 transition-all active:scale-95 inline-flex"
                    >
                      <Eye className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
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
                onClick={() => setRecentQuoteWarning([])}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={doGenerateQuotes}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold transition-colors"
              >
                Generate Anyway ({selectedIds.length})
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
