import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { NotificationSettingsForm } from './_components/notification-settings-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notification Preferences — Settings' };

interface SettingRow { key: string; value: string; isSensitive: boolean }

export default async function NotificationsPage() {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let settings: SettingRow[] = [];
  try {
    const data = await api.get<{ settings: SettingRow[] }>('/settings/notification');
    settings = data.settings ?? [];
  } catch {
    // show defaults
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Notification Preferences</h1>
        <p className="text-sm text-slate-500 mt-1">
          Channels, per-event toggles, और delivery schedule configure करो।
        </p>
      </div>

      <NotificationSettingsForm settings={settings} />
    </div>
  );
}
