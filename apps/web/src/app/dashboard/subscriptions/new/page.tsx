'use client';

import { useSearchParams } from 'next/navigation';
import { useState, useEffect, Suspense } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { createSubscriptionAction } from './actions';
import { ZohoCustomerSearch, ZohoItemSearch } from '../../quick-quotes/_components/zoho-search';
import {
  MultiSubscriptionForm,
  calcEndDate,
  BILLING_CYCLES,
  parseItems,
  type SubItem,
} from './_components/multi-sub-form';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

function SubmitBtn({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled}
      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors">
      {pending ? 'Creating…' : '✓ Create Subscription'}
    </button>
  );
}

function NewSubscriptionForm() {
  const sp = useSearchParams();

  const queryOrgId        = sp.get('org_id') ?? '';
  const domainId          = sp.get('domain_id') ?? '';
  const queryCustomerId   = sp.get('customer_id') ?? '';
  const queryCustomerName = sp.get('customer_name') ?? '';
  const invoiceNum        = sp.get('invoice_num') ?? '';
  const queryInvoiceId    = sp.get('invoice_id') ?? '';
  const leadId            = sp.get('lead_id') ?? '';
  const quoteId           = sp.get('quote_id') ?? '';

  const items: SubItem[] = parseItems(sp.get('items'));
  const firstItem = items[0];

  // `mode=manual` → manual entry (pick item/domain/dates) but with the customer
  // pre-filled & locked (used by the customer page's "+ New Subscription" button).
  const forceManual = sp.get('mode') === 'manual';
  const isWildcard = forceManual || !queryCustomerId; // manual entry mode
  const customerLocked = forceManual && !!queryCustomerId;

  const today = new Date().toISOString().split('T')[0];
  const defaultCycle = firstItem?.billingCycle ?? 'annual';
  const defaultStart = firstItem?.serviceStartDate || today;
  const defaultEnd   = firstItem?.serviceEndDate || calcEndDate(defaultStart, defaultCycle);

  // Wildcard Mode State
  const [orgs, setOrgs] = useState<{id:string; name:string; isActive?: boolean}[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState(queryOrgId);
  const [selectedCustomerId, setSelectedCustomerId] = useState(queryCustomerId);
  const [selectedCustomerName, setSelectedCustomerName] = useState(queryCustomerName);
  
  const [wildcardItemName, setWildcardItemName] = useState('');
  const [wildcardItemId, setWildcardItemId] = useState('');
  const [wildcardDomain, setWildcardDomain] = useState('');
  const [wildcardInvoiceId, setWildcardInvoiceId] = useState('');

  const [startDate,    setStartDate]    = useState(defaultStart);
  const [endDate,      setEndDate]      = useState(defaultEnd);
  const [billingCycle, setBillingCycle] = useState(defaultCycle);
  const [quantity,     setQuantity]     = useState(firstItem?.quantity ?? 1);
  const [price,        setPrice]        = useState(firstItem?.price ?? 0);
  const [costPrice,    setCostPrice]    = useState(firstItem?.costPrice ?? 0);
  const [endTouched,   setEndTouched]   = useState(false);

  useEffect(() => {
    if (isWildcard && !orgs.length) {
      fetch(`${API_BASE}/organizations`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => {
          const active = d.organizations?.filter((o: any) => o.isActive !== false) ?? [];
          setOrgs(active);
          if (active.length > 0 && !selectedOrgId) {
            setSelectedOrgId(active[0].id);
          }
        })
        .catch(() => {});
    }
  }, [isWildcard, orgs.length, selectedOrgId]);

  useEffect(() => {
    if (endTouched && startDate) setEndDate(calcEndDate(startDate, billingCycle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, billingCycle]);

  // Derived fields
  const finalOrgId = isWildcard ? selectedOrgId : queryOrgId;
  const finalCustomerId = isWildcard ? selectedCustomerId : queryCustomerId;
  const finalCustomerName = isWildcard ? selectedCustomerName : queryCustomerName;
  const finalItemId = isWildcard ? wildcardItemId : (firstItem?.zohoItemId ?? '');
  const finalItemName = isWildcard ? wildcardItemName : (firstItem?.zohoItemName ?? '');
  const finalDomain = isWildcard ? wildcardDomain : (firstItem?.primaryDomain ?? '');
  const finalInvoiceId = isWildcard ? wildcardInvoiceId : queryInvoiceId;

  const missingFields = [
    !finalDomain?.trim() && 'Domain',
    !startDate && 'Start Date',
    !endDate && 'End Date',
    costPrice == null && 'Cost Price',
    isWildcard && !finalOrgId && 'Organization',
    isWildcard && !finalCustomerId && 'Customer',
    isWildcard && !finalItemName && 'Item',
  ].filter(Boolean) as string[];
  const hasMissing = missingFields.length > 0;

  const [state, action] = useFormState(
    (_prev: { error?: string } | null, fd: FormData) => createSubscriptionAction(_prev, fd),
    null,
  );

  const totalAmount = quantity * price;

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <nav className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
          <Link href="/dashboard/subscriptions" className="hover:text-slate-600">Subscriptions</Link>
          <span>›</span>
          <span className="text-slate-600">{isWildcard ? 'Manual Entry' : 'New Subscription'}</span>
        </nav>
        <h1 className="text-2xl font-bold text-slate-900">
          {isWildcard ? 'Manual Subscription Entry' : 'Create Subscription'}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {isWildcard 
            ? 'बिना Lead या Quote के directly subscription add करें।' 
            : 'Invoice create हो गई — अब subscription details review करो और save करो।'}
        </p>
      </div>

      {/* Invoice confirmation banner */}
      {invoiceNum && !isWildcard && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3.5 flex items-center gap-3">
          <span className="text-emerald-600 text-lg">🧾</span>
          <div>
            <p className="text-sm font-semibold text-emerald-800">Zoho Invoice Created</p>
            <p className="text-xs text-emerald-600 font-mono">{invoiceNum}</p>
          </div>
        </div>
      )}

      {state?.error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
          {state.error}
        </div>
      )}

      {hasMissing && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl">
          ⚠️ Subscription banane ke liye ye fields zaroori hain: <b>{missingFields.join(', ')}</b>.
          {!finalDomain?.trim() && !isWildcard && ' (Domain quote item se aata hai — quote me bharein.)'}
        </div>
      )}

      <form action={action} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        {/* Hidden fields */}
        <input type="hidden" name="organization_id"    value={finalOrgId} />
        <input type="hidden" name="domain_id"          value={domainId} />
        <input type="hidden" name="zoho_customer_id"   value={finalCustomerId} />
        <input type="hidden" name="zoho_customer_name" value={finalCustomerName} />
        <input type="hidden" name="zoho_item_id"       value={finalItemId} />
        <input type="hidden" name="zoho_item_name"     value={finalItemName} />
        <input type="hidden" name="zoho_invoice_number" value={isWildcard ? '' : invoiceNum} />
        <input type="hidden" name="zoho_invoice_id"    value={finalInvoiceId} />
        <input type="hidden" name="origin_lead_id"     value={leadId} />
        <input type="hidden" name="origin_quote_id"    value={quoteId} />
        <input type="hidden" name="start_date"         value={startDate} />
        <input type="hidden" name="end_date"           value={endDate} />
        <input type="hidden" name="quantity"           value={String(quantity)} />
        <input type="hidden" name="subscription_price" value={String(price)} />
        <input type="hidden" name="cost_price"         value={String(costPrice)} />
        <input type="hidden" name="billing_cycle"      value={billingCycle} />

        {isWildcard && (
          <div className="space-y-4 mb-4 pb-4 border-b border-slate-200">
            {customerLocked ? (
              // Customer-context mode — org + customer come pre-filled from the customer page.
              <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-600 font-medium mb-0.5">Customer</p>
                <p className="text-sm font-semibold text-blue-900">{finalCustomerName || finalCustomerId}</p>
                <p className="text-xs text-blue-500 mt-1">
                  नया subscription इसी customer के लिए जुड़ेगा। नीचे item, domain और dates भरें।
                </p>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Organization</label>
                  <select
                    value={selectedOrgId}
                    onChange={(e) => setSelectedOrgId(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Organization...</option>
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Customer (Zoho Search)</label>
                  <ZohoCustomerSearch
                    orgId={selectedOrgId}
                    onSelect={(id, name) => {
                      setSelectedCustomerId(id);
                      setSelectedCustomerName(name);
                    }}
                  />
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Item / Product (Zoho Search)</label>
                <ZohoItemSearch
                  orgId={selectedOrgId}
                  value={wildcardItemName}
                  onChange={(name) => setWildcardItemName(name)}
                  onSelect={(id, name, rt) => {
                    setWildcardItemId(id);
                    setWildcardItemName(name);
                    setPrice(rt);
                  }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Domain Name</label>
                <input
                  type="text"
                  value={wildcardDomain}
                  onChange={(e) => setWildcardDomain(e.target.value)}
                  placeholder="example.com"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {/* Hidden domain field for action parsing since it uses FormData domain_name if domain_id is empty */}
                <input type="hidden" name="domain_name" value={wildcardDomain} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Zoho Invoice ID (optional)</label>
              <input
                type="text"
                value={wildcardInvoiceId}
                onChange={(e) => setWildcardInvoiceId(e.target.value)}
                placeholder="Zoho invoice id (if any)"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {/* Item info (only for conversion mode) */}
        {firstItem && !isWildcard && (
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-sm font-medium text-slate-800">{firstItem.zohoItemName}</p>
            {firstItem.primaryDomain && (
              <p className="text-xs text-slate-500 mt-0.5">🌐 {firstItem.primaryDomain}</p>
            )}
          </div>
        )}

        {/* Billing cycle */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Billing Cycle</label>
          <select
            value={billingCycle}
            onChange={(e) => { setBillingCycle(e.target.value); setEndTouched(true); }}
            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {BILLING_CYCLES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setEndTouched(true); }}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              End Date
              <span className="ml-1 text-xs text-slate-400 font-normal">auto-calculated</span>
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Quantity + Price */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Quantity (Licenses)</label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Price per License (₹)</label>
            <input
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Cost Price (margin tracking — mandatory) */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Cost Price (₹) <span className="text-red-500">*</span>
            <span className="ml-1 text-xs text-slate-400 font-normal">per license — for margin</span>
          </label>
          <input
            type="number"
            min={0}
            value={costPrice}
            onChange={(e) => setCostPrice(Number(e.target.value))}
            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Total */}
        <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm text-blue-700 font-medium">Subscription Value</span>
          <span className="text-lg font-bold text-blue-800">
            ₹{totalAmount.toLocaleString('en-IN')} / {billingCycle}
          </span>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes (optional)</label>
          <textarea
            name="notes"
            rows={2}
            placeholder="Subscription से related notes…"
            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <SubmitBtn disabled={hasMissing} />
          <Link
            href="/dashboard/subscriptions"
            className="px-5 py-2.5 border border-slate-300 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50"
          >
            Skip (बाद में बनाएँ)
          </Link>
        </div>
      </form>

    </div>
  );
}

/**
 * Invoice conversion (any number of subscription items) → list view with one
 * editable row per item; manual entry (wildcard) → the classic single form.
 */
function FormSwitch() {
  const sp = useSearchParams();
  const items = parseItems(sp.get('items'));
  const isWildcard = sp.get('mode') === 'manual' || !sp.get('customer_id');

  if (!isWildcard && items.length >= 1) {
    return (
      <MultiSubscriptionForm
        items={items}
        ctx={{
          organizationId:    sp.get('org_id') ?? '',
          zohoCustomerId:    sp.get('customer_id') ?? '',
          zohoCustomerName:  sp.get('customer_name') ?? '',
          zohoInvoiceId:     sp.get('invoice_id') ?? '',
          zohoInvoiceNumber: sp.get('invoice_num') ?? '',
          leadId:            sp.get('lead_id') ?? '',
          quoteId:           sp.get('quote_id') ?? '',
        }}
      />
    );
  }
  return <NewSubscriptionForm />;
}

export default function NewSubscriptionPage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-400 p-6">Loading…</div>}>
      <FormSwitch />
    </Suspense>
  );
}
