import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE, type OrganizationsListResponse } from '@/lib/api';
import { OrgCard } from './_components/org-card';
import { AddOrgForm } from './_components/add-org-form';
import { FlashBanner } from './_components/flash-banner';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { zoho_connected?: string; zoho_error?: string };
}

export default async function OrganizationsPage({ searchParams }: PageProps) {
  const cookieStore = await cookies();
  const serverApi = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let data: OrganizationsListResponse;
  let fetchError: string | null = null;

  try {
    data = await serverApi.get<OrganizationsListResponse>('/organizations');
  } catch (err) {
    data = { organizations: [] };
    fetchError = err instanceof Error ? err.message : 'Could not reach API';
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Organizations &amp; Zoho Connection</h1>
        <p className="text-sm text-slate-600 mt-1">
          Excel की चारों Zoho Books organizations को यहाँ register और connect करो। हर org का अपना OAuth flow है।
        </p>
      </div>

      <FlashBanner connected={searchParams.zoho_connected} error={searchParams.zoho_error || fetchError || undefined} />

      <section className="space-y-3">
        {data.organizations.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-slate-300 rounded-lg p-8 text-center text-slate-500">
            <div className="text-4xl mb-2">🏢</div>
            <div className="text-base font-medium text-slate-700">No organizations yet</div>
            <div className="text-sm mt-1">First-time setup: add your first Zoho Books org below.</div>
          </div>
        ) : (
          data.organizations.map((org) => <OrgCard key={org.id} org={org} />)
        )}
      </section>

      <AddOrgForm />
    </div>
  );
}
