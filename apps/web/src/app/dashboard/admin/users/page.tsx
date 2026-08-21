import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { UserOrgPanel } from './_components/user-org-panel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'User Management — Admin' };

interface User {
  id: string;
  name: string | null;
  email: string;
  role: string;
  allowedOrgIds: string[] | null;
  createdAt: string;
}

interface Org { id: string; name: string; isActive: boolean }

export default async function AdminUsersPage() {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let users: User[] = [];
  let orgs: Org[] = [];

  try {
    const [usersData, orgsData] = await Promise.allSettled([
      api.get<User[]>('/users'),
      api.get<{ organizations: Org[] }>('/organizations'),
    ]);
    if (usersData.status === 'fulfilled') users = usersData.value ?? [];
    if (orgsData.status === 'fulfilled')  orgs  = (orgsData.value.organizations ?? []).filter((o) => o.isActive !== false);
  } catch { /* empty */ }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
        <p className="text-sm text-slate-500 mt-1">
          हर user को किस organization का data दिखे — यहाँ से control करो।
          <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">Admin only</span>
        </p>
      </div>

      {orgs.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-700">
          ⚠️ कोई organization connected नहीं।{' '}
          <a href="/dashboard/settings/organizations" className="underline">Organizations setup करो।</a>
        </div>
      )}

      <div className="space-y-4">
        {users.map((user) => (
          <UserOrgPanel key={user.id} user={user} orgs={orgs} />
        ))}
        {users.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-xl px-5 py-8 text-center text-slate-400">
            कोई user नहीं मिला।
          </div>
        )}
      </div>
    </div>
  );
}
