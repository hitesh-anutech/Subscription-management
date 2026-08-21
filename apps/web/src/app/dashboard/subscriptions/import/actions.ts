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

export interface ImportInvoiceRef {
  invoiceId?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  startDate?: string;
  endDate?: string;
  quantity?: number;
  price?: number;
  businessType?: string;
  // Originating quote (from invoice.estimate_id) → linked into renewal history.
  quoteId?: string;
  quoteNumber?: string;
  quoteDate?: string;
  quoteStatus?: string;
  currency?: string;
  exchangeRate?: number;
}

export interface ImportSubscription {
  organizationId: string;
  zohoCustomerId: string;
  zohoCustomerName?: string;
  zohoItemId: string;
  zohoItemName?: string;
  domainName: string;
  quantity: number;
  subscriptionPrice: number;
  costPrice?: number;
  billingCycle: string;
  startDate: string;
  endDate: string;
  lastInvoiceId?: string;
  lastInvoiceNumber?: string;
  currency?: string;
  exchangeRate?: number;
  sourceIsEstimate?: boolean;
  sourceQuoteStatus?: string;
  history?: ImportInvoiceRef[];
}

export interface ImportResult {
  created: number;
  enriched: number;
  skipped: number;
  errors: string[];
}

export async function importSubscriptionsAction(
  subscriptions: ImportSubscription[],
): Promise<ImportResult> {
  try {
    const res = await fetch(`${API_BASE}/subscriptions/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
      body: JSON.stringify({ subscriptions }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { created: 0, enriched: 0, skipped: 0, errors: [extractApiError(body, 'Import failed')] };
    }

    const data = await res.json() as ImportResult;
    revalidatePath('/dashboard/subscriptions');
    return data;
  } catch {
    return { created: 0, enriched: 0, skipped: 0, errors: ['Server से connect नहीं हो पाया'] };
  }
}
