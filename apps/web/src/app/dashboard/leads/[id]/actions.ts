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

export async function convertLeadAction(
  leadId: string,
  formData: FormData,
): Promise<{
  success?: boolean; error?: string;
  zohoCustomerId?: string; zohoCustomerName?: string;
  zohoInvoiceId?: string; zohoInvoiceNumber?: string;
  domainId?: string; organizationId?: string; quickQuoteId?: string;
  subscriptionDecision?: string;
  subscriptionItems?: unknown[];
}> {
  const organizationId = formData.get('organization_id') as string | null;
  const quickQuoteId   = formData.get('quick_quote_id') as string | null;
  const domainName        = (formData.get('domain_name') as string | null) || undefined;
  const serviceStartDate  = (formData.get('service_start_date') as string | null) || undefined;
  const subscriptionDecision = (formData.get('subscription_decision') as string | null) || undefined;

  if (!organizationId) return { error: 'Organization select करो' };

  try {
    const res = await fetch(`${API_BASE}/conversions/lead/${leadId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify({ organizationId, quickQuoteId: quickQuoteId || undefined, domainName, serviceStartDate, subscriptionDecision }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: extractApiError(body, 'Conversion failed') };
    }

    const data = await res.json() as {
      zohoCustomerId?: string;
      zohoCustomerName?: string;
      zohoInvoiceId?: string;
      zohoInvoiceNumber?: string;
      domainId?: string;
      organizationId?: string;
      quickQuoteId?: string;
      subscriptionDecision?: string;
      subscriptionItems?: unknown[];
    };

    revalidatePath(`/dashboard/leads/${leadId}`);
    revalidatePath('/dashboard/subscriptions');
    return {
      success: true,
      zohoCustomerId:    data.zohoCustomerId,
      zohoCustomerName:  data.zohoCustomerName,
      zohoInvoiceId:     data.zohoInvoiceId,
      zohoInvoiceNumber: data.zohoInvoiceNumber,
      domainId:          data.domainId,
      organizationId:    data.organizationId,
      quickQuoteId:      data.quickQuoteId,
      subscriptionDecision: data.subscriptionDecision,
      subscriptionItems: data.subscriptionItems,
    };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}
