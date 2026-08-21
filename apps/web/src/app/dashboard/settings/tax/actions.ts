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

export async function saveTaxSettingsAction(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const get = (key: string) => (formData.get(key) as string | null) ?? '';

  const settings = [
    { key: 'default_gst_rate',       value: get('default_gst_rate') },
    { key: 'tax_mode',               value: get('tax_mode') },
    { key: 'reverse_charge_enabled', value: formData.get('reverse_charge_enabled') === 'on' ? 'true' : 'false' },
  ];

  try {
    const res = await fetch(`${API_BASE}/settings/tax`, {
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

    revalidatePath('/dashboard/settings/tax');
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

// GST state code → state name lookup (matches master_data_lists seed)
const STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
  '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh (New)',
  '38': 'Ladakh', '97': 'Other Territory',
};

export async function saveOrgTaxSettingsAction(
  orgId: string,
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const supplierStateCode = (formData.get(`supplier_state_code_${orgId}`) as string | null) ?? '';
  const supplierState     = supplierStateCode ? (STATE_NAMES[supplierStateCode] ?? supplierStateCode) : '';
  const defaultTaxRate    = (formData.get(`default_tax_rate_${orgId}`)    as string | null) ?? '';

  try {
    const body: Record<string, unknown> = {
      supplierState:     supplierState     || null,
      supplierStateCode: supplierStateCode || null,
    };
    if (defaultTaxRate) body.defaultTaxRate = Number(defaultTaxRate);

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

    revalidatePath('/dashboard/settings/tax');
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}
