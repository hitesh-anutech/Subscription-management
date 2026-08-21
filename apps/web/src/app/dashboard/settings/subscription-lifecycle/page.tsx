import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { SubscriptionLifecycleForm } from './_components/subscription-lifecycle-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Subscription Lifecycle — Settings' };

interface SettingRow { key: string; value: string; isSensitive: boolean }

export default async function SubscriptionLifecyclePage() {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let subSettings: SettingRow[] = [];
  let convSettings: SettingRow[] = [];

  try {
    const [subData, convData] = await Promise.allSettled([
      api.get<{ settings: SettingRow[] }>('/settings/subscription'),
      api.get<{ settings: SettingRow[] }>('/settings/conversion'),
    ]);
    if (subData.status === 'fulfilled')  subSettings  = subData.value.settings  ?? [];
    if (convData.status === 'fulfilled') convSettings = convData.value.settings ?? [];
  } catch {
    // show form with defaults
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Subscription Lifecycle Rules</h1>
        <p className="text-sm text-slate-500 mt-1">
          Renewal reminders, grace period, auto-cancel, और pro-rata calculation rules configure करो।
        </p>
      </div>

      <SubscriptionLifecycleForm
        subSettings={subSettings}
        convSettings={convSettings}
      />
    </div>
  );
}
