'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { extractApiError } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
const SESSION_COOKIE = 'subs_session';

async function getAuthHeader() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

// ── Global lead settings ──────────────────────────────────────────────

export async function saveLeadSettingsAction(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const get = (key: string) => (formData.get(key) as string | null) ?? '';

  const settings = [
    { key: 'auto_archive_days',    value: get('auto_archive_days') },
    { key: 'duplicate_detection',  value: get('duplicate_detection') },
    { key: 'assignment_method',    value: get('assignment_method') },
  ];

  try {
    const res = await fetch(`${API_BASE}/settings/lead`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify({ settings }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = await res.json() as { error?: { message: string } };
      return { error: err.error?.message ?? 'Save failed' };
    }
    revalidatePath('/dashboard/settings/lead-management');
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

// ── Master data list mutations ────────────────────────────────────────

export async function addListItemAction(
  listType: string,
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const itemValue = ((formData.get('item_value') as string | null) ?? '').trim();
  const itemLabel = ((formData.get('item_label') as string | null) ?? '').trim();

  if (!itemValue) return { error: 'Value required है' };

  try {
    const res = await fetch(`${API_BASE}/master-data/${listType}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify({ itemValue, itemLabel: itemLabel || itemValue }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: extractApiError(body, 'Add failed') };
    }
    revalidatePath('/dashboard/settings/lead-management');
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

export async function toggleListItemAction(
  listType: string,
  id: string,
  isActive: boolean,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/master-data/${listType}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify({ isActive }),
      cache: 'no-store',
    });
    if (!res.ok) return { error: 'Toggle failed' };
    revalidatePath('/dashboard/settings/lead-management');
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

export async function deleteListItemAction(
  listType: string,
  id: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/master-data/${listType}/${id}`, {
      method: 'DELETE',
      headers: { ...(await getAuthHeader()) },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: extractApiError(body, 'Delete failed') };
    }
    revalidatePath('/dashboard/settings/lead-management');
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}
