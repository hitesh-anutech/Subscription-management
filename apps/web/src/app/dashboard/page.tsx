import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { CreateNewButton } from './_components/create-new-button';
import { AlertsPanel } from './_components/alerts-panel';
import type { ExpiringSubscription } from './_components/alerts-panel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

function daysLeft(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
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
        <CreateNewButton />
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        <Link href="/dashboard/subscriptions?status=Active"
          className="bg-white border border-slate-200/80 rounded-xl px-4 py-3 flex items-center gap-3 hover:border-blue-300 hover:shadow-sm transition-all duration-200 group">
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center text-lg shrink-0 group-hover:scale-110 transition-transform">🔄</div>
          <div className="min-w-0">
            <div className="text-2xl font-extrabold text-blue-600 leading-none">{activeSubsCount}</div>
            <div className="text-xs font-bold text-slate-600 mt-0.5 truncate">Active Subscriptions</div>
          </div>
          <div className="ml-auto text-xs text-slate-400 group-hover:text-blue-500 transition-colors flex items-center gap-0.5 shrink-0">
            <span>View all</span>
            <span className="group-hover:translate-x-0.5 transition-transform inline-block">→</span>
          </div>
        </Link>

        <Link href="/dashboard/quick-quotes?status=Sent"
          className="bg-white border border-slate-200/80 rounded-xl px-4 py-3 flex items-center gap-3 hover:border-amber-300 hover:shadow-sm transition-all duration-200 group">
          <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center text-lg shrink-0 group-hover:scale-110 transition-transform">📄</div>
          <div className="min-w-0">
            <div className="text-2xl font-extrabold text-amber-600 leading-none">{openQuotesCount}</div>
            <div className="text-xs font-bold text-slate-600 mt-0.5 truncate">Quotes Awaiting Response</div>
          </div>
          <div className="ml-auto text-xs text-slate-400 group-hover:text-amber-500 transition-colors flex items-center gap-0.5 shrink-0">
            <span>View all</span>
            <span className="group-hover:translate-x-0.5 transition-transform inline-block">→</span>
          </div>
        </Link>

        <Link href="/dashboard/leads?status=New"
          className="bg-white border border-slate-200/80 rounded-xl px-4 py-3 flex items-center gap-3 hover:border-emerald-300 hover:shadow-sm transition-all duration-200 group">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center text-lg shrink-0 group-hover:scale-110 transition-transform">🎯</div>
          <div className="min-w-0">
            <div className="text-2xl font-extrabold text-emerald-600 leading-none">{activeLeadsCount}</div>
            <div className="text-xs font-bold text-slate-600 mt-0.5 truncate">New Leads</div>
          </div>
          <div className="ml-auto text-xs text-slate-400 group-hover:text-emerald-500 transition-colors flex items-center gap-0.5 shrink-0">
            <span>View all</span>
            <span className="group-hover:translate-x-0.5 transition-transform inline-block">→</span>
          </div>
        </Link>
      </div>

      {/* ── Subscription Expiry Alerts ── */}
      {(expiringIn30.length > 0 || expiredSubs.length > 0) && (
        <AlertsPanel
          expiringIn30={expiringIn30}
          expiredSubs={expiredSubs}
          urgentCount={urgentCount}
        />
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
