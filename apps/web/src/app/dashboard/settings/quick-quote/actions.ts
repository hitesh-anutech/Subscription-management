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

export async function saveQuickQuoteSettingsAction(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const get = (key: string) => (formData.get(key) as string | null) ?? '';

  const settings = [
    { key: 'default_validity_days',        value: get('default_validity_days') },
    { key: 'public_token_expiry_days',     value: get('public_token_expiry_days') },
    { key: 'number_format',                value: get('number_format') },
    { key: 'lead_number_format',           value: get('lead_number_format') },
    { key: 'subscription_number_format',   value: get('subscription_number_format') },
    { key: 'auto_expire_action',           value: get('auto_expire_action') },
    { key: 'max_discount_percent',         value: get('max_discount_percent') },
    { key: 'default_terms_and_conditions', value: get('default_terms_and_conditions') },
    { key: 'default_notes_to_customer',    value: get('default_notes_to_customer') },
  ];

  try {
    const authHeader = await getAuthHeader();
    const res = await fetch(`${API_BASE}/settings/quick_quote`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
      },
      body: JSON.stringify({ settings }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const err = await res.json() as { error?: { message: string } };
      return { error: err.error?.message ?? 'Save failed' };
    }

    // 2. Fetch active organizations and save their custom formats
    const orgsRes = await fetch(`${API_BASE}/organizations`, {
      headers: authHeader,
      cache: 'no-store',
    });
    if (orgsRes.ok) {
      const orgsData = await orgsRes.json() as { organizations: any[] };
      const orgs = orgsData.organizations ?? [];
      for (const org of orgs) {
        const quoteNumberFormat = (formData.get(`org_quote_format_${org.id}`) as string | null)?.trim() || null;
        const leadNumberFormat = (formData.get(`org_lead_format_${org.id}`) as string | null)?.trim() || null;
        const subscriptionNumberFormat = (formData.get(`org_subscription_format_${org.id}`) as string | null)?.trim() || null;

        await fetch(`${API_BASE}/org-settings/${org.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...authHeader,
          },
          body: JSON.stringify({
            quoteNumberFormat,
            leadNumberFormat,
            subscriptionNumberFormat,
          }),
          cache: 'no-store',
        });
      }
    }

    revalidatePath('/dashboard/settings/quick-quote');
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}
