import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { TaxSettingsForm } from './_components/tax-settings-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tax & GST Settings — Settings' };

interface SettingRow { key: string; value: string; isSensitive: boolean }
interface Org { id: string; name: string; isActive: boolean }
interface OrgSettings {
  supplierState?: string | null;
  supplierStateCode?: string | null;
  defaultTaxRate?: number | null;
}

interface OrgRow {
  id: string;
  name: string;
  supplierState?: string | null;
  supplierStateCode?: string | null;
  defaultTaxRate?: number | null;
}

export default async function TaxSettingsPage() {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let settings: SettingRow[] = [];
  let orgs: OrgRow[] = [];

  try {
    const [taxData, orgsData] = await Promise.all([
      api.get<{ settings: SettingRow[] }>('/settings/tax'),
      api.get<{ organizations: Org[] }>('/organizations'),
    ]);

    settings = taxData.settings ?? [];

    const activeOrgs = (orgsData.organizations ?? []).filter((o) => o.isActive !== false);

    // Fetch org settings for each org (supplier state)
    const orgSettingsResults = await Promise.allSettled(
      activeOrgs.map((o) => api.get<{ settings: OrgSettings | null }>(`/org-settings/${o.id}`)),
    );

    orgs = activeOrgs.map((org, i) => {
      const result = orgSettingsResults[i];
      const orgSettings = result.status === 'fulfilled' ? (result.value.settings ?? null) : null;
      return {
        id: org.id,
        name: org.name,
        supplierState:     orgSettings?.supplierState     ?? null,
        supplierStateCode: orgSettings?.supplierStateCode ?? null,
        defaultTaxRate:    orgSettings?.defaultTaxRate    ?? null,
      };
    });
  } catch {
    // show form with defaults
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Tax & GST Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Default GST rate, tax mode, और per-org supplier state — intra/inter-state determination के लिए।
        </p>
      </div>

      <TaxSettingsForm settings={settings} orgs={orgs} />
    </div>
  );
}
