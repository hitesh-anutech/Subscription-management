import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { QuickQuoteSettingsForm } from './_components/quick-quote-settings-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quick Quote Settings — Settings' };

interface SettingRow { key: string; value: string; isSensitive: boolean; description?: string | null }

export default async function QuickQuoteSettingsPage() {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let settings: SettingRow[] = [];
  try {
    const data = await api.get<{ settings: SettingRow[] }>('/settings/quick_quote');
    settings = data.settings ?? [];
  } catch {
    // Show form with defaults if API unreachable
  }

  let organizations: any[] = [];
  try {
    const data = await api.get<{ organizations: any[] }>('/organizations');
    organizations = data.organizations ?? [];
  } catch {
    // Show form without orgs if API unreachable
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Quick Quote Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Quote generation के default values — validity, numbering formats, terms, और discount limits।
        </p>
      </div>

      <QuickQuoteSettingsForm settings={settings} organizations={organizations} />
    </div>
  );
}
