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

async function apiPost<T>(path: string, body?: unknown): Promise<{ data?: T; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const json = await res.json() as T & { message?: string };
    if (!res.ok) return { error: (json as { message?: string }).message ?? `Error ${res.status}` };
    return { data: json };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

async function apiGet<T>(path: string): Promise<{ data?: T; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      headers: { ...(await getAuthHeader()) },
      cache: 'no-store',
    });
    const json = await res.json() as T & { message?: string };
    if (!res.ok) return { error: (json as { message?: string }).message ?? `Error ${res.status}` };
    return { data: json };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

// Background job response type
export interface ResellerJob {
  jobId: string;
  type: 'fetch_subscriptions' | 'fetch_customers';
  status: 'running' | 'done' | 'error' | 'not_found';
  total: number;
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  slot?: string;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export async function fetchResellerSubscriptionsAction(slot?: 1 | 2) {
  // Returns { jobId, status: 'started' } — poll with getResellerJobStatusAction
  return apiPost<{ jobId: string; status: string }>(
    '/google-workspace/reseller-subs/fetch-subscriptions',
    { slot },
  );
}

export async function fetchResellerCustomersAction(forceRefresh = false) {
  // Returns { jobId, total } — poll with getResellerJobStatusAction
  return apiPost<{ jobId: string; total: number }>(
    '/google-workspace/reseller-subs/fetch-customers',
    { forceRefresh },
  );
}

export async function getResellerJobStatusAction(jobId: string) {
  const res = await apiGet<ResellerJob>(`/google-workspace/reseller-subs/job/${jobId}`);
  return res.data ?? ({ status: 'not_found' } as ResellerJob);
}

export async function reconcileAllAction() {
  const result = await apiPost<{ matched: number; notMatched: number; skipped: number; total: number }>('/google-workspace/reseller-subs/reconcile');
  if (result.data) revalidatePath('/dashboard/google-workspace');
  return result;
}

export async function reconcileOneAction(id: string) {
  const result = await apiPost<{ matched: number; notMatched: number; total: number }>(`/google-workspace/reseller-subs/${id}/reconcile`);
  if (result.data) revalidatePath('/dashboard/google-workspace');
  return result;
}

export async function refreshSubscriptionAction(id: string) {
  const result = await apiPost<{ updated: boolean }>(`/google-workspace/reseller-subs/${id}/fetch-subscription`);
  if (result.data) revalidatePath('/dashboard/google-workspace');
  return result;
}

export async function refreshCustomerAction(id: string) {
  const result = await apiPost<{ updated: number }>(`/google-workspace/reseller-subs/${id}/fetch-customer`);
  if (result.data) revalidatePath('/dashboard/google-workspace');
  return result;
}

export async function updateAdditionalDomainsAction(id: string, domains: string[]) {
  const result = await apiPost<{ id: string; additionalDomains: string[] }>(`/google-workspace/reseller-subs/${id}/additional-domains`, { domains });
  if (result.data) revalidatePath('/dashboard/google-workspace');
  return result;
}

export async function setExcludedAction(id: string, excluded: boolean) {
  const result = await apiPost<{ id: string; reconciliationStatus: string }>(`/google-workspace/reseller-subs/${id}/exclude`, { excluded });
  if (result.data) revalidatePath('/dashboard/google-workspace');
  return result;
}

export async function importCustomerUidsAction(items: Array<{ customerId: string; customerUid: string }>) {
  const result = await apiPost<{ updated: number; notFound: number; total: number; notFoundIds: string[] }>(
    '/google-workspace/reseller-subs/import-customer-uid',
    { items },
  );
  if (result.data) revalidatePath('/dashboard/google-workspace');
  return result;
}

export async function updateCustomerUidAction(id: string, customerUid: string) {
  const result = await apiPost<{ id: string; customerUid: string | null }>(
    `/google-workspace/reseller-subs/${id}/customer-uid`,
    { customerUid },
  );
  if (result.data) revalidatePath('/dashboard/google-workspace');
  return result;
}
