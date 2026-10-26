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

export async function saveGoogleCredentialsAction(formData: FormData, slot: 1 | 2 = 1) {
  const suffix = slot === 1 ? '' : '_2';
  const clientId = formData.get('client_id') as string;
  const clientSecret = formData.get('client_secret') as string;
  const resellerEmail = formData.get('reseller_email') as string;
  const resellerName = formData.get('reseller_name') as string;

  const settings: Array<{ key: string; value: string; sensitive: boolean; description: string }> = [];

  if (clientId && !clientId.includes('•')) {
    settings.push({ key: `client_id${suffix}`, value: clientId, sensitive: false, description: `Google OAuth Client ID (Reseller ${slot})` });
  }
  if (clientSecret && !clientSecret.includes('•')) {
    settings.push({ key: `client_secret${suffix}`, value: clientSecret, sensitive: true, description: `Google OAuth Client Secret (Reseller ${slot}, encrypted)` });
  }
  if (resellerEmail !== null && resellerEmail !== undefined) {
    settings.push({ key: `reseller_email${suffix}`, value: resellerEmail, sensitive: false, description: `Google Reseller admin email (Reseller ${slot})` });
  }
  if (resellerName !== null && resellerName !== undefined) {
    settings.push({ key: `reseller_name${suffix}`, value: resellerName, sensitive: false, description: `Google Reseller display name (Reseller ${slot})` });
  }

  if (settings.length === 0) {
    return { error: 'कोई भी value change नहीं हुई' };
  }

  try {
    const res = await fetch(`${API_BASE}/settings/google`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeader()),
      },
      body: JSON.stringify({ settings }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const err = await res.json() as { error?: { message: string } };
      return { error: err.error?.message ?? 'Save failed' };
    }

    revalidatePath('/dashboard/settings/google');
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

export async function connectGoogleAction(slot: 1 | 2 = 1): Promise<{ authorize_url?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/google-workspace/auth/url?slot=${slot}`, {
      headers: await getAuthHeader(),
      cache: 'no-store',
    });
    if (!res.ok) return { error: 'Authorization URL generate नहीं हो पाया' };
    const data = await res.json() as { authorize_url: string };
    return { authorize_url: data.authorize_url };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

export async function disconnectGoogleAction(slot: 1 | 2 = 1): Promise<{ success?: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/google-workspace/auth?slot=${slot}`, {
      method: 'DELETE',
      headers: await getAuthHeader(),
      cache: 'no-store',
    });
    if (!res.ok) return { error: 'Disconnect failed' };
    revalidatePath('/dashboard/settings/google');
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}
