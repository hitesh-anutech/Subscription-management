'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useFormState, useFormStatus, flushSync } from 'react-dom';
import { createQuoteAction, updateQuoteAction } from '../actions';
import { ZohoCustomerSearchAllOrgs, ZohoItemSearch } from './zoho-search';
import { extractApiError } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

interface Org  { id: string; name: string }
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

interface BillingOption { value: string; label: string }   // value = BillingCycle enum, label = Zoho label

interface LineItem {
  id: string;
  line_order: number;
  zoho_item_id?: string;
  item_name: string;
  item_description?: string;
  hsn_or_sac?: string;
  quantity: number;
  unit_price: number;
  cost_price?: number;
  discount_percent: number;
  tax_rate: number;
  is_subscription: boolean;   // true = subscription (default), false = one-time
  billing_cycle?: string;
  primary_domain?: string;
  service_period_start?: string; // yyyy-mm-dd — subscription service start
  service_period_end?: string;   // yyyy-mm-dd — subscription service end
  /** Bulk-domains mode: textarea list ("domain[, qty]" per line) instead of the single Domain input */
  bulk_domains?: boolean;
  bulk_domains_text?: string;
  domain_list?: Array<{ domain: string; qty?: number }>; // from edit-mode load
  renewed_subscription_id?: string;
}

/** Parse the bulk-domains textarea: one "domain[, qty]" per line → [{domain, qty}]. */
function parseDomainList(text: string): Array<{ domain: string; qty: number }> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [domain, qtyRaw] = line.split(',').map((s) => s.trim());
      const qty = qtyRaw ? parseInt(qtyRaw, 10) : 1;
      return { domain, qty: Number.isFinite(qty) && qty > 0 ? qty : 1 };
    })
    .filter((d) => d.domain.length > 0);
}

function calcItem(item: LineItem) {
  const sub = item.quantity * item.unit_price;
  const disc = sub * (item.discount_percent / 100);
  const taxable = sub - disc;
  const tax = taxable * (item.tax_rate / 100);
  return { sub, disc, tax, total: taxable + tax };
}

function SubmitBtn({ isEdit, disabled }: { isEdit?: boolean; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled}
      title={disabled ? 'Subscription items me Subscription/Service Period aur Cost Price bharein' : undefined}
      className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-lg">
      {pending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Quote'}
    </button>
  );
}

/** Existing quote being edited (Draft only — customer/org/number/dates are locked server-side). */
export interface EditQuote {
  id: string;
  quoteNumber: string;
  quoteReference?: string | null;
  quoteDate?: string | null;
  expiryDate?: string | null;
  validityDays?: number | null;
  customerType: 'lead' | 'existing';
  companyName?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  organizationId?: string | null;
  organizationName?: string | null;
  notesToCustomer?: string | null;
  termsAndConditions?: string | null;
  internalNotes?: string | null;
  items: LineItem[];
}

