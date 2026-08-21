import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

interface ExpiringSubscription {
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

/** Group subscriptions by customer, preserving the incoming order (soonest expiry first). */
function groupByCustomer(subs: ExpiringSubscription[]) {
  const map = new Map<string, ExpiringSubscription[]>();
  for (const s of subs) {
    const key = s.zohoCustomerName ?? '—';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return Array.from(map.entries()).map(([customer, items]) => ({ customer, items }));
}

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  // Parallel data fetches
  let activeSubsCount = 0;
  let openQuotesCount = 0;
  let activeLeadsCount = 0;
  let expiringIn30: ExpiringSubscription[] = [];
  let expiredSubs: ExpiringSubscription[] = [];

  try {
    const [subStats, openQStats, leadStats, expiring30Data, expiredData] = await Promise.allSettled([
      api.get<{ total: number }>('/subscriptions?status=Active&limit=1'),
      api.get<{ total: number }>('/quick-quotes?status=Sent&limit=1'),
      api.get<{ total: number }>('/leads?status=New&limit=1'),
      api.get<{ subscriptions: ExpiringSubscription[] }>('/subscriptions?expiring_days=30&limit=10'),
      api.get<{ subscriptions: ExpiringSubscription[] }>('/subscriptions?status=Expired&limit=5'),
    ]);

    if (subStats.status === 'fulfilled')    activeSubsCount  = subStats.value.total   ?? 0;
    if (openQStats.status === 'fulfilled')  openQuotesCount  = openQStats.value.total  ?? 0;
    if (leadStats.status === 'fulfilled')   activeLeadsCount = leadStats.value.total   ?? 0;
    if (expiring30Data.status === 'fulfilled') expiringIn30 = expiring30Data.value.subscriptions ?? [];
    if (expiredData.status === 'fulfilled')    expiredSubs  = expiredData.value.subscriptions   ?? [];
  } catch { /* show zeroes */ }

  const urgentCount = expiringIn30.filter((s) => daysLeft(s.endDate) <= 7).length + expiredSubs.length;

  return (
    <div className="max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Dashboard</h1>
          <p className="text-xs text-slate-500 font-semibold mt-1 bg-slate-100 border border-slate-200/50 inline-block px-2.5 py-1 rounded-lg">
            📅 {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/dashboard/leads/new"
            className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/10 active:scale-[0.98] transition-all">
            + New Lead
          </Link>
          <Link href="/dashboard/quick-quotes/new"
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all">
            + New Quote
          </Link>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-5">
        <Link href="/dashboard/subscriptions?status=Active"
          className="bg-white border border-slate-200/80 rounded-2xl p-6 hover:-translate-y-1 hover:shadow-md hover:border-blue-300 transition-all duration-300 group relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full -mr-8 -mt-8" />
          <div className="flex items-center justify-between mb-4">
            <span className="text-4xl font-extrabold text-blue-600">{activeSubsCount}</span>
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform">
              🔄
            </div>
          </div>
          <div className="text-sm font-bold text-slate-700">Active Subscriptions</div>
          <div className="text-xs text-slate-400 mt-2 flex items-center gap-1 group-hover:text-blue-500 transition-colors">
            <span>View all</span>
            <span className="group-hover:translate-x-1 transition-transform">→</span>
          </div>
        </Link>
        
        <Link href="/dashboard/quick-quotes?status=Sent"
          className="bg-white border border-slate-200/80 rounded-2xl p-6 hover:-translate-y-1 hover:shadow-md hover:border-amber-300 transition-all duration-300 group relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full -mr-8 -mt-8" />
          <div className="flex items-center justify-between mb-4">
            <span className="text-4xl font-extrabold text-amber-600">{openQuotesCount}</span>
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 group-hover:scale-110 transition-transform">
              📄
            </div>
          </div>
          <div className="text-sm font-bold text-slate-700">Quotes Awaiting Response</div>
          <div className="text-xs text-slate-400 mt-2 flex items-center gap-1 group-hover:text-amber-500 transition-colors">
            <span>View all</span>
            <span className="group-hover:translate-x-1 transition-transform">→</span>
          </div>
        </Link>

        <Link href="/dashboard/leads?status=New"
          className="bg-white border border-slate-200/80 rounded-2xl p-6 hover:-translate-y-1 hover:shadow-md hover:border-emerald-300 transition-all duration-300 group relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full -mr-8 -mt-8" />
          <div className="flex items-center justify-between mb-4">
            <span className="text-4xl font-extrabold text-emerald-600">{activeLeadsCount}</span>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 group-hover:scale-110 transition-transform">
              🎯
            </div>
          </div>
          <div className="text-sm font-bold text-slate-700">New Leads</div>
          <div className="text-xs text-slate-400 mt-2 flex items-center gap-1 group-hover:text-emerald-500 transition-colors">
            <span>View all</span>
            <span className="group-hover:translate-x-1 transition-transform">→</span>
          </div>
        </Link>
      </div>

      {/* ── Subscription Expiry Alerts ── */}
      {(expiringIn30.length > 0 || expiredSubs.length > 0) && (
        <div className="space-y-4">
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

          {/* Expired */}
          {expiredSubs.length > 0 && (
            <div className="bg-red-50/50 border border-red-200/60 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-red-200/50 bg-red-100/60 text-red-800 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <span>❌</span> Expired ({expiredSubs.length})
              </div>
              <div className="divide-y divide-red-100/60">
                {groupByCustomer(expiredSubs).map((g) => (
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
                        <Link key={s.id} href={`/dashboard/subscriptions/${s.id}`}
                          className="flex items-center justify-between gap-4 -mx-3 px-3 py-2 rounded-xl hover:bg-red-100/40 border border-transparent hover:border-red-200/30 transition-all">
                          <p className="text-xs text-slate-500 font-medium truncate">{s.domain.domainName} · {s.zohoItemName} · {s.organization.name}</p>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-bold text-red-600">Expired {fmt(s.endDate)}</p>
                            <p className="text-[10px] text-red-500 font-medium">{Math.abs(daysLeft(s.endDate))} days ago</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Expiring soon */}
          {expiringIn30.length > 0 && (
            <div className="bg-white border border-amber-200/60 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-amber-200/50 bg-amber-50/60 text-amber-800 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <span>⏳</span> Expiring in 30 Days ({expiringIn30.length})
              </div>
              <div className="divide-y divide-slate-100/60">
                {groupByCustomer(expiringIn30).map((g) => (
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
                        return (
                          <Link key={s.id} href={`/dashboard/subscriptions/${s.id}`}
                            className="flex items-center justify-between gap-4 -mx-3 px-3 py-2 rounded-xl hover:bg-amber-50/40 border border-transparent hover:border-amber-200/30 transition-all">
                            <p className="text-xs text-slate-500 font-medium truncate">{s.domain.domainName} · {s.zohoItemName} · {s.organization.name}</p>
                            <div className="text-right shrink-0">
                              <p className={`text-xs font-bold ${d <= 7 ? 'text-red-600' : 'text-amber-600'}`}>
                                {fmt(s.endDate)}
                              </p>
                              <p className={`text-[10px] ${d <= 7 ? 'text-red-500 font-bold' : 'text-slate-400 font-semibold'}`}>
                                {d === 0 ? 'Today!' : d === 1 ? 'Tomorrow!' : `${d} days left`}
                              </p>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* No expiry alerts state */}
      {expiringIn30.length === 0 && expiredSubs.length === 0 && activeSubsCount > 0 && (
        <div className="bg-gradient-to-r from-emerald-50 to-green-50/50 border border-emerald-200/60 rounded-2xl px-6 py-4.5 text-sm text-emerald-800 flex items-center gap-3.5 shadow-sm">
          <span className="text-xl bg-emerald-100 w-8 h-8 rounded-lg flex items-center justify-center shrink-0">✅</span>
          <span className="font-semibold">सभी active subscriptions अगले 30 दिनों में expire नहीं होंगी। Great work!</span>
        </div>
      )}

      {/* Quick links */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-1">Quick Navigation</h3>
        <div className="grid grid-cols-4 gap-4">
          {[
            { href: '/dashboard/leads/new',         icon: '🎯', label: 'New Lead' },
            { href: '/dashboard/quick-quotes/new',  icon: '📄', label: 'New Quote' },
            { href: '/dashboard/subscriptions',     icon: '🔄', label: 'Subscriptions' },
            { href: '/dashboard/settings/organizations', icon: '⚙️', label: 'Settings' },
          ].map((item) => (
            <Link key={item.href} href={item.href as never}
              className="bg-white border border-slate-200/80 rounded-2xl p-5 text-center hover:-translate-y-1 hover:shadow-md hover:border-slate-300 transition-all duration-300 group">
              <div className="text-3xl mb-2 group-hover:scale-110 transition-transform">{item.icon}</div>
              <div className="text-xs font-extrabold text-slate-700 group-hover:text-blue-600 transition-colors">{item.label}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
