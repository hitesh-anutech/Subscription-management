'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

interface DomainSub {
  id: string;
  subscriptionNumber: string;
  zohoItemName: string | null;
  billingCycle: string;
  lifecycleStatus: string;
  startDate: string;
  endDate: string;
  quantity: string;
  subscriptionPrice: string;
  currency?: string;
}

const STATUS_STYLES: Record<string, string> = {
  Active:        'bg-green-100 text-green-700',
  Expiring_Soon: 'bg-amber-100 text-amber-700',
  Expired:       'bg-red-100 text-red-700',
  Pending:       'bg-slate-100 text-slate-500',
  Inactive:      'bg-slate-100 text-slate-400',
  Cancelled:     'bg-slate-100 text-slate-400',
};

const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', AUD: 'A$', CAD: 'C$',
};

const RENEWABLE = new Set(['Active', 'Expiring_Soon', 'Expired']);

function effStatus(status: string, endDate: string): string {
  const days = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'Expired';
  if (days <= 30) return 'Expiring_Soon';
  return status;
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function money(amount: number, currency = 'INR') {
  const sym = CURRENCY_SYMBOL[(currency || 'INR').toUpperCase()] ?? `${currency} `;
  return `${sym}${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function cycleLabel(cycle: string) {
  const map: Record<string, string> = {
    monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half Yearly',
    annual: 'Annually', biennial: 'Biennial', triennial: 'Triennial', one_time: 'One-Time',
  };
  return map[cycle] ?? cycle.replace(/_/g, ' ');
}

export function DomainSubscriptionsPanel({
  currentSubId,
  domainId,
  domainName,
}: {
  currentSubId: string;
  domainId: string;
  domainName: string;
}) {
  const router = useRouter();
  const [subs, setSubs] = useState<DomainSub[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([currentSubId]);
  const [isQuoting, setIsQuoting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/subscriptions?domain_id=${encodeURIComponent(domainId)}&limit=50`, {
      credentials: 'include',
    })
      .then(r => r.json())
      .then((data: { subscriptions?: DomainSub[] }) => setSubs(data.subscriptions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [domainId]);

  if (loading || subs.length <= 1) return null;

  const toggleOne = (id: string) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const allSelected = subs.every(s => selectedIds.includes(s.id));
  const someSelected = subs.some(s => selectedIds.includes(s.id));
  const toggleAll = () => setSelectedIds(allSelected ? [] : subs.map(s => s.id));

  const renewableSelected = selectedIds.filter(id => {
    const s = subs.find(x => x.id === id);
    return s && RENEWABLE.has(effStatus(s.lifecycleStatus, s.endDate));
  });

  const handleDirectRenew = async () => {
    if (!renewableSelected.length) return;
    setIsQuoting(true);
    setResult(null);
    try {
      const res = await fetch('/api/subscriptions/combined-renewal-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionIds: renewableSelected }),
      });
      const data = await res.json() as {
        zohoEstimateNumber?: string; totalAmount?: number; lineCount?: number; message?: string;
      };
      if (!res.ok) throw new Error(data.message ?? 'Quote generation failed');
      setResult({
        ok: true,
        msg: `✅ Quote ${data.zohoEstimateNumber} बन गया — ${data.lineCount} line${data.lineCount !== 1 ? 's' : ''} · ₹${Number(data.totalAmount ?? 0).toLocaleString('en-IN')}`,
      });
      router.refresh();
    } catch (err) {
      setResult({ ok: false, msg: `❌ ${err instanceof Error ? err.message : 'Error'}` });
    } finally {
      setIsQuoting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">🌐</span>
          <h2 className="text-sm font-semibold text-slate-700 truncate">{domainName}</h2>
          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full shrink-0">
            {subs.length} subscriptions
          </span>
        </div>
        <button
          onClick={handleDirectRenew}
          disabled={isQuoting || renewableSelected.length === 0}
          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors shrink-0"
        >
          {isQuoting ? 'Generating…' : `⚡ Direct Renew (${renewableSelected.length})`}
        </button>
      </div>

      {/* Result banner */}
      {result && (
        <div className={`mx-5 mt-3 px-4 py-2.5 rounded-lg text-sm ${
          result.ok
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {result.msg}
          <button onClick={() => setResult(null)} className="ml-3 text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Table */}
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-100">
          <tr>
            <th className="px-5 py-2 w-8">
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                onChange={toggleAll}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Sub #</th>
            <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Item</th>
            <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Qty</th>
            <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {subs.map(s => {
            const isCurrent = s.id === currentSubId;
            const eff = effStatus(s.lifecycleStatus, s.endDate);
            const isSelected = selectedIds.includes(s.id);

            return (
              <tr
                key={s.id}
                className={`transition-colors ${
                  isCurrent ? 'bg-blue-50/60' : isSelected ? 'bg-blue-50/20' : 'hover:bg-slate-50'
                }`}
              >
                <td className="px-5 py-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(s.id)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </td>

                {/* Sub # + Status badge */}
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/subscriptions/${s.id}`}
                    className={`text-xs font-mono block ${
                      isCurrent
                        ? 'text-blue-700 font-semibold pointer-events-none'
                        : 'text-slate-500 hover:text-blue-600 hover:underline'
                    }`}
                  >
                    {s.subscriptionNumber}
                  </Link>
                  <div className="flex items-center gap-1 mt-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold leading-none ${STATUS_STYLES[eff] ?? 'bg-slate-100 text-slate-500'}`}>
                      {eff.replace('_', ' ')}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold leading-none">
                        Current
                      </span>
                    )}
                  </div>
                </td>

                {/* Item + date range + cycle */}
                <td className="px-4 py-3">
                  <p className="text-[13px] text-slate-700 truncate max-w-xs" title={s.zohoItemName ?? '—'}>
                    {s.zohoItemName ?? '—'}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {fmt(s.startDate)} → {fmt(s.endDate)}
                    <span className="ml-1 text-slate-300">·</span>
                    <span className="ml-1">{cycleLabel(s.billingCycle)}</span>
                  </p>
                </td>

                {/* Qty */}
                <td className="px-4 py-3 text-right">
                  <span className="text-[13px] text-slate-700 font-medium">{s.quantity}</span>
                </td>

                {/* Rate */}
                <td className="px-4 py-3 text-right">
                  <span className="text-[13px] text-slate-700 font-medium">
                    {money(Number(s.subscriptionPrice), s.currency)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
