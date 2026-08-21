import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { LeadStatusBadge } from '../_components/lead-status-badge';
import { ConvertLeadPanel } from './_components/convert-lead-panel';
import { EditLeadPanel } from './_components/edit-lead-panel';
import { SyncZohoButton } from './_components/sync-zoho-button';
import { getCurrentUser } from '@/lib/auth';
import { DeleteLeadButton } from '../_components/delete-lead-button';
import { HistoryDialog } from '@/components/history-dialog';

export const dynamic = 'force-dynamic';

interface Org { id: string; name: string; isActive: boolean }

interface Lead {
  id: string;
  leadNumber: string;
  companyName: string;
  contactName: string | null;
  email: string;
  phone: string | null;
  designation: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  postalCode: string | null;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  gstin: string | null;
  gstTreatment: string | null;
  pan: string | null;
  primaryDomain: string | null;
  industry: string | null;
  leadSource: string | null;
  status: string;
  notes: string | null;
  estimatedValue: string | null;
  estimatedCloseDate: string | null;
  targetOrganizationId: string | null;
  convertedToZohoCustomerId: string | null;
  createdAt: string;
  quickQuotes: Array<{ id: string; quoteNumber: string; status: string; totalAmount: string; createdAt: string }>;
  conversions?: Array<{ zohoCustomerId: string; convertedAt: string }>;
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const currentUser = await getCurrentUser();
  const isAdmin = currentUser?.role === 'Admin';
  
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let lead: Lead;
  let orgs: Org[] = [];
  try {
    const [leadData, orgsData] = await Promise.all([
      api.get<Lead>(`/leads/${id}`),
      api.get<{ organizations: Org[] }>('/organizations'),
    ]);
    lead = leadData;
    orgs = (orgsData.organizations ?? []).filter((o) => o.isActive !== false);
  } catch {
    try {
      lead = await api.get<Lead>(`/leads/${id}`);
    } catch {
      notFound();
    }
  }

  const assignedOrg = orgs.find((o) => o.id === lead.targetOrganizationId);
  const acceptedQuotes = lead.quickQuotes.filter((q) => q.status === 'Accepted');
  const hasQuotes = lead.quickQuotes.length > 0;
  // Converted = the durable customer link exists, not just the status — a later
  // quote-accept used to overwrite status 'Converted' → 'Won', which made an
  // already-converted lead show the Convert panel again (BUG-019).
  const isConverted = lead.status === 'Converted' || !!lead.convertedToZohoCustomerId;

  // Determine primary next action
  const nextAction =
    isConverted ? null :
    acceptedQuotes.length > 0 ? 'convert' :
    hasQuotes ? 'follow_up' : 'quote';

  return (
    <div className="max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1 text-sm text-slate-400">
            <Link href="/dashboard/leads" className="hover:text-slate-600">← Leads</Link>
            <span>/</span>
            <span className="font-mono">{lead.leadNumber}</span>
            {assignedOrg && (
              <>
                <span>/</span>
                <span className="text-blue-600">{assignedOrg.name}</span>
              </>
            )}
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{lead.companyName}</h1>
          <div className="flex items-center gap-3 mt-1">
            <LeadStatusBadge status={lead.status} />
            {lead.primaryDomain && <span className="text-sm text-slate-500 font-mono">{lead.primaryDomain}</span>}
            <HistoryDialog entityType="lead" entityId={lead.id} title={`Lead History: ${lead.companyName}`} />
          </div>
        </div>

        {/* Header action buttons — Edit always visible */}
        <div className="flex gap-2">
          <EditLeadPanel
            lead={{
              id: lead.id,
              companyName: lead.companyName,
              contactName: lead.contactName,
              email: lead.email,
              phone: lead.phone,
              designation: lead.designation,
              primaryDomain: lead.primaryDomain,
              city: lead.city,
              state: lead.state,
              stateCode: lead.stateCode,
              postalCode: lead.postalCode,
              billingAddressLine1: lead.billingAddressLine1,
              billingAddressLine2: lead.billingAddressLine2,
              gstin: lead.gstin,
              gstTreatment: lead.gstTreatment,
              pan: lead.pan,
              industry: lead.industry,
              leadSource: lead.leadSource,
              status: lead.status,
              estimatedValue: lead.estimatedValue,
              estimatedCloseDate: lead.estimatedCloseDate,
              notes: lead.notes,
              targetOrganizationId: lead.targetOrganizationId,
            }}
            orgs={orgs}
          />
          {!isConverted && (
            <Link
              href={`/dashboard/quick-quotes/new?lead_id=${lead.id}`}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg"
            >
              + New Quote
            </Link>
          )}
          {isConverted && (
            <>
              <SyncZohoButton leadId={lead.id} />
              {/* Internal customer page (the old direct books.zoho.in link 404'd — no org id in URL, BUG-006 pattern) */}
              {(lead.convertedToZohoCustomerId || lead.conversions?.[0]?.zohoCustomerId) && (
                <Link
                  href={`/dashboard/customers/${lead.convertedToZohoCustomerId ?? lead.conversions![0].zohoCustomerId}${lead.targetOrganizationId ? `?org_id=${lead.targetOrganizationId}` : ''}`}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg"
                >
                  View Customer →
                </Link>
              )}
              <Link
                href={`/dashboard/quick-quotes/new?lead_id=${lead.id}`}
                className="px-4 py-2 border border-blue-300 text-blue-700 hover:bg-blue-50 text-sm font-semibold rounded-lg"
              >
                + New Quote
              </Link>
            </>
          )}
        </div>
      </div>

      {/* ── Smart Next-Step Banner ── */}
      {nextAction === 'quote' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-blue-800">अगला कदम: Quote भेजो</p>
            <p className="text-sm text-blue-600 mt-0.5">
              Lead add हो गई — अब {lead.companyName} को quote भेजो।
            </p>
          </div>
          <Link
            href={`/dashboard/quick-quotes/new?lead_id=${lead.id}`}
            className="shrink-0 ml-4 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            📄 Create Quote →
          </Link>
        </div>
      )}

