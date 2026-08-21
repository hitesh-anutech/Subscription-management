'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';

export async function createQuoteAction(_prev: { error?: string } | null, formData: FormData) {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  // Parse items from form
  const itemsJson = formData.get('items_json') as string;
  let items = [];
  try {
    items = JSON.parse(itemsJson || '[]');
  } catch {
    return { error: 'Items parse नहीं हो पाए' };
  }

  const body = {
    customer_type:          formData.get('customer_type'),
    lead_id:                formData.get('lead_id')                || undefined,
    zoho_customer_id:       formData.get('zoho_customer_id')       || undefined,
    zoho_customer_name:     formData.get('zoho_customer_name')     || undefined,
    target_organization_id: formData.get('target_organization_id'),
    quote_number:           formData.get('quote_number')           || undefined,
    quote_date:             formData.get('quote_date')             || undefined,
    expiry_date:            formData.get('expiry_date')            || undefined,
    quote_reference:        formData.get('quote_reference')        || undefined,
    validity_days:          Number(formData.get('validity_days') || 15),
    is_intra_state:         formData.get('is_intra_state') === 'true',
    cgst_rate:              formData.get('cgst_rate') ? Number(formData.get('cgst_rate')) : undefined,
    sgst_rate:              formData.get('sgst_rate') ? Number(formData.get('sgst_rate')) : undefined,
    igst_rate:              formData.get('igst_rate') ? Number(formData.get('igst_rate')) : undefined,
    terms_and_conditions:   formData.get('terms_and_conditions')   || undefined,
    notes_to_customer:      formData.get('notes_to_customer')      || undefined,
    internal_notes:         formData.get('internal_notes')         || undefined,
    items,
  };

  let quoteId: string;
  try {
    const quote = await api.post<{ id: string; quoteNumber: string }>('/quick-quotes', body);
    revalidatePath('/dashboard/quick-quotes');
    quoteId = quote.id;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Quote create नहीं हो पाया' };
  }
  // redirect() throws NEXT_REDIRECT by design — keep it OUTSIDE the try/catch.
  redirect(`/dashboard/quick-quotes/${quoteId}`);
}

export async function updateQuoteAction(id: string, _prev: { error?: string } | null, formData: FormData) {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let items = [];
  try {
    items = JSON.parse((formData.get('items_json') as string) || '[]');
  } catch {
    return { error: 'Items parse नहीं हो पाए' };
  }

  // Only the fields the update endpoint whitelists (forbidNonWhitelisted → extras = 400).
  const body = {
    validity_days:        Number(formData.get('validity_days') || 15),
    is_intra_state:       formData.get('is_intra_state') === 'true',
    cgst_rate:            formData.get('cgst_rate') ? Number(formData.get('cgst_rate')) : undefined,
    sgst_rate:            formData.get('sgst_rate') ? Number(formData.get('sgst_rate')) : undefined,
    igst_rate:            formData.get('igst_rate') ? Number(formData.get('igst_rate')) : undefined,
    terms_and_conditions: formData.get('terms_and_conditions') || undefined,
    notes_to_customer:    formData.get('notes_to_customer')    || undefined,
    internal_notes:       formData.get('internal_notes')       || undefined,
    items,
  };

  try {
    await api.patch(`/quick-quotes/${id}`, body);
    revalidatePath(`/dashboard/quick-quotes/${id}`);
    revalidatePath('/dashboard/quick-quotes');
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Quote update नहीं हो पाया' };
  }
  // redirect() throws NEXT_REDIRECT by design — keep it OUTSIDE the try/catch.
  redirect(`/dashboard/quick-quotes/${id}`);
}

/** Email the converted invoice to the customer via Zoho (mail from Zoho, triggered here). */
export interface InvoiceEmailOverride {
  toMailIds?: string[];
  ccMailIds?: string[];
  bccMailIds?: string[];
  subject?: string;
  body?: string;
}

export interface InvoiceEmailPreview {
  ok?: boolean;
  error?: string;
  fromEmail?: string | null;
  toMailIds?: string[];
  ccMailIds?: string[];
  bccMailIds?: string[];
  subject?: string;
  body?: string;
  emailTemplates?: Array<{ email_template_id: string; name: string; selected: boolean }>;
  contactEmails?: Array<{ name: string; email: string }>;
}

/** Zoho's pre-filled email content for the converted invoice — drives the compose modal. */
export async function getQuoteInvoiceEmailPreviewAction(quoteId: string, templateId?: string): Promise<InvoiceEmailPreview> {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  try {
    const data = await api.get<InvoiceEmailPreview>(
      `/conversions/quote/${quoteId}/invoice-email-preview${templateId ? `?template_id=${templateId}` : ''}`,
    );
    return { ok: true, ...data };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Preview load नहीं हो पाया' };
  }
}

