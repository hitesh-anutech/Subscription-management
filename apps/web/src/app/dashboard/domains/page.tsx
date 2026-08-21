import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { DomainsTable, type Domain } from './_components/domains-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Domain Mapping' };

interface Org {
  id: string;
  name: string;
}

interface DomainStats {
  total: number;
  active: number;
  suspended: number;
  inactive: number;
}

const PAGE_SIZE = 30;

export default async function DomainsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; org_id?: string; status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let domains: Domain[] = [];
  let total = 0;
  let stats: DomainStats = { total: 0, active: 0, suspended: 0, inactive: 0 };
  let orgs: Org[] = [];
  const page = Number(sp.page ?? 1);

  const params = new URLSearchParams();
  if (sp.search)  params.set('search', sp.search);
  if (sp.org_id)  params.set('org_id', sp.org_id);
  if (sp.status)  params.set('status', sp.status);

  const listParams = new URLSearchParams(params);
  listParams.set('page', String(page));
  listParams.set('limit', String(PAGE_SIZE));

  const [domainsRes, orgsRes] = await Promise.allSettled([
    api.get<{ domains: Domain[]; total: number; stats: DomainStats }>(`/domains?${listParams.toString()}`),
    api.get<{ organizations: Org[] }>('/organizations'),
  ]);

  if (domainsRes.status === 'fulfilled') {
    domains = domainsRes.value.domains ?? [];
    total = domainsRes.value.total ?? 0;
    stats = domainsRes.value.stats ?? stats;
  }
  if (orgsRes.status === 'fulfilled') {
    orgs = orgsRes.value.organizations ?? [];
  }

  const hasFilters = Boolean(sp.search || sp.org_id || sp.status);
  const exportHref = `/api/domains/export-csv${params.toString() ? `?${params.toString()}` : ''}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Domain Mapping</h1>
          <p className="text-xs font-semibold text-slate-400 mt-1 bg-slate-100 border border-slate-200/50 inline-block px-2.5 py-1 rounded-lg">
            🌐 Domain ↔ Customer ↔ Org central index
          </p>
        </div>
      </div>

      {/* Filter + actions bar */}
      <form method="GET" className="flex flex-wrap gap-2 bg-white border border-slate-200/80 p-2.5 rounded-2xl shadow-sm">
        <input
          name="search"
          defaultValue={sp.search}
          placeholder="Search domain (e.g. acme.com)…"
          className="flex-1 min-w-48 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-slate-50/50"
        />
        <select
          name="org_id"
          defaultValue={sp.org_id ?? ''}
          className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-blue-500/20 focus:outline-none min-w-[160px]"
        >
          <option value="">All Organizations</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={sp.status ?? ''}
          className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-blue-500/20 focus:outline-none min-w-[140px]"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="inactive">Inactive</option>
        </select>
        <button
          type="submit"
          className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/10 active:scale-[0.98] transition-all"
        >
          Search
        </button>
        {hasFilters && (
          <Link
            href="/dashboard/domains"
            className="px-4 py-2.5 border border-slate-200 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 transition-all"
          >
            Clear
          </Link>
        )}
        <a
          href={exportHref}
          className="px-4 py-2.5 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl bg-white hover:bg-slate-50 transition-all shadow-sm inline-flex items-center gap-1.5"
        >
          📤 Export CSV
        </a>
      </form>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Domains" value={stats.total} className="bg-white border-slate-200" labelClass="text-slate-400" valueClass="text-slate-800" />
        <StatCard label="Active" value={stats.active} className="bg-emerald-50/50 border-emerald-100" labelClass="text-emerald-700" valueClass="text-emerald-700" />
        <StatCard label="Suspended" value={stats.suspended} className="bg-amber-50/50 border-amber-100" labelClass="text-amber-700" valueClass="text-amber-700" />
        <StatCard label="Inactive" value={stats.inactive} className="bg-slate-100/50 border-slate-200" labelClass="text-slate-500" valueClass="text-slate-600" />
      </div>

      {/* Table */}
      <DomainsTable domains={domains} />

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
          <span>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`?${new URLSearchParams({ ...sp, page: String(page - 1) })}`}
                className="px-3.5 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 font-bold transition-all"
              >
                ← Prev
              </Link>
            )}
            {page * PAGE_SIZE < total && (
              <Link
                href={`?${new URLSearchParams({ ...sp, page: String(page + 1) })}`}
                className="px-3.5 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 font-bold transition-all"
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  className,
  labelClass,
  valueClass,
}: {
  label: string;
  value: number;
  className: string;
  labelClass: string;
  valueClass: string;
}) {
  return (
    <div className={`rounded-2xl border p-5 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden ${className}`}>
      <p className={`text-[10px] font-bold uppercase tracking-wider ${labelClass}`}>{label}</p>
      <p className={`text-2xl font-extrabold mt-1 tracking-tight ${valueClass}`}>{value.toLocaleString('en-IN')}</p>
    </div>
  );
}
