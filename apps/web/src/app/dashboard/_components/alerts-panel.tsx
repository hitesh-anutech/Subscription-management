'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';

export interface ExpiringSubscription {
  id: string;
  subscriptionNumber: string;
  zohoCustomerName: string | null;
  zohoItemName: string | null;
  endDate: string;
  lifecycleStatus: string;
  domain: { domainName: string };
  organization: { name: string };
}

function daysLeft(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function groupByCustomer(subs: ExpiringSubscription[]) {
  const map = new Map<string, ExpiringSubscription[]>();
  for (const s of subs) {
    const key = s.zohoCustomerName ?? '—';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return Array.from(map.entries()).map(([customer, items]) => ({ customer, items }));
}

type SectionFilter = 'all' | 'expired' | '7d' | '30d';

export function AlertsPanel({
  expiringIn30,
  expiredSubs,
  urgentCount,
}: {
  expiringIn30: ExpiringSubscription[];
  expiredSubs: ExpiringSubscription[];
  urgentCount: number;
}) {
  const [section, setSection] = useState<SectionFilter>('all');
  const [provider, setProvider] = useState('all');

  const providers = useMemo(() => {
    const names = [...expiringIn30, ...expiredSubs].map((s) => s.organization.name);
    return Array.from(new Set(names)).sort();
  }, [expiringIn30, expiredSubs]);

  const urgentExpiringCount = useMemo(
    () => expiringIn30.filter((s) => daysLeft(s.endDate) <= 7).length,
    [expiringIn30],
  );

  const filteredExpired = useMemo(() => {
    if (section !== 'all' && section !== 'expired') return [];
    return expiredSubs.filter((s) => provider === 'all' || s.organization.name === provider);
  }, [expiredSubs, section, provider]);

  const filteredExpiring = useMemo(() => {
    if (section === 'expired') return [];
    return expiringIn30.filter((s) => {
      if (section === '7d' && daysLeft(s.endDate) > 7) return false;
      if (provider !== 'all' && s.organization.name !== provider) return false;
      return true;
    });
  }, [expiringIn30, section, provider]);

  const TABS: { key: SectionFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'expired', label: `Expired (${expiredSubs.length})` },
    { key: '7d', label: `Urgent (${urgentExpiringCount})` },
    { key: '30d', label: '30 days' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <span>⚠️</span> Subscription Alerts
          {urgentCount > 0 && (
            <span className="px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-extrabold uppercase tracking-wider animate-pulse">
              {urgentCount} urgent
            </span>
          )}
        </h2>
        <Link href="/dashboard/subscriptions?expiring=30" className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline">
          All expiring →
        </Link>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSection(tab.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                section === tab.key
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {providers.length > 1 && (
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 hover:border-slate-300 transition-colors"
          >
            <option value="all">All Providers</option>
            {providers.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}
      </div>

      {filteredExpired.length === 0 && filteredExpiring.length === 0 && (
        <p className="text-xs text-slate-400 text-center py-4">No alerts match the selected filter.</p>
      )}

      {/* Expired */}
      {filteredExpired.length > 0 && (
        <div className="bg-red-50/50 border border-red-200/60 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-red-200/50 bg-red-100/60 text-red-800 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
            <span>❌</span> Expired ({filteredExpired.length})
          </div>
          <div className="divide-y divide-red-100/60">
            {groupByCustomer(filteredExpired).map((g) => (
              <div key={g.customer} className="px-5 py-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <p className="text-sm font-bold text-slate-800">{g.customer}</p>
                  {g.items.length > 1 && (
                    <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[9px] font-extrabold uppercase tracking-wide">
                      {g.items.length} subscriptions
                    </span>
                  )}
                </div>
                <div className="space-y-1.5">
                  {g.items.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-3 -mx-3 px-3 py-2.5 rounded-xl hover:bg-red-100/40 border border-transparent hover:border-red-200/30 transition-all group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 text-[9px] font-extrabold uppercase tracking-wide">
                          Expired
                        </span>
                        <p className="text-xs truncate">
                          <span className="font-semibold text-slate-700">{s.domain.domainName}</span>
                          <span className="text-slate-400"> · {s.zohoItemName} · {s.organization.name}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right hidden sm:block">
                          <p className="text-xs font-bold text-red-600">Expired {fmt(s.endDate)}</p>
                          <p className="text-[10px] text-red-500 font-medium">{Math.abs(daysLeft(s.endDate))} days ago</p>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Link
                            href={`/dashboard/subscriptions/${s.id}`}
                            className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-[10px] font-bold hover:bg-blue-700 transition-colors whitespace-nowrap"
                          >
                            Renew →
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expiring soon */}
      {filteredExpiring.length > 0 && (
        <div className="bg-white border border-amber-200/60 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-amber-200/50 bg-amber-50/60 text-amber-800 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
            <span>⏳</span> Expiring in 30 Days ({filteredExpiring.length})
          </div>
          <div className="divide-y divide-slate-100/60">
            {groupByCustomer(filteredExpiring).map((g) => (
              <div key={g.customer} className="px-5 py-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <p className="text-sm font-bold text-slate-800">{g.customer}</p>
                  {g.items.length > 1 && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-extrabold uppercase tracking-wide">
                      {g.items.length} subscriptions
                    </span>
                  )}
                </div>
                <div className="space-y-1.5">
                  {g.items.map((s) => {
                    const d = daysLeft(s.endDate);
                    const urgent = d <= 7;
                    return (
                      <div
                        key={s.id}
                        className={`flex items-center justify-between gap-3 -mx-3 px-3 py-2.5 rounded-xl border border-transparent transition-all group ${
                          urgent
                            ? 'hover:bg-red-50/60 hover:border-red-200/30'
                            : 'hover:bg-amber-50/40 hover:border-amber-200/30'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wide ${
                              urgent ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {d === 0 ? 'Today' : d === 1 ? 'Tmrw' : `${d}d`}
                          </span>
                          <p className="text-xs truncate">
                            <span className="font-semibold text-slate-700">{s.domain.domainName}</span>
                            <span className="text-slate-400"> · {s.zohoItemName} · {s.organization.name}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right hidden sm:block">
                            <p className={`text-xs font-bold ${urgent ? 'text-red-600' : 'text-amber-600'}`}>
                              {fmt(s.endDate)}
                            </p>
                            <p className={`text-[10px] font-medium ${urgent ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                              {d === 0 ? 'Today!' : d === 1 ? 'Tomorrow!' : `${d} days left`}
                            </p>
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Link
                              href={`/dashboard/subscriptions/${s.id}`}
                              className={`px-2.5 py-1 rounded-lg text-white text-[10px] font-bold transition-colors whitespace-nowrap ${
                                urgent ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600'
                              }`}
                            >
                              Renew →
                            </Link>
                            <Link
                              href={`/dashboard/subscriptions/${s.id}`}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-bold hover:bg-slate-200 transition-colors whitespace-nowrap"
                            >
                              Details
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