export function QuoteBuilder({
  orgs, preselectedLead, editQuote, preselectedCustomer, prefilledItems = [], isRenewalMode = false,
}: {
  orgs: Org[];
  preselectedLead?: Lead | null;
  editQuote?: EditQuote | null;
  preselectedCustomer?: { zohoId: string; displayName: string; orgId: string } | null;
  prefilledItems?: LineItem[];
  isRenewalMode?: boolean;
}) {
  const isEdit = !!editQuote;
  const [state, action] = useFormState(
    isEdit
      ? (_prev: { error?: string } | null, fd: FormData) => updateQuoteAction(editQuote!.id, _prev, fd)
      : (_prev: { error?: string } | null, fd: FormData) => createQuoteAction(_prev, fd),
    null,
  );

  const [billingOptions, setBillingOptions] = useState<BillingOption[]>([]);

  const today  = new Date().toISOString().split('T')[0];
  const plus15 = (() => { const d = new Date(); d.setDate(d.getDate() + 15); return d.toISOString().split('T')[0]; })();

  const isConvertedLead = !!(preselectedLead?.convertedToZohoCustomerId);
  const [customerType, setCustomerType] = useState<'lead' | 'existing'>(
    editQuote?.customerType ?? (preselectedCustomer ? 'existing' : (isConvertedLead ? 'existing' : 'lead'))
  );
  const [selectedLead, setSelectedLead] = useState<Lead | null>(isConvertedLead ? null : (preselectedLead ?? null));
  const [zohoCustomerId, setZohoCustomerId] = useState(
    preselectedCustomer ? preselectedCustomer.zohoId : (isConvertedLead ? (preselectedLead!.convertedToZohoCustomerId ?? '') : '')
  );
  const [zohoCustomerName, setZohoCustomerName] = useState(
    editQuote?.customerType === 'existing' ? (editQuote?.companyName ?? '') :
    preselectedCustomer ? preselectedCustomer.displayName :
    isConvertedLead ? (preselectedLead!.companyName ?? '') : '',
  );
  const [selectedOrgId, setSelectedOrgId] = useState(
    editQuote?.organizationId ?? preselectedCustomer?.orgId ?? preselectedLead?.targetOrganizationId ?? orgs[0]?.id ?? ''
  );
  const [items, setItems] = useState<LineItem[]>(
    prefilledItems && prefilledItems.length ? prefilledItems.map((i, idx) => ({
      ...i,
      id: i.id || Math.random().toString(36).slice(2),
      line_order: idx + 1,
    })) :
    editQuote && editQuote.items.length ? editQuote.items.map((i, idx) => ({
      ...i,
      id: Math.random().toString(36).slice(2),
      line_order: idx + 1,
      // Reconstruct the bulk-domains textarea from the saved list (edit mode)
      bulk_domains: (i.domain_list?.length ?? 0) > 0,
      bulk_domains_text: (i.domain_list ?? []).map((d) => (d.qty && d.qty !== 1 ? `${d.domain}, ${d.qty}` : d.domain)).join('\n'),
    })) : [newItem(1)],
  );
  const [custCompany, setCustCompany] = useState(editQuote?.companyName ?? preselectedLead?.companyName ?? '');
  const [custContact, setCustContact] = useState(editQuote?.contactName ?? preselectedLead?.contactName ?? '');
  const [custEmail,   setCustEmail]   = useState(editQuote?.email ?? preselectedLead?.email ?? '');
  const [custPhone,   setCustPhone]   = useState(editQuote?.phone ?? preselectedLead?.phone ?? '');
  // Mode B (Lead) — always-visible required fields
  const [custState,   setCustState]   = useState('');
  const [custCountry, setCustCountry] = useState('India');
  // Mode B (Lead) — "More Details" (collapsed by default)
  const [showMoreLead, setShowMoreLead] = useState(false);
  const [custGstin,    setCustGstin]    = useState('');
  const [custAddress1, setCustAddress1] = useState('');
  const [custAddress2, setCustAddress2] = useState('');
  const [custAddress3, setCustAddress3] = useState('');
  const [custCity,     setCustCity]     = useState('');
  const [custPostal,   setCustPostal]   = useState('');
  const [quoteDate,   setQuoteDate]   = useState(editQuote?.quoteDate?.split('T')[0] ?? today);
  const [expiryDate,  setExpiryDate]  = useState(editQuote?.expiryDate?.split('T')[0] ?? plus15);
  const [creatingLead, setCreatingLead] = useState(false);
  const [leadFormError, setLeadFormError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Load billing-period options for the selected org (mapped from Zoho)
  useEffect(() => {
    if (!selectedOrgId) { setBillingOptions([]); return; }
    let cancelled = false;
    fetch(`${API_BASE}/organizations/${selectedOrgId}/billing-options`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d: { options?: BillingOption[] }) => { if (!cancelled) setBillingOptions(d.options ?? []); })
      .catch(() => { if (!cancelled) setBillingOptions([]); });
    return () => { cancelled = true; };
  }, [selectedOrgId]);

  /** Create a Lead from the inline Mode B fields; returns the lead or null (error set). */
  const createLeadFromForm = async (): Promise<Lead | null> => {
    setLeadFormError(null);
    if (!custCompany.trim() || !custEmail.trim() || !custState.trim() || !custCountry.trim()) {
      setLeadFormError('Company, Email, State aur Country zaroori hain.');
      return null;
    }
    setCreatingLead(true);
    try {
      const res = await fetch(`${API_BASE}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          company_name:           custCompany.trim(),
          contact_name:           custContact.trim() || undefined,
          email:                  custEmail.trim(),
          phone:                  custPhone.trim() || undefined,
          state:                  custState.trim() || undefined,
          country:                custCountry.trim() || undefined,
          gstin:                  custGstin.trim() || undefined,
          billing_address_line1:  custAddress1.trim() || undefined,
          // Zoho contact billing address supports 2 lines — fold Line 2 + Line 3 into line2.
          billing_address_line2:  [custAddress2.trim(), custAddress3.trim()].filter(Boolean).join(', ') || undefined,
          city:                   custCity.trim() || undefined,
          postal_code:            custPostal.trim() || undefined,
          target_organization_id: selectedOrgId || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setLeadFormError(extractApiError(body, 'Lead create नहीं हो पाया'));
        return null;
      }
      return await res.json() as Lead;
    } catch {
      setLeadFormError('Server से connect नहीं हो पाया');
      return null;
    } finally {
      setCreatingLead(false);
    }
  };

  /**
   * Unified submit: for a new lead (Mode B, no existing lead attached) create the
   * lead first from the inline fields, then submit the quote with its id. flushSync
   * ensures the hidden lead_id input carries the new id before requestSubmit re-runs.
   */
  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (isEdit) return;                                   // edit: customer locked
    if (customerType !== 'lead') return;                  // existing customer → normal submit
    if (selectedLead) return;                             // lead already attached → normal submit
    e.preventDefault();
    void (async () => {
      const lead = await createLeadFromForm();
      if (!lead) return;
      flushSync(() => {
        setSelectedLead(lead);
        if (lead.targetOrganizationId) setSelectedOrgId(lead.targetOrganizationId);
      });
      formRef.current?.requestSubmit();
    })();
  };

  const totals = items.reduce(
    (acc, item) => {
      const c = calcItem(item);
      return { sub: acc.sub + c.sub, disc: acc.disc + c.disc, tax: acc.tax + c.tax, total: acc.total + c.total };
    },
    { sub: 0, disc: 0, tax: 0, total: 0 },
  );

  // Subscription items need a Subs. Period at quote time.
  // (Domain, service dates and cost price are collected later at the Convert/Push step.)
  const incompleteSubItems = items.filter((i) => i.is_subscription && !i.billing_cycle);
  const hasIncompleteSubItems = incompleteSubItems.length > 0;

  const addItem = useCallback(() => {
    setItems((prev) => [...prev, newItem(prev.length + 1)]);
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id).map((i, idx) => ({ ...i, line_order: idx + 1 })));
  }, []);

  const updateItem = useCallback((id: string, field: keyof LineItem, value: unknown) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
  }, []);

  return (
    <>
    <form ref={formRef} action={action} onSubmit={handleFormSubmit} className="space-y-5">
      {state?.error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{state.error}</div>
      )}
      {leadFormError && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{leadFormError}</div>
      )}
      {hasIncompleteSubItems && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
          ⚠️ Subscription items ke liye <b>Subs. Period</b> select karna zaroori hai. Domain, dates aur cost baad me Convert/Push step par bhare jayenge. {incompleteSubItems.length} item(s) abhi incomplete hain.
        </div>
      )}

      {/* Hidden fields */}
      <input type="hidden" name="customer_type" value={customerType} />
      <input type="hidden" name="lead_id" value={selectedLead?.id ?? ''} />
      <input type="hidden" name="zoho_customer_id" value={zohoCustomerId} />
      <input type="hidden" name="zoho_customer_name" value={customerType === 'lead' ? custCompany : zohoCustomerName} />
      <input type="hidden" name="target_organization_id" value={selectedOrgId} />
      <input type="hidden" name="quote_date" value={quoteDate} />
      <input type="hidden" name="expiry_date" value={expiryDate} />
      <input type="hidden" name="validity_days" value={editQuote?.validityDays ?? 15} />
      <input type="hidden" name="is_intra_state" value="true" />
      <input type="hidden" name="cgst_rate" value="9" />
      <input type="hidden" name="sgst_rate" value="9" />
      <input type="hidden" name="items_json" value={JSON.stringify(items.map((i) => ({
        line_order: i.line_order,
        zoho_item_id: i.zoho_item_id,
        item_name: i.item_name,
        item_description: i.item_description || undefined,
        hsn_or_sac: i.hsn_or_sac,
        quantity: i.quantity,
        unit_price: i.unit_price,
        cost_price: i.cost_price ?? 0,
        discount_percent: i.discount_percent,
        tax_rate: i.tax_rate,
        is_subscription: i.is_subscription,
        billing_cycle: i.billing_cycle,
        // Domain is optional at quote time; if filled it prefills the Convert
        // modal's Domain field. Service dates stay Convert-step-only.
        // Bulk mode: the parsed list is sent; the first domain doubles as primary.
        primary_domain: i.bulk_domains
          ? parseDomainList(i.bulk_domains_text ?? '')[0]?.domain
          : i.primary_domain?.trim() || undefined,
        domain_list: i.bulk_domains
          ? (() => { const l = parseDomainList(i.bulk_domains_text ?? ''); return l.length ? l : undefined; })()
          : undefined,
        renewed_subscription_id: i.renewed_subscription_id || undefined,
      })))} />

      {isEdit && (
        <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-lg">
          ✏️ Draft quote edit — items, pricing aur notes/terms editable hain. Customer, organization aur dates locked hain (Zoho consistency ke liye).
        </div>
      )}

      {/* ── Customer ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">1. Customer</h2>

        {/* Two-mode selector cards (hidden when editing or in renewal mode — customer is locked) */}
        {!isEdit && !isRenewalMode && (
          <div className="grid grid-cols-2 gap-3">
            <button type="button"
              onClick={() => { setCustomerType('lead'); setZohoCustomerId(''); setZohoCustomerName(''); }}
              className={`text-left rounded-lg p-3 border-2 transition-colors ${customerType === 'lead' ? 'border-amber-500 bg-amber-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`font-semibold text-sm ${customerType === 'lead' ? 'text-amber-900' : 'text-slate-700'}`}>🎯 New Customer (Lead)</span>
                <span className="bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 rounded font-medium">Type 1 · Lead</span>
              </div>
              <div className="text-xs text-slate-600">Naya customer — neeche form bharein, quote bante hi Lead create ho jayega.</div>
            </button>
            <button type="button"
              onClick={() => { setCustomerType('existing'); setSelectedLead(null); }}
              className={`text-left rounded-lg p-3 border-2 transition-colors ${customerType === 'existing' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`font-semibold text-sm ${customerType === 'existing' ? 'text-blue-900' : 'text-slate-700'}`}>🏢 Existing Customer</span>
                <span className="bg-blue-100 text-blue-800 text-[10px] px-2 py-0.5 rounded font-medium">Type 2 · Cross-sell</span>
              </div>
              <div className="text-xs text-slate-600">Customer Zoho me maujood hai — Zoho cache se search karke quote banayein.</div>
            </button>
          </div>
        )}

        {/* Mode-specific customer section */}
        {isEdit ? (
          <div>
            <label className="text-xs font-medium text-slate-600">Customer (locked)</label>
            <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
              <div className="col-span-2 px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700">{custCompany || '—'}</div>
              <div className="px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-500">{custContact || '—'}</div>
              <div className="px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-500">{custEmail || '—'}</div>
            </div>
          </div>
        ) : customerType === 'lead' ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-600">Lead Details</label>
              {!selectedLead ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">Existing lead attach karein:</span>
                  <LeadSearch onSelect={(lead) => {
                    setSelectedLead(lead);
                    setCustCompany(lead.companyName);
                    setCustContact(lead.contactName ?? '');
                    setCustEmail(lead.email);
                    setCustPhone(lead.phone ?? '');
                    if (lead.targetOrganizationId) setSelectedOrgId(lead.targetOrganizationId);
                  }} />
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="font-mono">{selectedLead.leadNumber}</span>
                  <button type="button" onClick={() => setSelectedLead(null)} className="hover:text-red-500">✕ Change</button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Company Name <span className="text-red-500">*</span></label>
                <input value={custCompany} onChange={(e) => setCustCompany(e.target.value)}
                  placeholder="ABC Technologies Pvt Ltd"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Contact Name</label>
                <input value={custContact} onChange={(e) => setCustContact(e.target.value)}
                  placeholder="Rajesh Kumar"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email <span className="text-red-500">*</span></label>
                <input value={custEmail} onChange={(e) => setCustEmail(e.target.value)}
                  placeholder="rajesh@abctech.in" type="email"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                <input value={custPhone} onChange={(e) => setCustPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">State <span className="text-red-500">*</span></label>
                <input value={custState} onChange={(e) => setCustState(e.target.value)}
                  placeholder="Maharashtra"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Country <span className="text-red-500">*</span></label>
                <input value={custCountry} onChange={(e) => setCustCountry(e.target.value)}
                  placeholder="India"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            {/* More Details (collapsed by default) */}
            <div className="mt-3">
              <button type="button" onClick={() => setShowMoreLead((v) => !v)}
                className="text-xs font-medium text-blue-600 hover:text-blue-800">
                {showMoreLead ? '▾ Hide details' : '▸ More Details (Billing Address, GSTIN)'}
              </button>
              {showMoreLead && (
                <div className="mt-2 grid grid-cols-2 gap-4">
                  {/* Left — Billing Address */}
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-600">Billing Address</label>
                    <input value={custAddress1} onChange={(e) => setCustAddress1(e.target.value)}
                      placeholder="Address Line 1"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input value={custAddress2} onChange={(e) => setCustAddress2(e.target.value)}
                      placeholder="Line 2"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input value={custAddress3} onChange={(e) => setCustAddress3(e.target.value)}
                      placeholder="Line 3"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  {/* Right — GSTIN, City, Postal Code */}
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">GSTIN</label>
                      <input value={custGstin} onChange={(e) => setCustGstin(e.target.value)}
                        placeholder="27AAAPL1234C1Z5"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">City</label>
                      <input value={custCity} onChange={(e) => setCustCity(e.target.value)}
                        placeholder="Mumbai"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Postal Code</label>
                      <input value={custPostal} onChange={(e) => setCustPostal(e.target.value)}
                        placeholder="400093"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              Customer
              <span className="ml-1.5 font-normal text-slate-400">सभी orgs में search करो — org अपने आप set होगा</span>
            </label>
            {/* Cross-org search: picking a customer auto-sets + locks the quote's org
                (Zoho customer IDs are org-specific — BUG-017 prevention). */}
            <ZohoCustomerSearchAllOrgs
              onSelect={(c) => {
                setZohoCustomerId(c.zohoId);
                setZohoCustomerName(c.name);
                setSelectedOrgId(c.orgId);
              }}
            />
            {zohoCustomerId && (
              <div className="flex items-center justify-between mt-2 p-2.5 bg-green-50 border border-green-200 rounded-lg text-sm">
                <div>
                  <span className="font-medium text-green-800">{zohoCustomerName}</span>
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
                    {orgs.find((o) => o.id === selectedOrgId)?.name ?? ''}
                  </span>
                  <span className="ml-2 font-mono text-xs text-green-600">{zohoCustomerId}</span>
                </div>
                {!isRenewalMode && (
                  <button type="button" onClick={() => { setZohoCustomerId(''); setZohoCustomerName(''); }}
                    className="text-green-400 hover:text-green-600 text-xs">✕</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Quote Details ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <h2 className="text-sm font-semibold text-slate-700">2. Quote Details</h2>

        {/* Row 1 — Organization + Quote Number + Quote Reference */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Organization
              {customerType === 'lead' && !selectedLead && !isEdit && (
                <span className="ml-1 font-normal text-slate-400">(is org me Lead + Quote banega)</span>
              )}
            </label>
            {(customerType === 'lead' && (selectedLead || isEdit)) || (customerType === 'existing' && zohoCustomerId) ? (
              // Locked: attached lead / edit mode / existing customer picked
              // (existing customer → org auto-derives from the pick; Zoho customer
              //  IDs are org-specific — BUG-017 prevention)
              <div className="px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-sm text-slate-700 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                {orgs.find((o) => o.id === selectedOrgId)?.name ?? 'No org assigned'}
                {customerType === 'existing' && zohoCustomerId && (
                  <span className="text-xs text-slate-400 font-normal ml-auto">customer के org से auto-set</span>
                )}
              </div>
            ) : (
              // New lead OR existing customer (none picked yet) → choose the target org
              <select value={selectedOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Quote Number
              <span className="ml-1 font-normal text-slate-400">(blank = auto)</span>
            </label>
            <input name="quote_number" type="text" placeholder="QQ-2026-0001"
              defaultValue={editQuote?.quoteNumber ?? ''} readOnly={isEdit}
              className={`w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 ${isEdit ? 'bg-slate-50 text-slate-500' : ''}`} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Quote Reference</label>
            <input name="quote_reference" type="text" placeholder="Customer PO / reference"
              defaultValue={editQuote?.quoteReference ?? ''} readOnly={isEdit}
              className={`w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isEdit ? 'bg-slate-50 text-slate-500' : ''}`} />
          </div>
        </div>

        {/* Row 2 — Quote Date + Expiry Date */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Quote Date</label>
            <input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} disabled={isEdit}
              className={`w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isEdit ? 'bg-slate-50 text-slate-500' : ''}`} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Expiry Date
              <span className="ml-1 font-normal text-slate-400">(default +15 days)</span>
            </label>
            <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} disabled={isEdit}
              className={`w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isEdit ? 'bg-slate-50 text-slate-500' : ''}`} />
          </div>
        </div>

        {/* ── Items (same card) ── */}
        <div className="border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">Items</h3>
            <button type="button" onClick={addItem}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium">+ Add New Row</button>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-bold text-slate-400 uppercase tracking-wider">Item Details</th>
                  <th className="text-right px-4 py-2.5 text-xs font-bold text-slate-400 uppercase tracking-wider w-24">Qty</th>
                  <th className="text-right px-4 py-2.5 text-xs font-bold text-slate-400 uppercase tracking-wider w-36">Rate & Discount</th>
                  <th className="text-right px-4 py-2.5 text-xs font-bold text-slate-400 uppercase tracking-wider w-36">Amount</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <ItemRow key={item.id} item={item} orgId={selectedOrgId} billingOptions={billingOptions} onUpdate={updateItem} onRemove={removeItem} canRemove={items.length > 1} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2.5">
            <button type="button" onClick={addItem}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
              <span className="text-lg leading-none">+</span> Add New Row
            </button>
          </div>

          {/* Totals */}
          <div className="mt-4 flex justify-end">
            <div className="w-72 bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 rounded-xl p-4 space-y-2 text-sm shadow-sm">
              <div className="flex justify-between text-slate-600"><span>Subtotal</span><span className="tabular-nums">₹{totals.sub.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between text-slate-600"><span>Discount</span><span className="tabular-nums">-₹{totals.disc.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between text-slate-600"><span>CGST @ 9%</span><span className="tabular-nums">₹{(totals.tax / 2).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between text-slate-600"><span>SGST @ 9%</span><span className="tabular-nums">₹{(totals.tax / 2).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between items-center pt-2.5 mt-1 border-t border-slate-300">
                <span className="font-semibold text-slate-800">Total</span>
                <span className="text-xl font-bold text-emerald-600 tabular-nums">₹{totals.total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notes & Terms — 3-column layout (wireframe §F) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <label className="block text-xs font-semibold text-slate-600 mb-1">Terms &amp; Conditions <span className="font-normal text-slate-400">(on PDF)</span></label>
          <textarea name="terms_and_conditions" rows={4}
            defaultValue={editQuote?.termsAndConditions ?? 'Payment due within 7 days of invoice. Prices are exclusive of GST.'}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <label className="block text-xs font-semibold text-slate-600 mb-1">Notes to Customer <span className="font-normal text-slate-400">(on PDF)</span></label>
          <textarea name="notes_to_customer" rows={4} defaultValue={editQuote?.notesToCustomer ?? ''}
            placeholder="Thank you for your business…"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" />
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <label className="block text-xs font-semibold text-amber-900 mb-1">🔒 Internal Notes <span className="font-normal text-amber-700">(NOT on PDF)</span></label>
          <textarea name="internal_notes" rows={4} defaultValue={editQuote?.internalNotes ?? ''}
            placeholder="Sirf sales team ko dikhega…"
            className="w-full px-3 py-2 border border-amber-300 bg-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-y" />
        </div>
      </div>

      <div className="flex gap-3">
        <SubmitBtn isEdit={isEdit} disabled={hasIncompleteSubItems || creatingLead} />
        <a href={isEdit ? `/dashboard/quick-quotes/${editQuote!.id}` : '/dashboard/quick-quotes'}
          className="px-5 py-2.5 border border-slate-300 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50">
          Cancel
        </a>
      </div>
    </form>
    </>
  );
}

// ------------------------------------------------------------------
// Line Item Row — Zoho-style table row (no date columns)
// ------------------------------------------------------------------
function ItemRow({
  item, orgId, billingOptions, onUpdate, onRemove, canRemove,
}: {
  item: LineItem;
  orgId: string;
  billingOptions: BillingOption[];
  onUpdate: (id: string, field: keyof LineItem, value: unknown) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
}) {
  const sub   = item.quantity * item.unit_price;
  const disc  = sub * (item.discount_percent / 100);
  const total = sub - disc;
  const cell  = 'px-3 py-2 align-top';

  return (
    <tr className="hover:bg-slate-50/50">
      {/* Item Details */}
      <td className="px-4 py-3 align-top">
        {item.renewed_subscription_id && (
          <div className="mb-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">
              🔄 Renewal
            </span>
          </div>
        )}
        <ZohoItemSearch
          orgId={orgId}
          value={item.item_name}
          onChange={(name) => onUpdate(item.id, 'item_name', name)}
          onSelect={(zohoId, name, rate, description) => {
            onUpdate(item.id, 'zoho_item_id', zohoId);
            onUpdate(item.id, 'item_name', name);
            onUpdate(item.id, 'item_description', description);
            if (rate > 0) onUpdate(item.id, 'unit_price', rate);
          }}
        />
        <textarea
          value={item.item_description ?? ''}
          onChange={(e) => onUpdate(item.id, 'item_description', e.target.value)}
          placeholder="Description (optional)"
          rows={3}
          className="mt-2 w-full px-3 py-2 border border-slate-200 rounded-xl text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-slate-50/50 resize-y"
        />
        
        {/* Domain & Period inline grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3 pt-3 border-t border-slate-100">
          {/* Domain */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Domain <span className="normal-case font-normal text-slate-400">(optional)</span></label>
              <button
                type="button"
                onClick={() => onUpdate(item.id, 'bulk_domains', !item.bulk_domains)}
                className="text-[10px] text-blue-600 hover:underline font-bold"
              >
                {item.bulk_domains ? '↤ Single domain' : '⇲ Bulk domains'}
              </button>
            </div>
            {!item.bulk_domains ? (
              <input
                type="text"
                value={item.primary_domain ?? ''}
                onChange={(e) => onUpdate(item.id, 'primary_domain', e.target.value)}
                placeholder="example.com"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            ) : (
              <>
                <textarea
                  value={item.bulk_domains_text ?? ''}
                  onChange={(e) => {
                    onUpdate(item.id, 'bulk_domains_text', e.target.value);
                    const list = parseDomainList(e.target.value);
                    if (list.length) onUpdate(item.id, 'quantity', list.reduce((s, d) => s + d.qty, 0));
                  }}
                  placeholder={'domain1.com\ndomain2.com, 5\ndomain3.com'}
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-y"
                />
                {(() => {
                  const list = parseDomainList(item.bulk_domains_text ?? '');
                  return list.length ? (
                    <p className="text-[10px] text-emerald-600 mt-1 font-bold">
                      ✓ {list.length} domains · total Qty {list.reduce((s, d) => s + d.qty, 0)}
                    </p>
                  ) : (
                    <p className="text-[10px] text-slate-400 mt-1">Domain per line (domain.com, 5)</p>
                  );
                })()}
              </>
            )}
          </div>

          {/* Period & Toggle */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Subs. Period</label>
            <select
              value={item.billing_cycle ?? ''}
              onChange={(e) => onUpdate(item.id, 'billing_cycle', e.target.value)}
              disabled={!item.is_subscription}
              className={`w-full px-3 py-2 border rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-400 ${
                item.is_subscription && !item.billing_cycle ? 'border-red-300 focus:border-red-400' : 'border-slate-200'
              }`}
            >
              <option value="">{billingOptions.length ? '— Period —' : '— map in Settings —'}</option>
              {billingOptions.map((o) => (
                <option key={o.value + o.label} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer mt-3 select-none">
              <input
                type="checkbox"
                checked={!item.is_subscription}
                onChange={(e) => {
                  onUpdate(item.id, 'is_subscription', !e.target.checked);
                  if (e.target.checked) onUpdate(item.id, 'billing_cycle', '');
                }}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Non-subscription (one-time)
            </label>
          </div>
        </div>
      </td>

      {/* Quantity */}
      <td className="px-4 py-3 align-top text-right w-24">
        <input type="number" value={item.quantity} min={1} step={1}
          onChange={(e) => onUpdate(item.id, 'quantity', parseFloat(e.target.value) || 1)}
          className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-bold"
        />
      </td>

      {/* Rate & Discount */}
      <td className="px-4 py-3 align-top text-right w-36">
        <input type="number" value={item.unit_price} min={0}
          onChange={(e) => onUpdate(item.id, 'unit_price', parseFloat(e.target.value) || 0)}
          className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-bold"
        />
        <div className="flex items-center justify-end gap-1.5 mt-2 bg-slate-50 border border-slate-200/60 rounded-xl p-1.5 max-w-max ml-auto">
          <input type="number" value={item.discount_percent} min={0} max={100} placeholder="0"
            onChange={(e) => onUpdate(item.id, 'discount_percent', parseFloat(e.target.value) || 0)}
            className="w-10 px-1 py-0.5 border border-slate-200 rounded text-xs text-right focus:outline-none bg-white font-bold"
          />
          <span className="text-[10px] font-bold text-slate-400 uppercase">% off</span>
        </div>
      </td>

      {/* Amount */}
      <td className="px-4 py-3 align-top text-right w-36">
        <span className="text-sm font-extrabold text-slate-800 tracking-tight block mt-2">
          ₹{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </span>
      </td>

      {/* Remove */}
      <td className="px-4 py-3 align-top text-center w-10">
        {canRemove && (
          <button type="button" onClick={() => onRemove(item.id)}
            className="p-1.5 rounded-xl border border-red-100 bg-red-50/50 text-red-500 hover:bg-red-50 hover:text-red-700 transition-all active:scale-95 mt-1"
            title="Remove row"
          >
            ✕
          </button>
        )}
      </td>
    </tr>
  );
}

// ------------------------------------------------------------------
// Lead Search (simple inline search)
// ------------------------------------------------------------------
function LeadSearch({ onSelect }: { onSelect: (lead: Lead) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/proxy/leads?search=${encodeURIComponent(q)}&limit=8`, { credentials: 'include' });
      const data = await res.json() as { leads: Lead[] };
      setResults(data.leads ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); void search(e.target.value); }}
        placeholder="Company name या email type करो…"
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {loading && <div className="absolute right-3 top-2 text-slate-400 text-xs">…</div>}
      {results.length > 0 && (
        <div className="absolute z-10 top-full mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          {results.map((lead) => (
            <button key={lead.id} type="button"
              onClick={() => { onSelect(lead); setResults([]); setQuery(''); }}
              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0">
              <div className="font-medium text-sm text-slate-800">{lead.companyName}</div>
              <div className="text-xs text-slate-500">{lead.email} · {lead.leadNumber}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function newItem(order: number): LineItem {
  return {
    id: Math.random().toString(36).slice(2),
    line_order: order,
    item_name: '',
    item_description: '',
    quantity: 1,
    unit_price: 0,
    cost_price: 0,
    discount_percent: 0,
    tax_rate: 18,
    is_subscription: true,    // default: subscription
    primary_domain: '',
    service_period_start: '',
    service_period_end: '',
    bulk_domains: false,
    bulk_domains_text: '',
  };
}