      {nextAction === 'convert' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-emerald-800">Quote Accept हो गई!</p>
            <p className="text-sm text-emerald-600 mt-0.5">
              अब Zoho में customer create करो और subscription activate करो।
            </p>
          </div>
          <span className="text-sm text-emerald-600 shrink-0 ml-4">↓ नीचे Convert panel देखो</span>
        </div>
      )}

      {nextAction === 'follow_up' && hasQuotes && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-amber-800">Quote भेजी गई — follow up करो</p>
            <p className="text-sm text-amber-600 mt-0.5">Customer response का इंतजार है।</p>
          </div>
          <Link
            href={`/dashboard/quick-quotes/${lead.quickQuotes[0].id}`}
            className="shrink-0 ml-4 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg"
          >
            View Latest Quote →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-3 gap-5">
        {/* Contact Info */}
        <div className="col-span-2 space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4">Contact Details</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Contact Name"  value={lead.contactName} />
              <Field label="Designation"   value={lead.designation} />
              <Field label="Email"         value={lead.email} />
              <Field label="Phone"         value={lead.phone} />
              <Field label="Primary Domain" value={lead.primaryDomain} mono />
              <Field label="Lead Source"   value={lead.leadSource} />
              <Field label="Industry"      value={lead.industry} />
              <Field label="Organization"  value={assignedOrg?.name ?? '—'} />
            </div>
          </div>

          {(lead.gstin || lead.pan || lead.city || lead.state) && (
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4">GST & Address</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label="GSTIN" value={lead.gstin} mono />
                <Field label="PAN"   value={lead.pan}   mono />
                <Field label="City"  value={lead.city} />
                <Field label="State" value={lead.state ? `${lead.state}${lead.stateCode ? ` (${lead.stateCode})` : ''}` : null} />
                <Field label="Address" value={[lead.billingAddressLine1, lead.billingAddressLine2].filter(Boolean).join(', ')} />
                <Field label="Postal Code" value={lead.postalCode} mono />
              </div>
            </div>
          )}

          {lead.notes && (
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Notes</h2>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{lead.notes}</p>
            </div>
          )}
        </div>

        {/* Right sidebar — Stats + Actions */}
        <div className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-medium text-slate-500 mb-1">Est. Value</div>
            <div className="text-xl font-bold text-slate-800">
              {lead.estimatedValue ? `₹${Number(lead.estimatedValue).toLocaleString('en-IN')}` : '—'}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-medium text-slate-500 mb-1">Quotes</div>
            <div className="text-xl font-bold text-slate-800">{lead.quickQuotes.length}</div>
          </div>

          {!isConverted && (
            <ConvertLeadPanel
              leadId={lead.id}
              organizationId={lead.targetOrganizationId}
              acceptedQuotes={acceptedQuotes}
            />
          )}

          {isConverted && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm">
              <p className="font-semibold text-green-800">✅ Converted to Customer</p>
              <p className="text-xs mt-1 text-green-600">Zoho Books में customer बन गया।</p>
              <Link
                href="/dashboard/subscriptions"
                className="mt-2 block text-xs text-green-700 underline"
              >
                Subscriptions देखो →
              </Link>
            </div>
          )}

          {/* Quick action: create new quote (shown in sidebar too) */}
          {!isConverted && !hasQuotes && (
            <Link
              href={`/dashboard/quick-quotes/new?lead_id=${lead.id}`}
              className="block w-full text-center px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              📄 Create First Quote
            </Link>
          )}
        </div>
      </div>

      {/* Quotes table */}
      {hasQuotes && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="font-semibold text-sm text-slate-700">Quotes ({lead.quickQuotes.length})</span>
            <Link
              href={`/dashboard/quick-quotes/new?lead_id=${lead.id}`}
              className="text-xs text-blue-600 hover:underline"
            >
              + New Quote
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Quote #</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Status</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">Amount</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Date</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lead.quickQuotes.map((q) => (
                <tr key={q.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{q.quoteNumber}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      q.status === 'Accepted'      ? 'bg-green-100 text-green-700' :
                      q.status === 'Pushed_To_Zoho'? 'bg-blue-100 text-blue-700'  :
                      q.status === 'Sent'          ? 'bg-amber-100 text-amber-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>{q.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-700">₹{Number(q.totalAmount).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{new Date(q.createdAt).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/dashboard/quick-quotes/${q.id}`} className="text-blue-600 hover:underline text-xs">View →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500 mb-0.5">{label}</div>
      <div className={`text-slate-800 ${mono ? 'font-mono text-xs' : 'text-sm'}`}>{value || '—'}</div>
    </div>
  );
}
