'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { extractApiError } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
const SESSION_COOKIE = 'subs_session';

/** Pull all customers from Zoho Books into the local cache for the given org. */
export async function syncCustomersAction(orgId: string): Promise<{ ok?: boolean; synced?: number; error?: string }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
  try {
    const res = await fetch(`${API_BASE}/organizations/${orgId}/sync-customers`, {
      method: 'POST',
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: extractApiError(body, 'Import failed') };
    }
    const data = await res.json() as { synced: number };
    revalidatePath('/dashboard/customers');
    return { ok: true, synced: data.synced };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

export async function syncSingleCustomerAction(orgId: string, zohoId: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
  try {
    const res = await fetch(`${API_BASE}/organizations/${orgId}/customers/${zohoId}/sync`, {
      method: 'POST',
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: extractApiError(body, 'Sync failed') };
    }
    revalidatePath(`/dashboard/customers/${zohoId}`);
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}
