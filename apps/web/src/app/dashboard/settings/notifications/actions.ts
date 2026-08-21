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

// Checkbox keys — present in FormData when checked, absent when unchecked
const CHECKBOX_KEYS = [
  'channel_inapp_enabled',
  'channel_email_enabled',
  'evt_quote_sent',
  'evt_quote_viewed',
  'evt_quote_accepted',
  'evt_quote_rejected',
  'evt_renewal_reminder',
  'evt_conversion_completed',
  'evt_conversion_failed',
  'evt_oauth_token_expiring',
  'evt_webhook_failure',
] as const;

export async function saveNotificationSettingsAction(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const get = (key: string) => (formData.get(key) as string | null) ?? '';

  const settings = [
    // Channels
    ...CHECKBOX_KEYS.map((key) => ({
      key,
      value: formData.get(key) === 'on' ? 'true' : 'false',
    })),
    // Text/select fields
    { key: 'digest_mode',        value: get('digest_mode') },
    { key: 'quiet_hours_start',  value: get('quiet_hours_start') },
    { key: 'quiet_hours_end',    value: get('quiet_hours_end') },
  ];

  try {
    const res = await fetch(`${API_BASE}/settings/notification`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify({ settings }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const err = await res.json() as { error?: { message: string } };
      return { error: err.error?.message ?? 'Save failed' };
    }

    revalidatePath('/dashboard/settings/notifications');
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}
