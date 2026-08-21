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

export async function saveBrandingAction(
  orgId: string,
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const get = (key: string) => {
    const v = formData.get(key);
    return typeof v === 'string' && v.length > 0 ? v : null;
  };
  const getBool = (key: string) => formData.get(key) === 'true';

  const body = {
    legalName: get('legalName'),
    displayName: get('displayName'),
    brandColor: get('brandColor') ?? '#1F2937',
    pdfTemplate: get('pdfTemplate') ?? 'modern',
    logoUrl: get('logoUrl'),
    signatureImageUrl: get('signatureImageUrl'),

    addressLine1: get('addressLine1'),
    addressLine2: get('addressLine2'),
    city: get('city'),
    state: get('state'),
    stateCode: get('stateCode'),
    postalCode: get('postalCode'),
    country: get('country'),
    gstin: get('gstin'),
    pan: get('pan'),
    phone: get('phone'),
    email: get('email'),
    website: get('website'),

    pdfFooterText: get('pdfFooterText'),
    pdfWatermark: get('pdfWatermark'),
    pdfShowCostPrice: getBool('pdfShowCostPrice'),
    pdfShowInternalNotes: getBool('pdfShowInternalNotes'),

    bankName: get('bankName'),
    bankAccountNumber: get('bankAccountNumber'),
    bankIfsc: get('bankIfsc'),
    bankAccountHolder: get('bankAccountHolder'),

    settingsOverrides: (() => {
      try {
        const raw = formData.get('settingsOverrides');
        return typeof raw === 'string' && raw ? JSON.parse(raw) as Record<string, unknown> : {};
      } catch { return {}; }
    })(),
  };

  try {
    const res = await fetch(`${API_BASE}/org-settings/${orgId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeader()),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (!res.ok) {
      const err = await res.json() as { error?: { message: string } };
      return { error: err.error?.message ?? 'Save failed' };
    }

    revalidatePath('/dashboard/settings/pdf-branding');
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}
