import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { SubscriptionsTable } from './_components/subscriptions-table';
import { PageSizeSelector } from './_components/page-size-selector';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Subscriptions' };

interface Subscription {
  id: string;
  subscriptionNumber: string;
  zohoCustomerId: string | null;
  zohoCustomerName: string | null;
  zohoItemName: string | null;
  quantity: string;
  subscriptionPrice: string;
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
  renewalHistory: {
    id: string; quoteNumber: string | null; quoteDate: string | null;
    quantity: string | null; sellingPrice: string | null; subtotalAmount: string | null;
    currency: string; serviceStartDate: string | null; serviceEndDate: string | null;
    businessType: string; renewalStatus: string; zohoEstimateStatus: string | null;
    domain: { domainName: string };
  }[];
}
export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; expiring?: string; billing?: string; search?: string; page?: string; ids?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const isAdmin = user?.role === 'Admin';

  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let subscriptions: Subscription[] = [];
  let total = 0;
  const page = Number(sp.page ?? 1);
  const limit = [25, 50, 100, 200, 500].includes(Number(sp.limit)) ? Number(sp.limit) : 25;

  try {
    const params = new URLSearchParams();
    if (sp.status)   params.set('status', sp.status);
    if (sp.expiring) params.set('expiring_days', sp.expiring);
    if (sp.billing)  params.set('billing_cycle', sp.billing);
    if (sp.search)   params.set('search', sp.search);
    if (sp.ids)      params.set('ids', sp.ids);
    params.set('page', String(page));
    params.set('limit', String(limit));

    const data = await api.get<{ subscriptions: Subscription[]; total: number }>(
      `/subscriptions?${params.toString()}`,
    );
    subscriptions = data.subscriptions ?? [];
    total = data.total ?? 0;
  } catch {
    // empty state
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Subscriptions</h1>
          <p className="text-xs font-semibold text-slate-400 mt-1 bg-slate-100 border border-slate-200/50 inline-block px-2.5 py-1 rounded-lg">
            🔄 {total} total across all orgs
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <Link
            href="/dashboard/subscriptions/renewal-batches"
            className="px-4 py-2.5 border border-purple-200 text-purple-600 text-xs font-bold rounded-xl bg-purple-50/30 hover:bg-purple-50 transition-all shadow-sm"
          >
            📦 Batch History
          </Link>
          {isAdmin && (
            <>
              <Link
                href="/dashboard/subscriptions/import"
                className="px-4 py-2.5 border border-slate-200 text-slate-600 text-xs font-bold rounded-xl bg-white hover:bg-slate-50 transition-all shadow-sm"
              >
                ↓ Import from Zoho
              </Link>
              <Link
                href="/dashboard/subscriptions/import-csv"
                className="px-4 py-2.5 border border-slate-200 text-slate-600 text-xs font-bold rounded-xl bg-white hover:bg-slate-50 transition-all shadow-sm"
              >
                ↥ Import CSV
              </Link>
            </>
          )}
          <Link
            href="/dashboard/subscriptions/new"
            className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/10 active:scale-[0.98] transition-all"
          >
            + New Subscription
          </Link>
        </div>
      </div>

      {/* Filter bar */}
      <form method="GET" className="flex flex-wrap gap-2 bg-white border border-slate-200/80 p-2.5 rounded-2xl shadow-sm">
        <input
          name="search"
          defaultValue={sp.search}
          placeholder="Search customer, domain, item…"
          className="flex-1 min-w-48 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-slate-50/50"
        />
        <select name="status" defaultValue={sp.status ?? ''}
          className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-blue-500/20 focus:outline-none min-w-[140px]">
          <option value="">All Statuses</option>
          <option value="Active">Active</option>
          <option value="Expiring_Soon">Expiring Soon</option>
          <option value="Expired">Expired</option>
          <option value="Pending">Pending</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        <select name="billing" defaultValue={sp.billing ?? ''}
          className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-blue-500/20 focus:outline-none min-w-[140px]">
          <option value="">All Periods</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="half_yearly">Half-Yearly</option>
          <option value="annual">Annual (1 Year)</option>
          <option value="biennial">Biennial (2 Year)</option>
          <option value="triennial">Triennial (3 Year)</option>
          <option value="one_time">One-Time</option>
        </select>
        <select name="expiring" defaultValue={sp.expiring ?? ''}
          className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-blue-500/20 focus:outline-none min-w-[140px]">
          <option value="">Any Expiry</option>
          <option value="7">Expiring in 7 days</option>
          <option value="15">Expiring in 15 days</option>
          <option value="30">Expiring in 30 days</option>
          <option value="60">Expiring in 60 days</option>
        </select>
        {/* preserve current page size when re-filtering */}
        <input type="hidden" name="limit" value={String(limit)} />
        <input type="hidden" name="page" value="1" />
        <button type="submit"
          className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/10 active:scale-[0.98] transition-all">
          Filter
        </button>
        {(sp.status || sp.expiring || sp.billing || sp.search) && (
          <Link href="/dashboard/subscriptions"
            className="px-4 py-2.5 border border-slate-200 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 transition-all">
            Clear
          </Link>
        )}
      </form>

      {/* Batch filter banner */}
      {sp.ids && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 flex items-center justify-between text-xs font-semibold">
          <span className="text-purple-800">
            📦 Renewal batch se filtered — {subscriptions.length} subscription{subscriptions.length !== 1 ? 's' : ''} pre-selected
          </span>
          <Link href="/dashboard/subscriptions" className="text-purple-600 hover:text-purple-800 text-base leading-none font-bold">
            ×
          </Link>
        </div>
      )}

      {/* Table Component */}
      <SubscriptionsTable
        subscriptions={subscriptions}
        initialSelectedIds={sp.ids ? sp.ids.split(',').filter(Boolean) : undefined}
        isAdmin={isAdmin}
      />

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
        <span>
          {total === 0
            ? 'No results'
            : `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}`}
        </span>
        <div className="flex items-center gap-2">
          {page > 1 && (
            <Link
              href={`?${new URLSearchParams({ ...sp, page: String(page - 1), limit: String(limit) })}`}
              className="px-3.5 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 font-bold transition-all"
            >
              ← Prev
            </Link>
          )}
          <PageSizeSelector current={limit} />
          {page * limit < total && (
            <Link
              href={`?${new URLSearchParams({ ...sp, page: String(page + 1), limit: String(limit) })}`}
              className="px-3.5 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 font-bold transition-all"
            >
              Next →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
