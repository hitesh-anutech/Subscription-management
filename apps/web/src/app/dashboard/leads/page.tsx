import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { LeadStatusBadge } from './_components/lead-status-badge';
import { FilePlus } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { LeadsTable } from './_components/leads-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leads' };

interface Lead {
  id: string;
  leadNumber: string;
  companyName: string;
  contactName: string | null;
  email: string;
  phone: string | null;
  status: string;
  primaryDomain: string | null;
  estimatedValue: string | null;
  createdAt: string;
  _count: { quickQuotes: number };
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; page?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const isAdmin = user?.role === 'Admin';

  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let leads: Lead[] = [];
  let total = 0;

  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.search) query.set('search', params.search);
  if (params.page) query.set('page', params.page);
  query.set('limit', '20');

  try {
    const data = await api.get<{ leads: Lead[]; total: number }>(`/leads?${query}`);
    leads = data.leads;
    total = data.total;
  } catch {
    // show empty
  }

  const statuses = ['New', 'Contacted', 'Quoted', 'Negotiating', 'Won', 'Lost'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Leads</h1>
          <p className="text-xs font-semibold text-slate-400 mt-1 bg-slate-100 border border-slate-200/50 inline-block px-2.5 py-1 rounded-lg">
            🎯 {total} total leads
          </p>
        </div>
        <Link
          href="/dashboard/leads/new"
          className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/10 active:scale-[0.98] transition-all"
        >
          + New Lead
        </Link>
      </div>

      {/* Filters (Modern Pill-Shape design) */}
      <div className="flex gap-2 flex-wrap bg-white/50 border border-slate-200/50 p-2.5 rounded-2xl max-w-max">
        <Link
          href="/dashboard/leads"
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ${!params.status ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/10' : 'bg-white/80 hover:bg-slate-100 text-slate-600 border border-slate-200/60'}`}
        >
          All Leads
        </Link>
        {statuses.map((s) => (
          <Link
            key={s}
            href={`/dashboard/leads?status=${s}`}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ${params.status === s ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/10' : 'bg-white/80 hover:bg-slate-100 text-slate-600 border border-slate-200/60'}`}
          >
            {s}
          </Link>
        ))}
      </div>

      {/* Table / Empty State */}
      {leads.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-12 text-center shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center text-4xl mx-auto mb-4 animate-bounce">
            🎯
          </div>
          <h3 className="text-lg font-bold text-slate-800">No leads found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto mb-6 leading-relaxed">
            Prospects यहाँ track होंगे — Zoho में push तभी होंगे जब deal close/convert की जाए।
          </p>
          <Link href="/dashboard/leads/new" className="px-5 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/10 hover:from-blue-500 hover:to-indigo-500 transition-all">
            + पहला Lead add करो
          </Link>
        </div>
      ) : (
        <LeadsTable leads={leads} isAdmin={isAdmin} />
      )}
    </div>
  );
}
