import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { BillingHistoryTable } from './_components/billing-history-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Billing History' };

export default async function BillingHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string; type?: string; cycle?: string; quoteStatus?: string; invoiceStatus?: string }>;
}) {
  const sp = await searchParams;
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let items: any[] = [];
  let total = 0;
  const page = Number(sp.page ?? 1);

  try {
    const params = new URLSearchParams();
    if (sp.search) params.set('search', sp.search);
    if (sp.type) params.set('type', sp.type);
    if (sp.cycle) params.set('cycle', sp.cycle);
    if (sp.quoteStatus) params.set('quoteStatus', sp.quoteStatus);
    if (sp.invoiceStatus) params.set('invoiceStatus', sp.invoiceStatus);
    params.set('page', String(page));
    params.set('limit', '25');

    const data = await api.get<{ items: any[]; total: number }>(
      `/subscriptions/billing-history?${params.toString()}`,
    );
    items = data.items ?? [];
    total = data.total ?? 0;
  } catch {
    // empty state
  }

  const thisMonth = items.filter(i => {
    const d = new Date(i.createdAt);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <Link href="/dashboard/subscriptions" className="hover:underline">Subscriptions</Link>
            <span>›</span>
            <span className="text-slate-700 font-medium">Billing History</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">🧾 Dedicated Billing History</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Sabhi Quotes aur Invoices (Single & Bulk) ka ek unified list.
          </p>
        </div>
      </div>

      {/* Search filter */}
      <form method="GET" className="flex flex-wrap items-center gap-2">
        <input
          name="search"
          defaultValue={sp.search}
          placeholder="Search customer, item, or doc..."
          className="w-56 px-3.5 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        
        <select name="type" defaultValue={sp.type} className="w-32 px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All Types</option>
          <option value="Fresh">Fresh</option>
          <option value="Renewal">Renewal</option>
          <option value="Upsell">Upsell</option>
        </select>

        <select name="cycle" defaultValue={sp.cycle} className="w-32 px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All Cycles</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>

        <select name="quoteStatus" defaultValue={sp.quoteStatus} className="w-36 px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">Quote Status</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="accepted">Accepted</option>
          <option value="declined">Declined</option>
          <option value="invoiced">Invoiced</option>
        </select>

        <select name="invoiceStatus" defaultValue={sp.invoiceStatus} className="w-40 px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">Invoice Status</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
        </select>

        <button
          type="submit"
          className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Filter
        </button>
        {(sp.search || sp.type || sp.cycle || sp.quoteStatus || sp.invoiceStatus) && (
          <Link
            href="/dashboard/subscriptions/billing-history"
            className="px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition-colors"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Table */}
      {items.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center">
          <div className="text-4xl mb-3">🧾</div>
          <p className="font-medium text-slate-600">Koi Billing History nahi mili</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <BillingHistoryTable items={items} />

          {/* Pagination */}
          {total > 25 && (
            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-sm text-slate-500">
              <span>
                Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={`?${new URLSearchParams({ ...sp, page: String(page - 1) })}`}
                    className="px-3 py-1.5 border border-slate-200 rounded hover:bg-slate-50"
                  >
                    ← Prev
                  </Link>
                )}
                {page * 25 < total && (
                  <Link
                    href={`?${new URLSearchParams({ ...sp, page: String(page + 1) })}`}
                    className="px-3 py-1.5 border border-slate-200 rounded hover:bg-slate-50"
                  >
                    Next →
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
