import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { OrgFilterDropdown } from './_components/org-filter-dropdown';
import { getCurrentUser } from '@/lib/auth';
import { QuotesTable } from './_components/quotes-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quick Quotes' };

interface Quote {
  id: string;
  quoteNumber: string;
  customerType: string;
  status: string;
  totalAmount: string;
  quoteDate: string;
  expiryDate: string;
  lead: { id: string; companyName: string; email: string } | null;
  zohoCustomerName: string | null;
  targetOrganization: { name: string };
  _count: { items: number };
}

const statusColors: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-600',
  Sent: 'bg-blue-100 text-blue-700',
  Viewed: 'bg-purple-100 text-purple-700',
  Accepted: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  Expired: 'bg-orange-100 text-orange-700',
  Pushed_To_Zoho: 'bg-teal-100 text-teal-700',
  Cancelled: 'bg-slate-100 text-slate-400',
};

const STATUS_DISPLAY: Record<string, string> = {
  Pushed_To_Zoho: 'Pushed to Zoho',
};

function formatStatus(s: string) {
  return STATUS_DISPLAY[s] ?? s.replace(/_/g, ' ');
}

interface Org { id: string; name: string }

export default async function QuickQuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; org_id?: string; page?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const isAdmin = user?.role === 'Admin';

  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let quotes: Quote[] = [];
  let total = 0;
  let orgs: Org[] = [];

  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.org_id) query.set('org_id', params.org_id);
  if (params.page)   query.set('page', params.page);
  query.set('limit', '20');

  try {
    const [quotesData, orgsData] = await Promise.allSettled([
      api.get<{ quotes: Quote[]; total: number }>(`/quick-quotes?${query}`),
      api.get<{ organizations: Org[] }>('/organizations'),
    ]);
    if (quotesData.status === 'fulfilled') { quotes = quotesData.value.quotes; total = quotesData.value.total; }
    if (orgsData.status === 'fulfilled')   orgs = (orgsData.value.organizations ?? []).filter((o: Org & { isActive?: boolean }) => o.isActive !== false);
  } catch {
    // show empty
  }

  const statuses = ['Draft', 'Sent', 'Viewed', 'Accepted', 'Rejected', 'Expired', 'Pushed_To_Zoho'];

  const tabItems = [
    { key: '', label: 'All Quotes' },
    ...statuses.map((s) => ({ key: s, label: formatStatus(s) })),
  ];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Quick Quotes</h1>
          <p className="text-xs font-semibold text-slate-400 mt-1 bg-slate-100 border border-slate-200/50 inline-block px-2.5 py-1 rounded-lg">
            📄 {total} total {total === 1 ? 'quote' : 'quotes'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {orgs.length > 0 && (
            <OrgFilterDropdown orgs={orgs} selectedOrgId={params.org_id} currentStatus={params.status} />
          )}
          <Link
            href="/dashboard/quick-quotes/new"
            className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/10 active:scale-[0.98] transition-all"
          >
            + New Quote
          </Link>
        </div>
      </div>

      {/* Modern Capsule Status Tab Bar */}
      <div className="bg-slate-100/60 border border-slate-200/40 p-1.5 rounded-2xl flex gap-1 overflow-x-auto max-w-full sm:max-w-max scrollbar-none">
        {tabItems.map(({ key, label }) => {
          const isActive = key === '' ? !params.status : params.status === key;
          const qs = new URLSearchParams();
          if (key) qs.set('status', key);
          if (params.org_id) qs.set('org_id', params.org_id);
          const href = `/dashboard/quick-quotes${qs.toString() ? `?${qs}` : ''}`;
          return (
            <Link
              key={key || 'all'}
              href={href as never}
              className={`px-4 py-2 text-xs font-bold whitespace-nowrap rounded-xl transition-all duration-200 ${
                isActive
                  ? 'bg-white text-blue-700 shadow-sm border border-slate-200/10'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50/50'
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {/* Table */}
      {quotes.length === 0 ? (
        <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center text-4xl mx-auto mb-4 animate-pulse">
              📄
            </div>
            <h3 className="text-lg font-bold text-slate-800">
              {params.status ? `No ${formatStatus(params.status)} quotes` : 'No quotes yet'}
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto mb-6 leading-relaxed">
              नया quote बनाएँ — existing customer या new lead के लिए।
            </p>
            <Link href="/dashboard/quick-quotes/new" className="px-5 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/10 hover:from-blue-500 hover:to-indigo-500 transition-all">
              + पहला Quote बनाओ
            </Link>
          </div>
        </div>
      ) : (
        <QuotesTable quotes={quotes} isAdmin={isAdmin} />
      )}
    </div>
  );
}
