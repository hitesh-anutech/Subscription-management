import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { QuoteBuilder } from '../_components/quote-builder';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New Quote' };

interface Org { id: string; name: string; zohoOrgId: string }
interface Lead {
  id: string;
  leadNumber: string;
  companyName: string;
  email: string;
  contactName: string | null;
  phone: string | null;
  targetOrganizationId: string | null;
  convertedToZohoCustomerId: string | null;
}

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{
    lead_id?: string;
    customer_id?: string;
    org_id?: string;
    mode?: string;
    subscription_id?: string;
    subscription_ids?: string;
  }>;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let orgs: Org[] = [];
  let preselectedLead: Lead | null = null;
  let preselectedCustomer: { zohoId: string; displayName: string; orgId: string } | null = null;
  let prefilledItems: any[] = [];
  let isRenewalMode = false;

  try {
    const data = await api.get<{ organizations: Org[] }>('/organizations');
    orgs = (data.organizations ?? []).filter((o: Org & { isActive?: boolean; connectionStatus?: string }) =>
      o.isActive !== false && o.connectionStatus !== 'disconnected',
    );
  } catch { /* show empty */ }

  const subIdsStr = params.subscription_id || params.subscription_ids || '';
  if (subIdsStr) {
    isRenewalMode = true;
    try {
      const renewalData = await api.get<{
        organizationId: string;
        zohoCustomerId: string;
        zohoCustomerName: string;
        items: any[];
      }>(`/subscriptions/prefill-renewal-quote?ids=${encodeURIComponent(subIdsStr)}`);

      if (renewalData) {
        preselectedCustomer = {
          zohoId: renewalData.zohoCustomerId,
          displayName: renewalData.zohoCustomerName,
          orgId: renewalData.organizationId,
        };
        prefilledItems = renewalData.items;
      }
    } catch (err) {
      console.error('Error prefilling renewal quote:', err);
    }
  } else if (params.lead_id) {
    try {
      preselectedLead = await api.get<Lead>(`/leads/${params.lead_id}`);
    } catch { /* ignore */ }
  } else if (params.customer_id && params.org_id) {
    try {
      const res = await api.get<{ customer: { displayName: string | null } | null }>(
        `/organizations/${params.org_id}/customers/${params.customer_id}`
      );
      if (res?.customer) {
        preselectedCustomer = {
          zohoId: params.customer_id,
          displayName: res.customer.displayName ?? 'Customer',
          orgId: params.org_id,
        };
      }
    } catch { /* ignore */ }
  }

  // Billing-period options are loaded client-side per selected org (mapped from Zoho).
  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">New Quick Quote</h1>
        <p className="text-sm text-slate-500 mt-0.5">Existing customer या New lead के लिए quote बनाओ</p>
      </div>
      <QuoteBuilder
        orgs={orgs}
        preselectedLead={preselectedLead}
        preselectedCustomer={preselectedCustomer}
        prefilledItems={prefilledItems}
        isRenewalMode={isRenewalMode}
      />
    </div>
  );
}
