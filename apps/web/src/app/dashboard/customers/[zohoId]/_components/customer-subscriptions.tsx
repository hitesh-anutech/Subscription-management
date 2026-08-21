'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Eye } from 'lucide-react';

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

  // Select-all operates on the VISIBLE renewable rows (respects active filters).
  const visibleRenewable = visible.filter((s) => RENEWABLE.includes(s.lifecycleStatus));
  const allVisibleSelected =
    visibleRenewable.length > 0 && visibleRenewable.every((s) => selectedIds.includes(s.id));
  const someVisibleSelected = visibleRenewable.some((s) => selectedIds.includes(s.id));
  const toggleAll = () =>
    setSelectedIds((prev) => {
      const visIds = visibleRenewable.map((s) => s.id);
      return allVisibleSelected
        ? prev.filter((id) => !visIds.includes(id))
        : [...new Set([...prev, ...visIds])];
    });

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
        </div>
      </div>

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
                        disabled={!canRenew}
                        onChange={() => toggleOne(s.id)}
                        title={canRenew ? 'Combined Quote में शामिल करें' : 'Not renewable (status)'}
                        className="rounded border-slate-300 text-purple-600 focus:ring-purple-500 disabled:opacity-40"
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
                    <td className="px-4 py-3 text-slate-800 max-w-[200px] truncate" title={s.zohoItemName ?? undefined}>
                      {s.zohoItemName || '—'}
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
