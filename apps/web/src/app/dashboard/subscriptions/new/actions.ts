'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { extractApiError } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
const SESSION_COOKIE = 'subs_session';

async function getAuthHeader() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

export interface BulkSubContext {
  organizationId: string;
  zohoCustomerId: string;
  zohoCustomerName?: string;
  zohoInvoiceId?: string;
  zohoInvoiceNumber?: string;
  leadId?: string;
  quoteId?: string;
}

export interface BulkSubRow {
  zohoItemId: string | null;
  zohoItemName: string;
  domainName: string;
  quantity: number;
  price: number;
  costPrice: number;
  billingCycle: string;
  startDate: string;
  endDate: string;
}

/**
 * Create one subscription per row of a multi-item converted invoice.
 * Rows run sequentially: parallel creates would race the domain
 * find-or-create on the API when rows share a domain.
 * `results` is aligned with the input row order.
 */
export async function createSubscriptionsBulkAction(
  ctx: BulkSubContext,
  rows: BulkSubRow[],
): Promise<{ created: number; results: Array<{ ok: boolean; error?: string }> }> {
  const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
  let created = 0;
  const results: Array<{ ok: boolean; error?: string }> = [];

  for (const row of rows) {
    const body = {
      organizationId:     ctx.organizationId,
      domainName:         row.domainName || undefined,
      zohoCustomerId:     ctx.zohoCustomerId,
      zohoCustomerName:   ctx.zohoCustomerName || undefined,
      zohoItemId:         row.zohoItemId ?? '',
      zohoItemName:       row.zohoItemName || undefined,
      originLeadId:       ctx.leadId || undefined,
      originQuickQuoteId: ctx.quoteId || undefined,
      quantity:           row.quantity,
      subscriptionPrice:  row.price,
      costPrice:          row.costPrice,
      billingCycle:       row.billingCycle,
      startDate:          row.startDate,
      endDate:            row.endDate,
      lastInvoiceId:      ctx.zohoInvoiceId || undefined,
      lastInvoiceNumber:  ctx.zohoInvoiceNumber || undefined,
      lastInvoiceDate:    row.startDate || undefined,
      lifecycleStatus:    'Active',
    };
    try {
      const res = await fetch(`${API_BASE}/subscriptions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        results.push({ ok: false, error: extractApiError(body, `HTTP ${res.status}`) });
      } else {
        created++;
        results.push({ ok: true });
      }
    } catch (err) {
      results.push({ ok: false, error: err instanceof Error ? err.message : 'Server से connect नहीं हो पाया' });
    }
  }

  if (created > 0) revalidatePath('/dashboard/subscriptions');
  return { created, results };
}

/**
 * Phase 2: Create the Zoho invoice after subscriptions are confirmed (or skipped).
 * Called from MultiSubscriptionForm after "Create Subscriptions" succeeds AND on "Skip".
 */
export async function createInvoiceForQuoteAction(
  quoteId: string,
  items: Array<{ domainName: string; billingCycle: string; startDate: string; endDate: string; costPrice?: number }>,
): Promise<{ zohoInvoiceId: string; zohoInvoiceNumber: string | null }> {
  const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
  const res = await fetch(`${API_BASE}/conversions/quote/${quoteId}/create-invoice`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ items }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(extractApiError(body, `Invoice create nahi hui (HTTP ${res.status})`));
  }
  return res.json() as Promise<{ zohoInvoiceId: string; zohoInvoiceNumber: string | null }>;
}

/** Phase 2b: Email the created Zoho invoice to the customer (Zoho fills recipient from contact). */
export async function sendInvoiceEmailAction(
  quoteId: string,
): Promise<{ ok: boolean; sentTo?: string | null; error?: string }> {
  const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
  const res = await fetch(`${API_BASE}/conversions/quote/${quoteId}/email-invoice`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: extractApiError(body, `Email send nahi hui (HTTP ${res.status})`) };
  }
  const data = await res.json() as { ok?: boolean; sentTo?: string | null };
  return { ok: true, sentTo: data.sentTo ?? null };
}

export async function createSubscriptionAction(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const body = {
    organizationId:    formData.get('organization_id') as string,
    domainId:          (formData.get('domain_id') as string) || undefined,
    domainName:        (formData.get('domain_name') as string) || undefined,
    zohoCustomerId:    formData.get('zoho_customer_id') as string,
    zohoCustomerName:  formData.get('zoho_customer_name') as string || undefined,
    zohoItemId:        formData.get('zoho_item_id') as string,
    zohoItemName:      formData.get('zoho_item_name') as string || undefined,
    originLeadId:      formData.get('origin_lead_id') as string || undefined,
    originQuickQuoteId: formData.get('origin_quote_id') as string || undefined,
    quantity:          Number(formData.get('quantity') || 1),
    subscriptionPrice: Number(formData.get('subscription_price') || 0),
    costPrice:         Number(formData.get('cost_price') || 0),
    billingCycle:      formData.get('billing_cycle') as string,
    startDate:         formData.get('start_date') as string,
    endDate:           formData.get('end_date') as string,
    lastInvoiceId:     formData.get('zoho_invoice_id') as string || undefined,
    lastInvoiceNumber: formData.get('zoho_invoice_number') as string || undefined,
    lastInvoiceDate:   formData.get('start_date') as string || undefined,
    notes:             formData.get('notes') as string || undefined,
    lifecycleStatus:   'Active',   // created as Active — invoice already exists
  };

  try {
    const res = await fetch(`${API_BASE}/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: extractApiError(body, 'Subscription create नहीं हो पाई') };
    }

    const sub = await res.json() as { id: string };
    revalidatePath('/dashboard/subscriptions');
    redirect(`/dashboard/subscriptions/${sub.id}`);
  } catch (err) {
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
    return { error: err instanceof Error ? err.message : 'Server से connect नहीं हो पाया' };
  }
}
