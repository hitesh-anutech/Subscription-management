'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { updateLeadAction } from '../../actions';
import { INDIAN_STATES, gstCodeForState } from '@/lib/indian-states';

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold rounded-lg transition-colors">
      {pending ? 'Saving…' : 'Save Changes'}
    </button>
  );
}

interface Org { id: string; name: string }

interface Lead {
  id: string;
  companyName: string;
  contactName: string | null;
  email: string;
  phone: string | null;
  designation: string | null;
  primaryDomain: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  postalCode: string | null;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  gstin: string | null;
  gstTreatment: string | null;
  pan: string | null;
  industry: string | null;
  leadSource: string | null;
  status: string;
  estimatedValue: string | null;
  estimatedCloseDate: string | null;
  notes: string | null;
  targetOrganizationId: string | null;
}

interface Props {
  lead: Lead;
  orgs: Org[];
}

// Same 3 tabs as the New Lead form
const TABS = ['Contact', 'Address & GST', 'Other'] as const;
type Tab = typeof TABS[number];

export function EditLeadPanel({ lead, orgs }: Props) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('Contact');
  const [selectedState, setSelectedState] = useState(lead.state ?? '');

  const boundAction = updateLeadAction.bind(null, lead.id);
  const [state, action] = useFormState(
    async (_prev: { error?: string; success?: boolean } | null, fd: FormData) =>
      boundAction(_prev, fd),
    null,
  );

  if (state?.success && open) setOpen(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition-colors"
      >
        ✏️ Edit Lead
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Edit Lead — {lead.companyName}</h2>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-200 bg-slate-50">
              {TABS.map((tab) => (
                <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    activeTab === tab ? 'border-blue-500 text-blue-600 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}>
                  {tab}
                </button>
              ))}
            </div>

            <form action={action} className="flex-1 overflow-y-auto">
              <div className="p-6">
                {state?.error && (
                  <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{state.error}</div>
                )}

                {/* ── Tab 1: Contact (same as New Lead form) ── */}
                <div className={activeTab === 'Contact' ? 'block space-y-4' : 'hidden'}>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Organization</label>
                    <select name="target_organization_id" defaultValue={lead.targetOrganizationId ?? ''}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
                      <option value="">— No org assigned —</option>
                      {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Contact Name</label>
                      <input name="contact_name" defaultValue={lead.contactName ?? ''}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
                      <input name="email" type="email" defaultValue={lead.email}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                      <input name="phone" defaultValue={lead.phone ?? ''}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Company Name *</label>
                      <input name="company_name" defaultValue={lead.companyName} required
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Designation</label>
                      <input name="designation" defaultValue={lead.designation ?? ''}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Primary Domain</label>
                      <input name="primary_domain" defaultValue={lead.primaryDomain ?? ''}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Expected Close Date</label>
                      <input name="estimated_close_date" type="date" defaultValue={lead.estimatedCloseDate?.split('T')[0] ?? ''}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                      <select name="status" defaultValue={lead.status}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
                        {['New','Contacted','Quoted','Negotiating','Won','Lost','Archived'].map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* ── Tab 2: Address & GST (merged, same as New Lead form) ── */}
                <div className={activeTab === 'Address & GST' ? 'block' : 'hidden'}>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Address Line 1</label>
                      <input name="billing_address_line1" defaultValue={lead.billingAddressLine1 ?? ''}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Address Line 2</label>
                      <input name="billing_address_line2" defaultValue={lead.billingAddressLine2 ?? ''}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">City</label>
                      <input name="city" defaultValue={lead.city ?? ''}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">State</label>
                      {/* Canonical Zoho state names — avoids GST place-of-supply mismatch on push */}
                      <select name="state" value={selectedState}
                        onChange={(e) => setSelectedState(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
                        <option value="">— Select State —</option>
                        {INDIAN_STATES.map((s) => (
                          <option key={s.code} value={s.name}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">State Code (GST)</label>
                      {/* Auto-filled from selected state */}
                      <input type="text" value={gstCodeForState(selectedState)} readOnly placeholder="auto"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono bg-slate-50 text-slate-500 focus:outline-none" />
                      <input type="hidden" name="state_code" value={gstCodeForState(selectedState)} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Postal Code</label>
                      <input name="postal_code" defaultValue={lead.postalCode ?? ''}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">GSTIN</label>
                      <input name="gstin" defaultValue={lead.gstin ?? ''} placeholder="27AAAPL1234C1Z5"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">GST Treatment</label>
                      <select name="gst_treatment" defaultValue={lead.gstTreatment ?? (lead.gstin ? 'business_gst' : 'business_none')}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
                        <option value="business_gst">Registered Business (with GSTIN)</option>
                        <option value="business_none">Unregistered Business</option>
                        <option value="consumer">Consumer</option>
                        <option value="overseas">Overseas</option>
                        <option value="sez">SEZ</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* ── Tab 3: Other (same as New Lead form) ── */}
                <div className={activeTab === 'Other' ? 'block space-y-3' : 'hidden'}>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Industry</label>
                      <select name="industry" defaultValue={lead.industry ?? ''}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
                        <option value="">Select…</option>
                        {['IT Services','Manufacturing','Retail / E-commerce','Healthcare','Education','Finance / Banking','Real Estate','Consulting','Other'].map((i) => (
                          <option key={i} value={i}>{i}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Lead Source</label>
                      <select name="lead_source" defaultValue={lead.leadSource ?? ''}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
                        <option value="">Select…</option>
                        {['Referral','Website','Cold Call','LinkedIn','Trade Show','Partner','Inbound Inquiry','Other'].map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                    <textarea name="notes" rows={4} defaultValue={lead.notes ?? ''}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-y" />
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50">
                <div className="flex gap-2">
                  {activeTab !== 'Contact' && (
                    <button type="button" onClick={() => setActiveTab(TABS[TABS.indexOf(activeTab) - 1])}
                      className="px-3 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-white">← Back</button>
                  )}
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setOpen(false)}
                    className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-white">Cancel</button>
                  {activeTab !== 'Other' && (
                    <button type="button" onClick={() => setActiveTab(TABS[TABS.indexOf(activeTab) + 1])}
                      className="px-4 py-2 bg-slate-700 text-white text-sm font-semibold rounded-lg hover:bg-slate-800">Next →</button>
                  )}
                  <SaveBtn />
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
