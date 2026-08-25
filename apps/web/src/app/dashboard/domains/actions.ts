'use server';

import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';


export async function renameDomainAction(id: string, domainName: string) {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  try {
    await api.patch(`/domains/${id}`, { domainName: domainName.trim() });
    revalidatePath('/dashboard/domains');
    return { error: null };
  } catch (err: any) {
    return { error: err.message ?? 'Rename failed' };
  }
}

export async function bulkDeleteDomainsAction(ids: string[]) {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  try {
    const res = await api.post<any>('/domains/bulk-delete', { ids });
    if (res?.error) {
      return { error: res.error };
    }
    revalidatePath('/dashboard/domains');
    return { error: null, deletedCount: res?.deletedCount };
  } catch (err: any) {
    return { error: err.message ?? 'Failed to bulk delete domains' };
  }
}