export async function emailQuoteInvoiceAction(
  quoteId: string,
  override?: InvoiceEmailOverride,
): Promise<{ ok?: boolean; error?: string; sentTo?: string | null }> {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  try {
    const data = await api.post<{ sentTo?: string | null }>(`/conversions/quote/${quoteId}/email-invoice`, override ?? {});
    revalidatePath(`/dashboard/quick-quotes/${quoteId}`);
    return { ok: true, sentTo: data.sentTo ?? null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Email failed' };
  }
}

/** Change the convert-time subscription decision (undo "never", or mark one-time later). */
export async function setSubscriptionDecisionAction(
  quoteId: string,
  decision: 'create_now' | 'later' | 'never',
): Promise<{ ok?: boolean; error?: string }> {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  try {
    await api.post(`/conversions/quote/${quoteId}/subscription-decision`, { decision });
    revalidatePath(`/dashboard/quick-quotes/${quoteId}`);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Update failed' };
  }
}

/** Pull the latest Zoho invoice status into the app. */
export async function refreshQuoteInvoiceAction(quoteId: string): Promise<{ ok?: boolean; error?: string }> {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  try {
    await api.post(`/conversions/quote/${quoteId}/refresh-invoice`, {});
    revalidatePath(`/dashboard/quick-quotes/${quoteId}`);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Refresh failed' };
  }
}

/** Undo an accidental admin accept — quote reverts to Sent/Draft, lead Won → Quoted. */
export async function unacceptQuoteAction(id: string): Promise<{ ok?: boolean; error?: string }> {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  try {
    await api.post(`/quick-quotes/${id}/unaccept`, {});
    revalidatePath(`/dashboard/quick-quotes/${id}`);
    revalidatePath('/dashboard/quick-quotes');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Undo नहीं हो पाया' };
  }
}

/** Admin marks a quote Accepted (offline-confirmed deal) so it can be converted. */
export async function markAcceptedAction(id: string): Promise<{ ok?: boolean; error?: string }> {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  try {
    await api.post(`/quick-quotes/${id}/accept`, {});
    revalidatePath(`/dashboard/quick-quotes/${id}`);
    revalidatePath('/dashboard/quick-quotes');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Accept नहीं हो पाया' };
  }
}

export interface SendQuoteResult {
  public_url: string;
  token: string;
  emailSent: boolean;
  emailTo: string | null;
  emailError: string | null;
}

export async function sendQuoteAction(id: string, recipientEmail?: string) {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  const result = await api.post<SendQuoteResult>(
    `/quick-quotes/${id}/send`,
    recipientEmail ? { recipient_email: recipientEmail } : {},
  );
  revalidatePath(`/dashboard/quick-quotes/${id}`);
  revalidatePath('/dashboard/quick-quotes');
  return result;
}

import { getCurrentUser } from '@/lib/auth';

export async function deleteQuoteAction(id: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Admin') {
    throw new Error('Unauthorized — Only Admin can delete a quote');
  }

  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  await api.delete(`/quick-quotes/${id}`);
  revalidatePath('/dashboard/quick-quotes');
  redirect('/dashboard/quick-quotes');
}

export async function deleteMultipleQuotesAction(ids: string[]) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Admin') {
    throw new Error('Unauthorized — Only Admin can delete quotes');
  }

  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  
  for (const id of ids) {
    await api.delete(`/quick-quotes/${id}`);
  }
  revalidatePath('/dashboard/quick-quotes');
}

export interface ConversionResult {
  success?: boolean; error?: string;
  zohoCustomerId?: string; zohoCustomerName?: string;
  zohoInvoiceId?: string; zohoInvoiceNumber?: string;
  domainId?: string; organizationId?: string; quickQuoteId?: string;
  subscriptionDecision?: 'create_now' | 'later' | 'never';
  /** >1 → bulk-domains quote: run the bulk subscription create instead of the single-sub page */
  bulkDomainCount?: number;
  subscriptionItems?: unknown[];
}

export interface BulkCreateResult {
  ok?: boolean; error?: string;
  created?: number; enriched?: number; skipped?: number; errors?: string[]; total?: number;
}

/** One subscription per domain of a converted bulk-domains quote. */
export async function bulkCreateSubscriptionsAction(quoteId: string): Promise<BulkCreateResult> {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  try {
    const data = await api.post<BulkCreateResult>('/subscriptions/bulk-create-from-quote', { quote_id: quoteId });
    revalidatePath('/dashboard/subscriptions');
    return { ok: true, ...data };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Bulk create failed' };
  }
}

/**
 * Convert an Accepted lead-type quote → Zoho customer + invoice (same endpoint the
 * lead-page panel uses). Returns the conversion result; the client component performs
 * the redirect to the Subscription Creation page (so no NEXT_REDIRECT-in-catch issue).
 */
export async function convertFromQuoteAction(
  leadId: string,
  organizationId: string,
  quoteId: string,
  _prev: ConversionResult | null,
  formData: FormData,
): Promise<ConversionResult> {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  try {
    const data = await api.post<ConversionResult>(`/conversions/lead/${leadId}`, {
      organizationId,
      quickQuoteId: quoteId,
      domainName: (formData.get('domain_name') as string) || undefined,
      serviceStartDate: (formData.get('service_start_date') as string) || undefined,
      subscriptionDecision: (formData.get('subscription_decision') as string) || undefined,
    });
    revalidatePath(`/dashboard/leads/${leadId}`);
    revalidatePath('/dashboard/subscriptions');
    return { success: true, ...data };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Conversion failed' };
  }
}

/**
 * Convert an Accepted EXISTING-customer quote → Zoho Tax Invoice (no new Contact).
 * The client component performs the redirect based on the result.
 */
export async function convertExistingQuoteAction(
  quoteId: string,
  _prev: ConversionResult | null,
  formData: FormData,
): Promise<ConversionResult> {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  try {
    const data = await api.post<ConversionResult>(`/conversions/quote/${quoteId}`, {
      domainName: (formData.get('domain_name') as string) || undefined,
      serviceStartDate: (formData.get('service_start_date') as string) || undefined,
      subscriptionDecision: (formData.get('subscription_decision') as string) || undefined,
    });
    // Deliberately NOT revalidating the quote page here: doing so re-renders it
    // into post-convert mode, unmounting the Convert button BEFORE its client
    // effect can router.push to the Subscription page (redirect race). The
    // client effect does router.push (create_now) or router.refresh() itself.
    revalidatePath('/dashboard/subscriptions');
    return { success: true, ...data };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Conversion failed' };
  }
}
