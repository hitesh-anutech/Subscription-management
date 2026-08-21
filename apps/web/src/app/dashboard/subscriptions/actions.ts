'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';

export async function deleteMultipleSubscriptionsAction(ids: string[]) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Admin') {
    throw new Error('Unauthorized — Only Admin can delete subscriptions');
  }

  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  
  for (const id of ids) {
    await api.delete(`/subscriptions/${id}`);
  }
  revalidatePath('/dashboard/subscriptions');
}
