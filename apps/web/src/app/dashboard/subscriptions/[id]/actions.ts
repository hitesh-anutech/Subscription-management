'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
const SESSION_COOKIE = 'subs_session';

export async function startSubscriptionAction(
  subscriptionId: string,
  formData: FormData,
): Promise<{ success?: boolean; error?: string; zohoDocumentNumber?: string }> {
  const start_date         = formData.get('start_date') as string;
  const end_date           = formData.get('end_date') as string;
  const zoho_document_type = formData.get('zoho_document_type') as string;
  const notes              = (formData.get('notes') as string | null) ?? undefined;

  if (!start_date || !end_date) return { error: 'Start date और end date required हैं' };
  if (!['estimate', 'invoice'].includes(zoho_document_type)) {
    return { error: 'Zoho document type select करो' };
  }

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
    const res = await fetch(`${API_BASE}/subscriptions/${subscriptionId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({ startDate: start_date, endDate: end_date, zohoDocumentType: zoho_document_type, notes }),
      cache: 'no-store',
    });

    if (!res.ok) return { error: await parseApiError(res, 'Start failed') };

    const data = await res.json() as { zoho_document_number?: string };
    revalidatePath(`/dashboard/subscriptions/${subscriptionId}`);
    revalidatePath('/dashboard/subscriptions');
    return { success: true, zohoDocumentNumber: data.zoho_document_number ?? undefined };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

async function getAuthHeader() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

// AllExceptionsFilter returns { error: { message } } — not flat { message }
async function parseApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json() as { message?: string; error?: { message?: string } };
    return body.error?.message ?? body.message ?? fallback;
  } catch {
    return fallback;
  }
}

/** Edit core subscription fields (Billing Cycle, Price, Renewal Price, dates, Auto Renew). */
export async function updateSubscriptionAction(
  subscriptionId: string,
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const billingCycle     = formData.get('billing_cycle') as string | null;
  const price            = formData.get('subscription_price') as string | null;
  const nextRenewalPrice = formData.get('next_renewal_price') as string | null;
  const startDate        = formData.get('start_date') as string | null;
  const endDate          = formData.get('end_date') as string | null;
  const autoRenew        = formData.get('auto_renew');

  const body: Record<string, unknown> = {};
  if (billingCycle)                              body.billingCycle      = billingCycle;
  if (price !== null && price !== '')            body.subscriptionPrice = Number(price);
  if (nextRenewalPrice !== null && nextRenewalPrice !== '') body.nextRenewalPrice = Number(nextRenewalPrice);
  if (startDate)                                 body.startDate         = startDate;
  if (endDate)                                   body.endDate           = endDate;
  body.autoRenew = autoRenew === 'on' || autoRenew === 'true';

  if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
    return { error: 'End date, start date se pehle nahi ho sakti' };
  }

  try {
    const res = await fetch(`${API_BASE}/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) return { error: await parseApiError(res, 'Update failed') };
    revalidatePath(`/dashboard/subscriptions/${subscriptionId}`);
    revalidatePath('/dashboard/subscriptions');
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

/** Fetch pre-filled email content for the Tax Invoice from Zoho. */
export async function getInvoiceEmailPreviewAction(historyId: string, templateId?: string): Promise<{
  ok?: boolean;
  error?: string;
  fromEmail?: string | null;
  toMailIds?: string[];
  ccMailIds?: string[];
  bccMailIds?: string[];
  subject?: string;
  body?: string;
  emailTemplates?: EmailTemplate[];
  contactEmails?: ContactEmailSuggestion[];
}> {
  try {
    const url = templateId
      ? `${API_BASE}/subscriptions/renewal-history/${historyId}/invoice-email-preview?template_id=${encodeURIComponent(templateId)}`
      : `${API_BASE}/subscriptions/renewal-history/${historyId}/invoice-email-preview`;
    const res = await fetch(url, { method: 'GET', headers: { ...(await getAuthHeader()) }, cache: 'no-store' });
    if (!res.ok) return { error: await parseApiError(res, 'Preview load failed') };
    const data = await res.json() as {
      fromEmail?: string | null; toMailIds?: string[]; ccMailIds?: string[];
      bccMailIds?: string[]; subject?: string; body?: string;
      emailTemplates?: EmailTemplate[]; contactEmails?: ContactEmailSuggestion[];
    };
    return { ok: true, ...data };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

/** (Re)send the Tax Invoice to the customer via Zoho. */
export async function sendInvoiceAction(
  historyId: string,
  override?: { toMailIds?: string[]; ccMailIds?: string[]; bccMailIds?: string[]; subject?: string; body?: string },
): Promise<{ ok?: boolean; error?: string; sentTo?: string | null }> {
  try {
    const res = await fetch(`${API_BASE}/subscriptions/renewal-history/${historyId}/send-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify(override ?? {}),
      cache: 'no-store',
    });
    if (!res.ok) return { error: await parseApiError(res, 'Send failed') };
    const data = await res.json() as { sentTo?: string | null };
    revalidatePath('/dashboard/subscriptions');
    return { ok: true, sentTo: data.sentTo ?? null };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

export async function generateRenewalQuoteAction(
  subscriptionId: string,
  formData: FormData,
): Promise<{ success?: boolean; error?: string; zohoEstimateNumber?: string }> {
  const overridePrice    = formData.get('override_price') as string | null;
  const overrideQuantity = formData.get('override_quantity') as string | null;
  const notes            = formData.get('notes') as string | null;

  const body: Record<string, unknown> = {};
  if (overridePrice    && Number(overridePrice)    > 0) body.overridePrice    = Number(overridePrice);
  if (overrideQuantity && Number(overrideQuantity) > 0) body.overrideQuantity = Number(overrideQuantity);
  if (notes) body.notes = notes;

  try {
    const res = await fetch(`${API_BASE}/subscriptions/${subscriptionId}/renewal-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (!res.ok) return { error: await parseApiError(res, 'Renewal quote failed') };

    const data = await res.json() as { zoho_estimate_number?: string };
    revalidatePath(`/dashboard/subscriptions/${subscriptionId}`);
    return { success: true, zohoEstimateNumber: data.zoho_estimate_number ?? undefined };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

export interface EmailTemplate    { email_template_id: string; name: string; selected: boolean }
export interface ContactEmailSuggestion { name: string; email: string }

/** Fetch pre-filled email content from Zoho (subject, body, to/cc/bcc, templates list, contact suggestions). */
export async function getEmailPreviewAction(historyId: string, templateId?: string): Promise<{
  ok?: boolean;
  error?: string;
  fromEmail?: string | null;
  toMailIds?: string[];
  ccMailIds?: string[];
  bccMailIds?: string[];
  subject?: string;
  body?: string;
  emailTemplates?: EmailTemplate[];
  contactEmails?: ContactEmailSuggestion[];
}> {
  try {
    const url = templateId
      ? `${API_BASE}/subscriptions/renewal-history/${historyId}/email-preview?template_id=${encodeURIComponent(templateId)}`
      : `${API_BASE}/subscriptions/renewal-history/${historyId}/email-preview`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { ...(await getAuthHeader()) },
      cache: 'no-store',
    });
    if (!res.ok) return { error: await parseApiError(res, 'Preview load failed') };
    const data = await res.json() as {
      fromEmail?: string | null; toMailIds?: string[]; ccMailIds?: string[];
      bccMailIds?: string[]; subject?: string; body?: string;
      emailTemplates?: EmailTemplate[]; contactEmails?: ContactEmailSuggestion[];
    };
    return { ok: true, ...data };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

/** Email the proforma (Zoho estimate) to the customer — mail goes from Zoho, triggered here. */
export async function sendProformaAction(
  historyId: string,
  override?: { toMailIds?: string[]; ccMailIds?: string[]; bccMailIds?: string[]; subject?: string; body?: string },
): Promise<{ ok?: boolean; error?: string; sentTo?: string | null }> {
  try {
    const res = await fetch(`${API_BASE}/subscriptions/renewal-history/${historyId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify(override ?? {}),
      cache: 'no-store',
    });
    if (!res.ok) return { error: await parseApiError(res, 'Send failed') };
    const data = await res.json() as { sentTo?: string | null };
    revalidatePath('/dashboard/subscriptions');
    return { ok: true, sentTo: data.sentTo ?? null };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

/** Pull latest Zoho estimate status into the app. */
export async function refreshProformaAction(
  historyId: string,
): Promise<{ ok?: boolean; error?: string; zohoEstimateStatus?: string | null }> {
  try {
    const res = await fetch(`${API_BASE}/subscriptions/renewal-history/${historyId}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      cache: 'no-store',
    });
    if (!res.ok) return { error: await parseApiError(res, 'Refresh failed') };
    const data = await res.json() as { zohoEstimateStatus?: string | null };
    revalidatePath('/dashboard/subscriptions');
    return { ok: true, zohoEstimateStatus: data.zohoEstimateStatus ?? null };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

/** Convert Quote to Invoice via Zoho Books API. */
export async function convertProformaToInvoiceAction(
  historyId: string,
): Promise<{ ok?: boolean; error?: string; invoiceId?: string; invoiceNumber?: string | null }> {
  try {
    const res = await fetch(`${API_BASE}/subscriptions/renewal-history/${historyId}/convert-to-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      cache: 'no-store',
    });
    if (!res.ok) return { error: await parseApiError(res, 'Conversion failed') };
    const data = await res.json() as { invoiceId?: string; invoiceNumber?: string | null };
    revalidatePath('/dashboard/subscriptions');
    return { ok: true, invoiceId: data.invoiceId, invoiceNumber: data.invoiceNumber ?? null };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

export async function generateProrataQuoteAction(
  subscriptionId: string,
  formData: FormData,
): Promise<{ success?: boolean; error?: string; calculation?: Record<string, unknown>; zohoEstimateNumber?: string }> {
  const additionalLicenses = Number(formData.get('additional_licenses'));
  const effectiveDate      = formData.get('effective_date') as string | null;
  const notes              = formData.get('notes') as string | null;

  if (!additionalLicenses || additionalLicenses < 1) return { error: 'Additional licenses ≥ 1 होना चाहिए' };
  if (!effectiveDate) return { error: 'Effective date required है' };

  try {
    const res = await fetch(`${API_BASE}/subscriptions/${subscriptionId}/prorata-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify({ additionalLicenses, effectiveDate, notes }),
      cache: 'no-store',
    });

    if (!res.ok) return { error: await parseApiError(res, 'Pro-rata quote failed') };

    const data = await res.json() as { calculation?: Record<string, unknown>; zoho_estimate_number?: string };
    revalidatePath(`/dashboard/subscriptions/${subscriptionId}`);
    return { success: true, calculation: data.calculation, zohoEstimateNumber: data.zoho_estimate_number ?? undefined };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

export async function getRenewalPrefillAction(ids: string[]): Promise<{
  ok?: boolean;
  error?: string;
  data?: {
    organizationId: string;
    zohoCustomerId: string;
    zohoCustomerName: string;
    items: Array<{
      id: string;
      line_order: number;
      zoho_item_id: string | null;
      item_name: string;
      item_description: string | null;
      quantity: number;
      unit_price: number;
      cost_price: number;
      discount_percent: number;
      tax_rate: number;
      is_subscription: boolean;
      billing_cycle: string | null;
      primary_domain: string | null;
      service_period_start: string | null;
      service_period_end: string | null;
      renewed_subscription_id: string;
    }>;
  };
}> {
  try {
    const res = await fetch(`${API_BASE}/subscriptions/prefill-renewal-quote?ids=${encodeURIComponent(ids.join(','))}`, {
      method: 'GET',
      headers: { ...(await getAuthHeader()) },
      cache: 'no-store',
    });
    if (!res.ok) return { error: await parseApiError(res, 'Prefill data fetch failed') };
    const data = await res.json();
    return { ok: true, data };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}


import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';

export async function deleteSubscriptionAction(id: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Admin') {
    throw new Error('Unauthorized — Only Admin can delete a subscription');
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
  const res = await fetch(`${API_BASE}/subscriptions/${id}`, {
    method: 'DELETE',
    headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error('Failed to delete subscription');
  }

  revalidatePath('/dashboard/subscriptions');
  redirect('/dashboard/subscriptions');
}
