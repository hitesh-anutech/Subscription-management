'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { Eye } from 'lucide-react';
import { EditSubscriptionButton } from '../../../subscriptions/[id]/_components/edit-subscription-modal';
import { GoogleResellerButton } from '../../../subscriptions/_components/subscriptions-table';

interface CustomerResult {
  zohoId: string;
  displayName: string;
  email?: string | null;
  extra?: Record<string, unknown> | null;
}

function TransferCustomerModal({
  orgId,
  selectedCount,
  onConfirm,
  onClose,
}: {
  orgId: string;
  selectedCount: number;
  onConfirm: (c: CustomerResult) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerResult[]>([]);
  const [selected, setSelected] = useState<CustomerResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/organizations/${orgId}/cache/customers?q=${encodeURIComponent(query.trim())}&limit=10`);
        const data = await res.json() as CustomerResult[];
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [query, orgId]);

  const handleConfirm = async () => {
    if (!selected) return;
    setConfirming(true);
    setError(null);
    try {
      await onConfirm(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transfer failed');
      setConfirming(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">🔄 Transfer Customer</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-slate-600">
            <strong>{selectedCount}</strong> subscription{selectedCount !== 1 ? 's' : ''} ko naye customer ke under transfer karo.
          </p>

          {/* Customer search */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">New Customer Search</label>
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
              placeholder="Customer name type karo…"
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searching && <p className="text-xs text-slate-400 mt-1">Searching…</p>}

            {results.length > 0 && !selected && (
              <ul className="mt-1 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-y-auto shadow-sm">
                {results.map((c) => {
                  const custNo = c.extra?.contact_number as string | undefined;
                  return (
                    <li key={c.zohoId}>
                      <button
                        type="button"
                        onClick={() => { setSelected(c); setResults([]); }}
                        className="w-full text-left px-3 py-2.5 hover:bg-blue-50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-800">{c.displayName}</p>
                          {custNo && (
                            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">
                              {custNo}
                            </span>
                          )}
                        </div>
                        {c.email && <p className="text-xs text-slate-400 mt-0.5">{c.email}</p>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Selected customer confirmation */}
          {selected && (
            <div className="px-3 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-sm">
              <p className="text-xs text-blue-500 font-medium mb-0.5">Transfer to:</p>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-blue-900">{selected.displayName}</p>
                {Boolean(selected.extra?.contact_number) && (
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 shrink-0">
                    {selected.extra?.contact_number as string}
                  </span>
                )}
              </div>
              {selected.email && <p className="text-xs text-blue-600 mt-0.5">{selected.email}</p>}
              <button onClick={() => setSelected(null)} className="text-xs text-blue-500 hover:underline mt-1">
                Change
              </button>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selected || confirming}
              onClick={handleConfirm}
              className="px-5 py-2 text-sm font-semibold bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 text-white rounded-lg transition-colors"
            >
              {confirming ? 'Transferring…' : `Transfer (${selectedCount})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface Sub {
  id: string;
  subscriptionNumber: string;
  lifecycleStatus: string;
  zohoItemId: string;
  zohoItemName: string | null;
  quantity: string;
  subscriptionPrice: string;
  currency: string;
  exchangeRate: string | null;
  nextRenewalPrice: string | null;
  autoRenew: boolean;
  subscriptionCategory: string | null;
  billingCycle: string;
  startDate: string;
  endDate: string;
  lastQuoteId: string | null;
  lastQuoteNumber: string | null;
  lastInvoiceId: string | null;
  lastInvoiceNumber: string | null;
  domain: { id: string; domainName: string; googleCustomerId: string | null } | null;
  _count: { googleResellerMatches: number };
  googleResellerMatches: { reconciliationFlags: string[] }[];
}

interface SyncJobStatus {
  jobId: string; status: string; total: number;
  processed: number; succeeded: number; failed: number;
  results: { domainName: string; success: boolean; error?: string }[];
}

const DC_TLD: Record<string, string> = { in: 'in', com: 'com', eu: 'eu', com_au: 'com.au', jp: 'jp', sa: 'sa' };

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

const STATUS_STYLES: Record<string, string> = {
  Active: 'bg-emerald-100 text-emerald-700',
  Expiring_Soon: 'bg-amber-100 text-amber-700',
  Expired: 'bg-red-100 text-red-700',
  Pending: 'bg-slate-100 text-slate-500',
  Inactive: 'bg-slate-100 text-slate-500',
  Cancelled: 'bg-red-50 text-red-400',
};

// Only these statuses can be renewed → eligible for a combined quote.
const RENEWABLE = ['Active', 'Expiring_Soon', 'Expired'];

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const daysDiff = (endDate: string) => Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);

export default function CustomerSubscriptions({
  orgId,
  customerId,
  customerName,
  subscriptions,
  isAdmin,
  categories = [],
  zohoOrgId = '',
  dataCenter = 'in',
}: {
  orgId: string;
  customerId: string;
  customerName: string;
  subscriptions: Sub[];
  isAdmin: boolean;
  categories?: { itemValue: string; itemLabel: string }[];
  zohoOrgId?: string;
  dataCenter?: string;
}) {
  const tld = DC_TLD[dataCenter] ?? 'com';
  const zohoBase = zohoOrgId ? `https://books.zoho.${tld}/app/${zohoOrgId}#` : '';
  const router = useRouter();
  const renewable = subscriptions.filter((s) => RENEWABLE.includes(s.lifecycleStatus));
  // Checkboxes are always visible but start EMPTY — user picks which
  // subscriptions go into the combined quote (header checkbox = select all visible).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [gSyncJobId, setGSyncJobId] = useState<string | null>(null);
  const [gSyncStatus, setGSyncStatus] = useState<SyncJobStatus | null>(null);
  const [reconBusy, setReconBusy] = useState(false);
  const [reconResult, setReconResult] = useState<{ matched: number; total: number } | null>(null);

  // Search + filters (client-side — the list is already loaded)
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [domainFilter, setDomainFilter] = useState('all');

  useEffect(() => {
    if (!gSyncJobId) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/google-workspace/customers/sync-job/${gSyncJobId}`, { credentials: 'include' });
        if (!res.ok) { clearInterval(iv); setGSyncJobId(null); return; }
        const data = await res.json() as SyncJobStatus;
        if (data.status === 'not_found') { clearInterval(iv); setGSyncJobId(null); return; }
        setGSyncStatus(data);
        if (data.status === 'done') { clearInterval(iv); setGSyncJobId(null); }
      } catch { clearInterval(iv); setGSyncJobId(null); }
    }, 2000);
    return () => clearInterval(iv);
  }, [gSyncJobId]);

  const domainOptions = [...new Set(subscriptions.map((s) => s.domain?.domainName).filter(Boolean))] as string[];
  const statusOptions = [...new Set(subscriptions.map((s) => s.lifecycleStatus))];

  const visible = subscriptions.filter((s) => {
    if (statusFilter === 'expiring_30d') {
      const days = daysDiff(s.endDate);
      if (days < 0 || days > 30) return false;
    } else if (statusFilter !== 'all' && s.lifecycleStatus !== statusFilter) return false;
    if (domainFilter !== 'all' && s.domain?.domainName !== domainFilter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    // Free-text match across sub#, item, domain, qty and formatted dates
    return [
      s.subscriptionNumber,
      s.zohoItemName ?? '',
      s.domain?.domainName ?? '',
      String(Number(s.quantity)),
      fmt(s.startDate),
      fmt(s.endDate),
    ].some((v) => v.toLowerCase().includes(q));
  });

  // When exactly 1 subscription is selected, pre-fill domain + dates + billing cycle.
  const selectedSub = selectedIds.length === 1
    ? subscriptions.find(s => s.id === selectedIds[0]) ?? null
    : null;

  const newSubHref = (() => {
    const p = new URLSearchParams({
      mode: 'manual',
      org_id: orgId,
      customer_id: customerId,
      customer_name: customerName,
    });
    if (selectedSub) {
      if (selectedSub.domain) {
        p.set('domain_id', selectedSub.domain.id);
        p.set('domain_name', selectedSub.domain.domainName);
      }
      p.set('start_date', selectedSub.startDate.split('T')[0]);
      p.set('end_date', selectedSub.endDate.split('T')[0]);
      p.set('billing_cycle', selectedSub.billingCycle);
      p.set('cloned_from', selectedSub.subscriptionNumber);
    }
    return `/dashboard/subscriptions/new?${p.toString()}`;
  })();

  const toggleOne = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Select-all operates on ALL visible rows (renewable for quote actions, any for transfer).
  const allVisibleSelected =
    visible.length > 0 && visible.every((s) => selectedIds.includes(s.id));
  const someVisibleSelected = visible.some((s) => selectedIds.includes(s.id));
  const toggleAll = () =>
    setSelectedIds((prev) => {
      const visIds = visible.map((s) => s.id);
      return allVisibleSelected
        ? prev.filter((id) => !visIds.includes(id))
        : [...new Set([...prev, ...visIds])];
    });
  // Renewable subset (for renew-action buttons)
  const visibleRenewable = visible.filter((s) => RENEWABLE.includes(s.lifecycleStatus));

  const handleDirectRenew = async () => {
    if (!selectedIds.length) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/subscriptions/combined-renewal-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionIds: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Combined quote generation failed');
      setResult({
        ok: true,
        msg: `✅ Combined quote ${data.zohoEstimateNumber} बन गया — ${data.lineCount} line${
          data.lineCount === 1 ? '' : 's'
        } · ${data.domainCount} domains · ₹${Number(data.totalAmount).toLocaleString('en-IN')}`,
      });
      setSelectedIds([]);
      router.refresh();
    } catch (err) {
      setResult({ ok: false, msg: `❌ ${err instanceof Error ? err.message : 'Error'}` });
    } finally {
      setBusy(false);
    }
  };

  const handleCustomizeRenew = () => {
    if (!selectedIds.length) return;
    router.push(`/dashboard/quick-quotes/new?mode=renewal&subscription_ids=${selectedIds.join(',')}`);
  };

  const handleTransferCustomer = async (newCustomer: CustomerResult) => {
    const res = await fetch('/api/subscriptions/bulk-transfer-customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriptionIds: selectedIds,
        zohoCustomerId: newCustomer.zohoId,
        zohoCustomerName: newCustomer.displayName,
      }),
    });
    const data = await res.json() as { count?: number; message?: string };
    if (!res.ok) throw new Error((data as { message?: string }).message || 'Transfer failed');
    setResult({ ok: true, msg: `✅ ${data.count} subscription${(data.count ?? 0) !== 1 ? 's' : ''} "${newCustomer.displayName}" ko transfer ho gaye` });
    setSelectedIds([]);
    setShowTransfer(false);
    router.refresh();
  };

  const handleDeleteSelected = async () => {
    setBusy(true);
    setResult(null);
    const results = await Promise.allSettled(
      selectedIds.map(id =>
        fetch(`/api/subscriptions/${id}`, { method: 'DELETE' })
          .then(r => { if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`); }),
      ),
    );
    const failed = results.filter(r => r.status === 'rejected').length;
    const ok = results.length - failed;
    setResult({
      ok: failed === 0,
      msg: failed === 0
        ? `✅ ${ok} subscription${ok !== 1 ? 's' : ''} permanently delete हो गई`
        : `⚠️ ${ok} deleted, ${failed} failed`,
    });
    setSelectedIds([]);
    setShowDeleteConfirm(false);
    setBusy(false);
    router.refresh();
  };

  // GWS detection: category field OR item name (same as subscriptions list page)
  const isGws = (s: Sub) =>
    s.subscriptionCategory === 'google_workspace' ||
    (s.zohoItemName?.toLowerCase().includes('google workspace') ?? false);

  const allGwsDomainIds = [...new Set(
    subscriptions.filter(s => isGws(s) && s.domain).map(s => s.domain!.id),
  )];
  const selectedGwsDomainIds = [...new Set(
    subscriptions.filter(s => selectedIds.includes(s.id) && isGws(s) && s.domain).map(s => s.domain!.id),
  )];
  // If any GWS subs are selected → operate on those; else → all GWS domains
  const syncDomainIds = selectedGwsDomainIds.length > 0 ? selectedGwsDomainIds : allGwsDomainIds;
  const selectedGwsCount = subscriptions.filter(s => selectedIds.includes(s.id) && isGws(s)).length;

  const startGoogleSync = async (body: { domainIds?: string[]; syncAll?: boolean }) => {
    const res = await fetch(`${API_BASE}/google-workspace/customers/fetch-bulk`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const e = await res.json() as { message?: string }; throw new Error(e.message ?? 'Sync failed'); }
    const { jobId, total } = await res.json() as { jobId: string; total: number };
    setGSyncJobId(jobId);
    setGSyncStatus({ jobId, status: 'running', total, processed: 0, succeeded: 0, failed: 0, results: [] });
  };

  const handleGoogleSync = async () => {
    if (!syncDomainIds.length) { alert('Koi GWS subscription nahi mili।'); return; }
    try { await startGoogleSync({ domainIds: syncDomainIds }); }
    catch (err: unknown) { alert(`Sync Error: ${err instanceof Error ? err.message : 'Unknown'}`); }
  };

  const handleRunRecon = async () => {
    setReconBusy(true); setReconResult(null);
    try {
      const selectedGwsDomainNames = [...new Set(
        subscriptions.filter(s => selectedIds.includes(s.id) && isGws(s) && s.domain).map(s => s.domain!.domainName)
      )];
      const allGwsDomainNames = [...new Set(
        subscriptions.filter(s => isGws(s) && s.domain).map(s => s.domain!.domainName)
      )];
      const reconDomainNames = selectedGwsDomainNames.length > 0 ? selectedGwsDomainNames : allGwsDomainNames;
      const res = await fetch(`${API_BASE}/google-workspace/reseller-subs/reconcile`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domainNames: reconDomainNames }),
      });
      if (!res.ok) throw new Error('Recon failed');
      const data = await res.json() as { matched: number; total: number };
      setReconResult(data);
    } catch (err: unknown) {
      alert(`Recon Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setReconBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Section header with the two right-aligned action buttons */}
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-slate-700">
          📄 Active Subscriptions ({subscriptions.length})
        </h2>
        <div className="flex items-center gap-2">
          <Link
            href={newSubHref as any}
            title={selectedSub ? `${selectedSub.domain?.domainName ?? ''} ke dates/domain pre-fill होंगे — sirf Item aur Qty baro` : ''}
            className={`px-3 py-1.5 border text-xs font-semibold rounded-lg transition-colors ${
              selectedSub
                ? 'border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100'
                : 'border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {selectedSub ? `+ New (from ${selectedSub.domain?.domainName ?? selectedSub.subscriptionNumber})` : '+ New Subscription'}
          </Link>
          <button
            onClick={handleDirectRenew}
            disabled={busy || selectedIds.length === 0}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-xs font-semibold rounded-lg"
            title="चुनी हुई subscriptions के लिए सीधे Zoho में quote बनाएँ (1-Click)"
          >
            {busy ? 'Generating…' : `⚡ Direct Renew (${selectedIds.length})`}
          </button>
          <button
            onClick={handleCustomizeRenew}
            disabled={busy || selectedIds.length === 0}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-xs font-semibold rounded-lg"
            title="चुनी हुई subscriptions को कस्टमाइज़ करने के लिए Quote Builder पर जाएँ"
          >
            ✏️ Customize & Renew ({selectedIds.length})
          </button>
          {selectedIds.length > 0 && (
            <button
              onClick={() => setShowTransfer(true)}
              disabled={busy}
              className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white text-xs font-semibold rounded-lg"
              title="चुनी हुई subscriptions का customer बदलो"
            >
              🔄 Transfer Customer ({selectedIds.length})
            </button>
          )}
          {isAdmin && selectedIds.length > 0 && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={busy}
              title={`Delete ${selectedIds.length} selected subscription${selectedIds.length !== 1 ? 's' : ''} permanently`}
              className="p-1.5 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-400 disabled:opacity-50 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.808a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
        {/* Google Sync + Recon toolbar */}
        <div className="flex items-center gap-2 w-full pt-1 border-t border-slate-100 mt-1">
          <button
            onClick={() => void handleGoogleSync()}
            disabled={!!gSyncJobId}
            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {gSyncJobId
              ? `Syncing ${gSyncStatus?.processed ?? 0}/${gSyncStatus?.total ?? '…'}`
              : selectedGwsDomainIds.length > 0
                ? `G Sync Selected (${selectedGwsDomainIds.length} domains)`
                : `Sync All Google (${allGwsDomainIds.length} domains)`}
          </button>
          <button
            onClick={() => void handleRunRecon()}
            disabled={reconBusy || !!gSyncJobId}
            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {reconBusy
              ? '⏳ Running…'
              : selectedGwsCount > 0
                ? `🔄 Recon Selected (${selectedGwsCount})`
                : '🔄 Run Reconciliation'}
          </button>
          {reconResult && (
            <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded">
              Recon done: {reconResult.matched} matched
            </span>
          )}
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl border border-red-100 w-full max-w-sm mx-4 p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">🗑️</span>
              <h3 className="text-base font-bold text-slate-800">Delete Subscriptions?</h3>
            </div>
            <p className="text-sm text-slate-600 mb-1">
              You are about to <span className="font-semibold text-red-600">permanently delete</span>{' '}
              <span className="font-bold">{selectedIds.length}</span> subscription{selectedIds.length !== 1 ? 's' : ''}.
            </p>
            <p className="text-xs text-slate-400 mb-5">यह action undo नहीं हो सकती। Renewal history भी delete हो जाएगी।</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={busy}
                className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDeleteSelected()}
                disabled={busy}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-red-300 rounded-xl"
              >
                {busy ? 'Deleting…' : `Delete ${selectedIds.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTransfer && (
        <TransferCustomerModal
          orgId={orgId}
          selectedCount={selectedIds.length}
          onConfirm={handleTransferCustomer}
          onClose={() => setShowTransfer(false)}
        />
      )}

      {result && (
        <div
          className={`px-5 py-2.5 text-xs border-b ${
            result.ok
              ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
              : 'bg-red-50 border-red-100 text-red-700'
          }`}
        >
          {result.msg}
        </div>
      )}

      {/* Google Sync progress */}
      {gSyncJobId && gSyncStatus && (
        <div className="px-5 py-2.5 bg-blue-50 border-b border-blue-100 text-xs text-blue-700">
          <div className="flex items-center justify-between mb-1">
            <span>Google Sync: {gSyncStatus.processed}/{gSyncStatus.total} domains</span>
            <span>{gSyncStatus.succeeded} ok{gSyncStatus.failed > 0 ? ` • ${gSyncStatus.failed} failed` : ''}</span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-1.5">
            <div className="bg-blue-600 h-1.5 rounded-full transition-all" style={{ width: `${gSyncStatus.total > 0 ? Math.round((gSyncStatus.processed / gSyncStatus.total) * 100) : 0}%` }} />
          </div>
        </div>
      )}
      {!gSyncJobId && gSyncStatus?.status === 'done' && (
        <div className={`px-5 py-2 border-b text-xs ${gSyncStatus.failed > 0 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
          Google Sync complete: {gSyncStatus.succeeded}/{gSyncStatus.total} synced{gSyncStatus.failed > 0 ? ` • ${gSyncStatus.failed} failed` : ''}
        </div>
      )}

      {/* Search + filters */}
      {subscriptions.length > 0 && (
        <div className="px-5 py-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center gap-2 flex-wrap">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 Search — sub#, item, domain, qty, date…"
            className="flex-1 min-w-[220px] px-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            title="Status filter"
          >
            <option value="all">All statuses</option>
            <option value="expiring_30d">⏳ Expiring ≤ 30d</option>
            {statusOptions.map((st) => (
              <option key={st} value={st}>{st.replace('_', ' ')}</option>
            ))}
          </select>
          <select
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            title="Domain filter"
          >
            <option value="all">All domains</option>
            {domainOptions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          {(query || statusFilter !== 'all' || domainFilter !== 'all') && (
            <span className="text-xs text-slate-400">
              {visible.length}/{subscriptions.length} shown
              <button
                onClick={() => { setQuery(''); setStatusFilter('all'); setDomainFilter('all'); }}
                className="ml-2 text-blue-600 hover:underline"
              >
                Clear
              </button>
            </span>
          )}
        </div>
      )}

      {subscriptions.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-400">कोई subscription नहीं।</p>
      ) : visible.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-400">कोई matching subscription नहीं — filters बदलो।</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-4 py-2.5 w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                    }}
                    onChange={toggleAll}
                    title="Combined Quote के लिए select/deselect all (visible rows)"
                    className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                  />
                </th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 whitespace-nowrap">Sub #</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Item</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Domain</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right whitespace-nowrap">Qty / Price</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 whitespace-nowrap">Last Quote / Invoice</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-center whitespace-nowrap">Recon</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((s) => {
                const days = daysDiff(s.endDate);
                const isExpiring = days >= 0 && days <= 30;
                const canRenew = RENEWABLE.includes(s.lifecycleStatus);
                return (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(s.id)}
                        onChange={() => toggleOne(s.id)}
                        title="Select for bulk action"
                        className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                      <Link
                        href={`/dashboard/subscriptions/${s.id}`}
                        className="text-blue-600 hover:underline"
                        title="Subscription detail देखें"
                      >
                        {s.subscriptionNumber}
                      </Link>
                      <div className="mt-1">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_STYLES[s.lifecycleStatus] ?? 'bg-slate-100 text-slate-500'}`}>
                          {s.lifecycleStatus.replace('_', ' ')}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 min-w-[200px]">
                      <p className="text-slate-800 text-xs font-medium leading-snug">{s.zohoItemName ?? '—'}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5 whitespace-nowrap">
                        {fmt(s.startDate)} — {fmt(s.endDate)}
                        {isExpiring && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold text-[9px]">
                            {days}d
                          </span>
                        )}
                      </p>
                    </td>
                    {/* Domain + Copy */}
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {s.domain?.domainName
                        ? (
                          <span className="inline-flex items-center gap-1 group">
                            <span className="text-blue-600 group-hover:text-blue-700 transition-colors">{s.domain.domainName}</span>
                            <button
                              type="button"
                              title="Copy domain name"
                              onClick={() => void navigator.clipboard.writeText(s.domain!.domainName)}
                              className="opacity-0 group-hover:opacity-100 transition-all text-slate-400 group-hover:text-blue-500 hover:text-blue-700 p-0.5 group-hover:p-1 rounded hover:bg-blue-50"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 group-hover:w-3.5 group-hover:h-3.5 transition-all">
                                <path d="M5.5 3.5A1.5 1.5 0 0 1 7 2h4.5A1.5 1.5 0 0 1 13 3.5v7a1.5 1.5 0 0 1-1.5 1.5H11v-1h.5a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5H7a.5.5 0 0 0-.5.5V4H5.5v-.5Z" />
                                <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h4A1.5 1.5 0 0 1 10 5.5v7A1.5 1.5 0 0 1 8.5 14h-4A1.5 1.5 0 0 1 3 12.5v-7Zm1.5-.5a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5h-4Z" />
                              </svg>
                            </button>
                          </span>
                        )
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    {/* Qty + Price */}
                    <td className="px-4 py-3 text-right">
                      <span className="text-slate-700 text-sm font-medium">{Number(s.quantity)}</span>
                      <p className="text-[10px] text-slate-400 mt-0.5 whitespace-nowrap">
                        {s.currency && s.currency !== 'INR' ? s.currency : '₹'}
                        {Number(s.subscriptionPrice).toLocaleString('en-IN')}
                      </p>
                    </td>
                    {/* Last Quote / Invoice — merged column */}
                    <td className="px-4 py-3 text-xs font-mono whitespace-nowrap">
                      <div className="flex flex-col gap-0.5">
                        {/* Quote row */}
                        {s.lastQuoteNumber
                          ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="text-slate-600">{s.lastQuoteNumber}</span>
                              {zohoBase && s.lastQuoteId && (
                                <a
                                  href={`${zohoBase}/quotes/${s.lastQuoteId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-slate-400 hover:text-blue-600 transition-colors"
                                  title="Zoho Books में खोलें"
                                >
                                  ↗
                                </a>
                              )}
                            </span>
                          )
                          : <span className="text-slate-300">—</span>
                        }
                        {/* Invoice row */}
                        {s.lastInvoiceNumber
                          ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="text-slate-600">{s.lastInvoiceNumber}</span>
                              {zohoBase && s.lastInvoiceId && (
                                <a
                                  href={`${zohoBase}/invoices/${s.lastInvoiceId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-slate-400 hover:text-blue-600 transition-colors"
                                  title="Zoho Books में खोलें"
                                >
                                  ↗
                                </a>
                              )}
                            </span>
                          )
                          : <span className="text-slate-300">—</span>
                        }
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        {isGws(s) && (
                          s._count.googleResellerMatches > 0
                            ? <span className="inline-block text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">✓ Matched</span>
                            : <span className="inline-block text-[10px] font-bold text-red-700 bg-red-100 border border-red-400 px-1.5 py-0.5 rounded">✗ Unmatched</span>
                        )}
                        {s.googleResellerMatches?.[0]?.reconciliationFlags?.includes('plan_mismatch') && (
                          <span className="inline-block text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded" title="Matched on domain only — plan names differ between Google and local subscription">⚠ Plan Mismatch</span>
                        )}
                        {!isGws(s) && <span className="text-slate-300 text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {s.domain && (
                          <GoogleResellerButton
                            domainId={s.domain.id}
                            domainName={s.domain.domainName}
                            googleCustomerId={s.domain.googleCustomerId}
                            showAlert={isGws(s) && s._count.googleResellerMatches === 0}
                          />
                        )}
                        <EditSubscriptionButton
                          iconOnly
                          subscriptionId={s.id}
                          itemId={s.zohoItemId}
                          itemName={s.zohoItemName ?? ''}
                          orgId={orgId}
                          quantity={Number(s.quantity)}
                          currency={s.currency || 'INR'}
                          exchangeRate={Number(s.exchangeRate ?? 1)}
                          billingCycle={s.billingCycle}
                          price={Number(s.subscriptionPrice)}
                          nextRenewalPrice={s.nextRenewalPrice ? Number(s.nextRenewalPrice) : null}
                          startDate={s.startDate}
                          endDate={s.endDate}
                          autoRenew={s.autoRenew}
                          subscriptionCategory={s.subscriptionCategory}
                          categories={categories}
                          lastQuoteNumber={s.lastQuoteNumber}
                          lastInvoiceNumber={s.lastInvoiceNumber}
                        />
                        <Link
                          href={`/dashboard/subscriptions/${s.id}`}
                          className="inline-flex items-center justify-center p-1.5 rounded-xl border border-blue-100 bg-blue-50/50 text-blue-600 hover:bg-blue-100 transition-colors"
                          title="View subscription"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
