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

export async function saveZohoCredentialsAction(formData: FormData) {
  const clientId = formData.get('client_id') as string;
  const clientSecret = formData.get('client_secret') as string;

  const settings: Array<{ key: string; value: string; sensitive: boolean; description: string }> = [];

  if (clientId && !clientId.includes('•')) {
    settings.push({ key: 'client_id', value: clientId, sensitive: false, description: 'Zoho OAuth Client ID' });
  }
  if (clientSecret && !clientSecret.includes('•')) {
    settings.push({ key: 'client_secret', value: clientSecret, sensitive: true, description: 'Zoho OAuth Client Secret (encrypted)' });
  }

  if (settings.length === 0) {
    return { error: 'कोई भी value change नहीं हुई' };
  }

  try {
    const res = await fetch(`${API_BASE}/settings/zoho`, {
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

    revalidatePath('/dashboard/settings/zoho');
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}
