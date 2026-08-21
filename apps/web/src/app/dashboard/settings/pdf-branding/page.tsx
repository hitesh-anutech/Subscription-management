import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { BrandingForm } from './_components/branding-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PDF Branding — Settings' };

interface Org { id: string; name: string; isActive: boolean }
interface OrgSettings { [key: string]: unknown }

interface PageProps {
  searchParams: Promise<{ org?: string }>;
}

export default async function PdfBrandingPage({ searchParams }: PageProps) {
  const { org: orgIdParam } = await searchParams;

  const cookieStore = await cookies();
  const serverApi = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let orgs: Org[] = [];
  try {
    const data = await serverApi.get<{ organizations: Org[] }>('/organizations');
    orgs = (data.organizations ?? []).filter((o) => o.isActive);
  } catch {
    // handled below
  }

  if (orgs.length === 0) {
    return (
      <div className="space-y-4 max-w-2xl">
        <h1 className="text-2xl font-bold text-slate-900">PDF Branding</h1>
        <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
          पहले Settings → Organizations में कम से कम एक organization add करो।
        </div>
      </div>
    );
  }

  const selectedOrgId = orgIdParam && orgs.find((o) => o.id === orgIdParam)
    ? orgIdParam
    : orgs[0].id;

  if (!orgIdParam) {
    redirect(`/dashboard/settings/pdf-branding?org=${selectedOrgId}`);
  }

  const selectedOrg = orgs.find((o) => o.id === selectedOrgId)!;

  let settings: OrgSettings | null = null;
  try {
    const data = await serverApi.get<{ settings: OrgSettings | null }>(`/org-settings/${selectedOrgId}`);
    settings = data.settings;
  } catch {
    // No settings yet — form will show empty
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">PDF Branding</h1>
          <p className="text-sm text-slate-500 mt-1">
            हर organization का अलग PDF look-and-feel configure करो।
          </p>
        </div>
      </div>

      {/* Org selector */}
      {orgs.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {orgs.map((org) => (
            <a
              key={org.id}
              href={`/dashboard/settings/pdf-branding?org=${org.id}`}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                org.id === selectedOrgId
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {org.name}
            </a>
          ))}
        </div>
      )}

      <BrandingForm
        orgId={selectedOrgId}
        orgName={selectedOrg.name}
        settings={settings as Parameters<typeof BrandingForm>[0]['settings']}
      />
    </div>
  );
}
