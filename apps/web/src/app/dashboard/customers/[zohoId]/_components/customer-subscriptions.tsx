'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { Eye } from 'lucide-react';
import { TruncatedTooltip } from '@/components/truncated-tooltip';

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
                {selected.extra?.contact_number && (
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 shrink-0">
                    {selected.extra.contact_number as string}
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
  zohoItemName: string | null;
  quantity: string;
  startDate: string;
  endDate: string;
  domain: { id: string; domainName: string } | null;
}

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
}: {
  orgId: string;
  customerId: string;
  customerName: string;
  subscriptions: Sub[];
}) {
  const router = useRouter();
  const renewable = subscriptions.filter((s) => RENEWABLE.includes(s.lifecycleStatus));
  // Checkboxes are always visible but start EMPTY — user picks which
  // subscriptions go into the combined quote (header checkbox = select all visible).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);

  // Search + filters (client-side — the list is already loaded)
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [domainFilter, setDomainFilter] = useState('all');

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

  const newSubQuery = new URLSearchParams({
    mode: 'manual',
    org_id: orgId,
    customer_id: customerId,
    customer_name: customerName,
  }).toString();

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

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Section header with the two right-aligned action buttons */}
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-slate-700">
          📄 Active Subscriptions ({subscriptions.length})
        </h2>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/subscriptions/new?${newSubQuery}`}
            className="px-3 py-1.5 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50"
          >
            + New Subscription
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
        </div>
      </div>

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
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Sub #</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Item</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Domain</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Qty</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Term</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-center">Status</th>
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
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link
                        href={`/dashboard/subscriptions/${s.id}`}
                        className="text-blue-600 hover:underline"
                        title="Subscription detail देखें"
                      >
                        {s.subscriptionNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <TruncatedTooltip text={s.zohoItemName ?? '—'} className="text-slate-800" />
                    </td>
                    <td className="px-4 py-3 text-blue-600 text-xs">{s.domain?.domainName || '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{Number(s.quantity)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {fmt(s.startDate)} — {fmt(s.endDate)}
                      {isExpiring && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold text-xs">
                          {days}d
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                          STATUS_STYLES[s.lifecycleStatus] ?? 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {s.lifecycleStatus.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/subscriptions/${s.id}`}
                        className="inline-flex items-center justify-center p-1.5 rounded-xl border border-blue-100 bg-blue-50/50 text-blue-600 hover:bg-blue-100 transition-colors"
                        title="View subscription"
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
      )}
    </div>
  );
}
