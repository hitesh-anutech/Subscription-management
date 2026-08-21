import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { BatchReviewTable, type RenewalBatch } from './_components/batch-review-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Renewal Batches' };

export default async function RenewalBatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string; ids?: string }>;
}) {
  const sp = await searchParams;
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let batches: RenewalBatch[] = [];
  let total = 0;
  const page = Number(sp.page ?? 1);
  const justCreated = Boolean(sp.ids);

  try {
    const params = new URLSearchParams();
    if (sp.search) params.set('search', sp.search);
    if (sp.ids) params.set('ids', sp.ids);
    params.set('page', String(page));
    params.set('limit', '25');

    const data = await api.get<{ batches: RenewalBatch[]; total: number }>(
      `/subscriptions/renewal-batches?${params.toString()}`,
    );
    batches = data.batches ?? [];
    total = data.total ?? 0;
  } catch {
    // empty state
  }

  const thisMonth = batches.filter(b => {
    const d = new Date(b.createdAt);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const annexureCount = batches.filter(b => b.hasAnnexure).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <Link href="/dashboard/subscriptions" className="hover:underline">Subscriptions</Link>
            <span>›</span>
            <span className="text-slate-700 font-medium">Renewal Batches</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">📦 Renewal Batches History</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Har batch = ek "Generate Bulk Quotes" run mein bana ek group
          </p>
        </div>
        <Link
          href="/dashboard/subscriptions"
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg"
        >
          + Generate New Bulk Renewal →
        </Link>
      </div>

      {/* Just-created banner (after Generate Bulk Quotes) */}
      {justCreated && (
        <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          <p className="text-sm text-emerald-800">
            ✅ <span className="font-semibold">{batches.length} quote{batches.length === 1 ? '' : 's'} banaye gaye</span> — ab neeche se review karke customer ko bhejein (Send Selected / Send All), ya status refresh karein.
          </p>
          <Link href="/dashboard/subscriptions/renewal-batches" className="text-xs text-emerald-700 hover:underline whitespace-nowrap">
            Show all batches
          </Link>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Total Batches</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{total}</div>
          <div className="text-xs text-slate-400 mt-1">all time</div>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
          <div className="text-xs text-purple-600">Shown (this page)</div>
          <div className="text-2xl font-bold text-purple-700 mt-1">{batches.length}</div>
          <div className="text-xs text-purple-400 mt-1">of {total} total</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="text-xs text-blue-600">This Month</div>
          <div className="text-2xl font-bold text-blue-700 mt-1">{thisMonth}</div>
          <div className="text-xs text-blue-400 mt-1">batches</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="text-xs text-amber-600">With Annexure PDF</div>
          <div className="text-2xl font-bold text-amber-700 mt-1">{annexureCount}</div>
          <div className="text-xs text-amber-400 mt-1">≥100 domain batches</div>
        </div>
      </div>

      {/* Search filter */}
      <form method="GET" className="flex gap-2">
        <input
          name="search"
          defaultValue={sp.search}
          placeholder="Search customer, item, estimate number, or domain…"
          className="flex-1 min-w-48 px-3.5 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
        >
          Search
        </button>
        {sp.search && (
          <a
            href="/dashboard/subscriptions/renewal-batches"
            className="px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50"
          >
            Clear
          </a>
        )}
      </form>

      {/* Table */}
      {batches.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center">
          <div className="text-4xl mb-3">📦</div>
          <p className="font-medium text-slate-600">Abhi tak koi Renewal Batch nahi bani</p>
          <p className="text-sm text-slate-400 mt-1 mb-4">
            Subscriptions page par jaayein → subscriptions select karein → "Generate Bulk Quotes" dabaayein
          </p>
          <Link
            href="/dashboard/subscriptions"
            className="px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700"
          >
            Subscriptions par jaayein →
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <BatchReviewTable batches={batches} />

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
