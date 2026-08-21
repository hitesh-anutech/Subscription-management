'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { createLeadAction } from '../actions';
import { INDIAN_STATES, gstCodeForState } from '@/lib/indian-states';

interface Org { id: string; name: string }

function SubmitBtn({ label = 'Create Lead' }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold rounded-lg transition-colors">
      {pending ? 'Saving…' : label}
    </button>
  );
}

const TABS = ['Contact', 'Address & GST', 'Other'] as const;
type Tab = typeof TABS[number];

interface Props {
  orgs: Org[];
}

export function LeadForm({ orgs }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('Contact');
  const [selectedState, setSelectedState] = useState('');
  const [state, action] = useFormState(
    (_prev: { error?: string } | null, fd: FormData) => createLeadAction(_prev, fd),
    null,
  );

  return (
    <form action={action} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {state?.error && (
        <div className="px-5 py-3 bg-red-50 border-b border-red-200 text-red-700 text-sm">
          {state.error}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-slate-200 bg-slate-50">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? 'border-blue-500 text-blue-600 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="p-6">
        {/* ── Tab 1: Contact (shown first) ── */}
        <div className={activeTab === 'Contact' ? 'block' : 'hidden'}>
          <div className="space-y-4">

            {/* Organization selector — first field */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Zoho Organization *
                <span className="ml-1.5 text-xs text-slate-400 font-normal">यह lead किस org से है?</span>
              </label>
              <select
                name="target_organization_id"
                required
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">— Select Organization —</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              {orgs.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  कोई organization नहीं — पहले{' '}
                  <a href="/dashboard/settings/organizations" className="underline">Settings → Organizations</a>{' '}
                  में add करो।
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Contact Name</label>
                <input
                  name="contact_name"
                  placeholder="Rajesh Kumar"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Email Address *</label>
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="rajesh@abctech.in"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Phone</label>
                <input
                  name="phone"
                  placeholder="+91 98765 43210"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Company Name</label>
                <input
                  name="company_name"
                  placeholder="ABC Technologies Pvt Ltd"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Designation</label>
                <input
                  name="designation"
                  placeholder="IT Manager"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Primary Domain</label>
                <input
                  name="primary_domain"
                  placeholder="abctech.in"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Expected Close Date</label>
                <input
                  name="estimated_close_date"
                  type="date"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Tab 2: Address & GST (merged) ── */}
        <div className={activeTab === 'Address & GST' ? 'block' : 'hidden'}>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Address Line 1</label>
              <input
                name="billing_address_line1"
                placeholder="Office No. 101, ABC Tower"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Address Line 2</label>
              <input
                name="billing_address_line2"
                placeholder="Andheri East"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">City</label>
              <input name="city" placeholder="Mumbai" className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">State</label>
              {/* Canonical Zoho state names — avoids GST place-of-supply mismatch on push */}
              <select
                name="state"
                value={selectedState}
                onChange={(e) => setSelectedState(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Select State —</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">State Code (GST)</label>
              {/* Auto-filled from the selected state (read-only); submitted via hidden input */}
              <input
                type="text"
                value={gstCodeForState(selectedState)}
                readOnly
                placeholder="auto"
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm font-mono bg-slate-50 text-slate-500 focus:outline-none"
              />
              <input type="hidden" name="state_code" value={gstCodeForState(selectedState)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Postal Code</label>
              <input name="postal_code" placeholder="400069" className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            {/* GSTIN after address */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">GSTIN</label>
              <input
                name="gstin"
                placeholder="27AAAPL1234C1Z5"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-400 mt-1">पहले 2 digits = state code (e.g. 27 = Maharashtra)</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">GST Treatment</label>
              <select
                name="gst_treatment"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="business_gst">Registered Business (with GSTIN)</option>
                <option value="business_none">Unregistered Business</option>
                <option value="consumer">Consumer</option>
                <option value="overseas">Overseas</option>
                <option value="sez">SEZ</option>
              </select>
            </div>

          </div>
        </div>

        {/* ── Tab 3: Other ── */}
        <div className={activeTab === 'Other' ? 'block' : 'hidden'}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Industry</label>
                <select name="industry" className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select…</option>
                  {['IT Services', 'Manufacturing', 'Retail / E-commerce', 'Healthcare', 'Education', 'Finance / Banking', 'Real Estate', 'Consulting', 'Other'].map((i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Lead Source</label>
                <select name="lead_source" className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select…</option>
                  {['Referral', 'Website', 'Cold Call', 'LinkedIn', 'Trade Show', 'Partner', 'Inbound Inquiry', 'Other'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes</label>
              <textarea
                name="notes"
                rows={4}
                placeholder="Lead के बारे में कोई additional जानकारी…"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer — navigation + submit */}
      <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
        <div className="flex gap-2">
          {activeTab !== 'Contact' && (
            <button type="button"
              onClick={() => setActiveTab(TABS[TABS.indexOf(activeTab) - 1])}
              className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-white transition-colors">
              ← Back
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <a href="/dashboard/leads"
            className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-white transition-colors">
            Cancel
          </a>
          {activeTab !== 'Other' ? (
            <button type="button"
              onClick={() => setActiveTab(TABS[TABS.indexOf(activeTab) + 1])}
              className="px-5 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg transition-colors">
              Next →
            </button>
          ) : null}
          {/* Submit always visible */}
          <SubmitBtn />
        </div>
      </div>
    </form>
  );
}
