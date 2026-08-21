'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { z } from 'zod';

async function serverApi() {
  const cookieStore = await cookies();
  return createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
}

const createSchema = z.object({
  name: z.string().min(2).max(150),
  zoho_org_id: z.string().min(1).max(50),
  data_center: z.enum(['in', 'com', 'eu', 'com.au', 'jp', 'sa']).default('in'),
  base_currency: z.string().default('INR'),
});

export type ActionState = {
  ok: boolean;
  error?: string;
} | null;

export async function createOrganization(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createSchema.safeParse({
    name: formData.get('name'),
    zoho_org_id: formData.get('zoho_org_id'),
    data_center: formData.get('data_center') || 'in',
    base_currency: formData.get('base_currency') || 'INR',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  try {
    const api = await serverApi();
    await api.post('/organizations', parsed.data);
    revalidatePath('/dashboard/settings/organizations');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
}

export async function connectZoho(orgId: string): Promise<{ authorize_url?: string; error?: string }> {
  try {
    const api = await serverApi();
    const resp = await api.post<{ authorize_url: string }>(`/organizations/${orgId}/connect-zoho`);
    return resp;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed' };
  }
}

export async function disconnectZoho(orgId: string): Promise<ActionState> {
  try {
    const api = await serverApi();
    await api.post(`/organizations/${orgId}/disconnect-zoho`);
    revalidatePath('/dashboard/settings/organizations');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
}

export async function testZohoConnection(orgId: string): Promise<{ success: boolean; error?: string; zoho_orgs_visible?: string[] }> {
  try {
    const api = await serverApi();
    const resp = await api.post<{ success: boolean; error?: string; zoho_orgs_visible?: string[] }>(
      `/organizations/${orgId}/test-zoho-connection`,
    );
    if (resp.success) revalidatePath('/dashboard/settings/organizations');
    return resp;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed' };
  }
}

export async function deleteOrganization(orgId: string): Promise<ActionState> {
  try {
    const api = await serverApi();
    await api.delete(`/organizations/${orgId}`);
    revalidatePath('/dashboard/settings/organizations');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
}
