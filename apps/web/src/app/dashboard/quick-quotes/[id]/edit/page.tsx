import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { QuoteBuilder, type EditQuote } from '../../_components/quote-builder';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit Quote' };

interface Org { id: string; name: string }

interface QuoteItem {
  lineOrder: number;
  zohoItemId: string | null;
  itemName: string;
  itemDescription: string | null;
  hsnOrSac: string | null;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxRate: string;
  costPrice: string | null;
  isSubscription: boolean;
  billingCycle: string | null;
  primaryDomain: string | null;
  domainList: Array<{ domain: string; qty?: number }> | null;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
}

interface Quote {
  id: string;
  quoteNumber: string;
  referenceNumber: string | null;
  customerType: 'lead' | 'existing';
  status: string;
  quoteDate: string;
  expiryDate: string;
  validityDays: number;
  termsAndConditions: string | null;
  notesToCustomer: string | null;
  internalNotes: string | null;
  items: QuoteItem[];
  lead: { id: string; companyName: string; contactName: string | null; email: string; phone: string | null } | null;
  zohoCustomerId: string | null;
  zohoCustomerName: string | null;
  targetOrganization: { id: string; name: string };
}

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let quote: Quote;
  try {
    quote = await api.get<Quote>(`/quick-quotes/${id}`);
  } catch {
    notFound();
  }

  // Only Draft quotes are editable (backend enforces this too).
  if (quote.status !== 'Draft') {
    redirect(`/dashboard/quick-quotes/${id}`);
  }

  let orgs: Org[] = [];
  try {
    const data = await api.get<{ organizations: Org[] }>('/organizations');
    orgs = data.organizations ?? [];
  } catch { /* ignore */ }

  const editQuote: EditQuote = {
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    quoteReference: quote.referenceNumber,
    quoteDate: quote.quoteDate,
    expiryDate: quote.expiryDate,
    validityDays: quote.validityDays,
    customerType: quote.customerType,
    companyName: quote.customerType === 'lead' ? quote.lead?.companyName : quote.zohoCustomerName,
    contactName: quote.lead?.contactName ?? null,
    email: quote.lead?.email ?? null,
    phone: quote.lead?.phone ?? null,
    organizationId: quote.targetOrganization?.id ?? null,
    organizationName: quote.targetOrganization?.name ?? null,
    notesToCustomer: quote.notesToCustomer,
    termsAndConditions: quote.termsAndConditions,
    internalNotes: quote.internalNotes,
    items: quote.items
      .sort((a, b) => a.lineOrder - b.lineOrder)
      .map((i) => ({
        id: String(i.lineOrder),
        line_order: i.lineOrder,
        zoho_item_id: i.zohoItemId ?? undefined,
        item_name: i.itemName,
        item_description: i.itemDescription ?? '',
        hsn_or_sac: i.hsnOrSac ?? undefined,
        quantity: Number(i.quantity),
        unit_price: Number(i.unitPrice),
        cost_price: i.costPrice != null ? Number(i.costPrice) : 0,
        discount_percent: Number(i.discountPercent),
        tax_rate: Number(i.taxRate),
        is_subscription: i.isSubscription,
        billing_cycle: i.billingCycle ?? undefined,
        primary_domain: i.primaryDomain ?? undefined,
        domain_list: i.domainList ?? undefined,
        service_period_start: i.serviceStartDate ? i.serviceStartDate.split('T')[0] : '',
        service_period_end: i.serviceEndDate ? i.serviceEndDate.split('T')[0] : '',
      })),
  };

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Edit Quote</h1>
        <p className="text-sm text-slate-500 mt-0.5 font-mono">{quote.quoteNumber}</p>
      </div>
      <QuoteBuilder orgs={orgs} editQuote={editQuote} />
    </div>
  );
}
