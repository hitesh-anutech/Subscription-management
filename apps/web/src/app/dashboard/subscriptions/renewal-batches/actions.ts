'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type {
  EmailTemplate, ContactEmailSuggestion, SendEmailOverride,
} from '@/components/send-email-modal';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
const SESSION_COOKIE = 'subs_session';

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

/** Zoho email content for a batch's estimate (subject/body/to/cc/bcc + templates + contact suggestions). */
export async function getBatchEmailPreviewAction(batchId: string, templateId?: string): Promise<{
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
      ? `${API_BASE}/subscriptions/renewal-batches/${batchId}/email-preview?template_id=${encodeURIComponent(templateId)}`
      : `${API_BASE}/subscriptions/renewal-batches/${batchId}/email-preview`;
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

/**
 * Send a batch's estimate to the customer via Zoho. Pass `override` (compose-modal values)
 * for a single reviewed send, or omit it for a plain bulk-send with Zoho's default template.
 */
export async function sendBatchAction(
  batchId: string,
  override?: SendEmailOverride,
): Promise<{ ok?: boolean; error?: string; sentTo?: string | null }> {
  try {
    const res = await fetch(`${API_BASE}/subscriptions/renewal-batches/${batchId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify(override ?? {}),
      cache: 'no-store',
    });
    if (!res.ok) return { error: await parseApiError(res, 'Send failed') };
    const data = await res.json() as { sentTo?: string | null };
    revalidatePath('/dashboard/subscriptions/renewal-batches');
    return { ok: true, sentTo: data.sentTo ?? null };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

/** Pull latest estimate/invoice status for a batch from Zoho into the app. */
export async function refreshBatchAction(
  batchId: string,
): Promise<{ ok?: boolean; error?: string; status?: string | null; zohoEstimateStatus?: string | null; zohoInvoiceStatus?: string | null }> {
  try {
    const res = await fetch(`${API_BASE}/subscriptions/renewal-batches/${batchId}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      cache: 'no-store',
    });
    if (!res.ok) return { error: await parseApiError(res, 'Refresh failed') };
    const data = await res.json() as { status?: string | null; zohoEstimateStatus?: string | null; zohoInvoiceStatus?: string | null };
    revalidatePath('/dashboard/subscriptions/renewal-batches');
    return { ok: true, ...data };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}
