'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
const SESSION_COOKIE = 'subs_session';

async function getAuthHeader() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

export async function saveSubscriptionLifecycleAction(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const get = (key: string) => (formData.get(key) as string | null) ?? '';

  // Renewal reminder days come as multiple checkboxes
  const reminderDays = (formData.getAll('reminder_day') as string[])
    .map(Number)
    .filter((d) => !isNaN(d) && d > 0)
    .sort((a, b) => b - a); // descending: 60,30,15,7

  const subscriptionSettings = [
    { key: 'renewal_reminder_days',  value: reminderDays.join(',') },
    { key: 'reminder_recipients',    value: get('reminder_recipients') },
    { key: 'expiry_grace_days',      value: get('expiry_grace_days') },
    { key: 'auto_cancel_after_days', value: get('auto_cancel_after_days') },
    { key: 'auto_renew_default',     value: formData.get('auto_renew_default') === 'on' ? 'true' : 'false' },
    { key: 'prorata_method',         value: get('prorata_method') },
    { key: 'prorata_rounding',       value: get('prorata_rounding') },
  ];

  const conversionSettings = [
    { key: 'auto_convert_on_accept', value: formData.get('auto_convert_on_accept') === 'on' ? 'true' : 'false' },
  ];

  try {
    const [subRes, convRes] = await Promise.all([
      fetch(`${API_BASE}/settings/subscription`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({ settings: subscriptionSettings }),
        cache: 'no-store',
      }),
      fetch(`${API_BASE}/settings/conversion`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({ settings: conversionSettings }),
        cache: 'no-store',
      }),
    ]);

    if (!subRes.ok || !convRes.ok) {
      const failing = !subRes.ok ? subRes : convRes;
      const err = await failing.json() as { error?: { message: string } };
      return { error: err.error?.message ?? 'Save failed' };
    }

    revalidatePath('/dashboard/settings/subscription-lifecycle');
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}
