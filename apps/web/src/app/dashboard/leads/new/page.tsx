import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { LeadForm } from '../_components/lead-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New Lead' };

interface Org { id: string; name: string; isActive: boolean }

export default async function NewLeadPage() {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let orgs: Org[] = [];
  try {
    const data = await api.get<{ organizations: Org[] }>('/organizations');
    orgs = (data.organizations ?? []).filter((o) => o.isActive !== false);
  } catch { /* show empty org list */ }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">New Lead</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Prospect को यहाँ add करो — Zoho में तभी जाएगा जब deal close हो।
        </p>
      </div>
      <LeadForm orgs={orgs} />
    </div>
  );
}
