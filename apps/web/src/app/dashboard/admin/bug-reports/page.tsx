import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { Bug } from 'lucide-react';
import { BugReportsTable } from './_components/bug-reports-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bug Reports — Admin' };

export default async function BugReportsPage() {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let reports: unknown[] = [];
  try {
    reports = await api.get<unknown[]>('/bug-reports') ?? [];
  } catch { /* empty */ }

  const counts = {
    total:    reports.length,
    open:     reports.filter((r: any) => r.status === 'Open').length,
    critical: reports.filter((r: any) => r.severity === 'Critical').length,
    resolved: reports.filter((r: any) => r.status === 'Resolved' || r.status === 'Closed').length,
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Bug size={22} className="text-orange-500" />
            Bug Reports
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            User-submitted bugs, feature ideas, and UI polish requests.
            <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">Admin only</span>
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total',    value: counts.total,    color: 'text-slate-700' },
          { label: 'Open',     value: counts.open,     color: 'text-yellow-600' },
          { label: 'Critical', value: counts.critical, color: 'text-red-600' },
          { label: 'Resolved', value: counts.resolved, color: 'text-green-600' },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-center shadow-sm">
            <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
            <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <BugReportsTable initial={reports as any} />
    </div>
  );
}
