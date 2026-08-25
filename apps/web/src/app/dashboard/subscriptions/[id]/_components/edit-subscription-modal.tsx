'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { updateSubscriptionAction } from '../actions';

const BILLING_CYCLES: { value: string; label: string }[] = [
  { value: 'monthly',     label: 'Monthly' },
  { value: 'quarterly',   label: 'Quarterly' },
  { value: 'half_yearly', label: 'Half-Yearly (6 Month)' },
  { value: 'annual',      label: 'Annual (1 Year)' },
  { value: 'biennial',    label: 'Biennial (2 Year)' },
  { value: 'triennial',   label: 'Triennial (3 Year)' },
  { value: 'one_time',    label: 'One-Time' },
];

const CURRENCIES: { code: string; label: string; symbol: string }[] = [
  { code: 'INR', label: 'INR — Indian Rupee',        symbol: '₹'    },
  { code: 'AED', label: 'AED — UAE Dirham',           symbol: 'AED'  },
  { code: 'USD', label: 'USD — US Dollar',            symbol: '$'    },
  { code: 'EUR', label: 'EUR — Euro',                 symbol: '€'    },
  { code: 'GBP', label: 'GBP — British Pound',        symbol: '£'    },
  { code: 'SGD', label: 'SGD — Singapore Dollar',     symbol: 'S$'   },
  { code: 'AUD', label: 'AUD — Australian Dollar',    symbol: 'A$'   },
  { code: 'CAD', label: 'CAD — Canadian Dollar',      symbol: 'C$'   },
  { code: 'JPY', label: 'JPY — Japanese Yen',         symbol: '¥'    },
];

function currencySymbol(code: string) {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

interface Props {
  subscriptionId: string;
  itemName: string;
  quantity: number;
  currency: string;
  exchangeRate: number;
  billingCycle: string;
  price: number;
  nextRenewalPrice: number | null;
  startDate: string;   // ISO
  endDate: string;     // ISO
  autoRenew: boolean;
  lastQuoteNumber: string | null;
  lastInvoiceNumber: string | null;
}

function toDateInput(iso: string) {
  return new Date(iso).toISOString().split('T')[0];
}

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-5 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
    >
      {pending ? 'Saving…' : 'Save Changes'}
    </button>
  );
}

export function EditSubscriptionButton(props: Props) {
  const [open, setOpen]         = useState(false);
  const [currency, setCurrency] = useState(props.currency || 'INR');
  const router = useRouter();

  const sym = currencySymbol(currency);
  const isNonINR = currency !== 'INR';

  const boundAction = updateSubscriptionAction.bind(null, props.subscriptionId);
  const [state, action] = useFormState(
    async (_prev: { success?: boolean; error?: string } | null, fd: FormData) => {
      const res = await boundAction(fd);
      if (res.success) {
        setOpen(false);
        router.refresh();
      }
      return res;
    },
    null,
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
      >
        ✏️ Edit
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-800">Edit Subscription</h2>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>

            <form action={action} className="px-6 py-5 space-y-4">
              {state?.error && (
                <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{state.error}</div>
              )}

              {/* Item — read-only */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Item (read-only)</label>
                <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600">
                  {props.itemName}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Billing Cycle</label>
                  <select
                    name="billing_cycle"
                    defaultValue={props.billingCycle}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {BILLING_CYCLES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input
                    id="auto_renew"
                    name="auto_renew"
                    type="checkbox"
                    defaultChecked={props.autoRenew}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="auto_renew" className="text-sm text-slate-700">Auto Renew</label>
                </div>
              </div>

              {/* Currency selector */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Currency</label>
                  <select
                    name="currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.label}</option>
                    ))}
                  </select>
                </div>
                {isNonINR && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Exchange Rate <span className="text-slate-400 font-normal">(1 {currency} = ? INR)</span>
                    </label>
                    <input
                      name="exchange_rate"
                      type="number"
                      min={0}
                      step={0.0001}
                      defaultValue={props.exchangeRate !== 1 ? props.exchangeRate : ''}
                      placeholder="e.g. 23.50"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>

              {/* Quantity + Price + Renewal Price */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Quantity</label>
                  <input
                    name="quantity"
                    type="number" min={1} step={1}
                    defaultValue={props.quantity}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Price ({sym})</label>
                  <input
                    name="subscription_price"
                    type="number" min={0} step={0.01}
                    defaultValue={props.price}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Renewal Price ({sym})</label>
                  <input
                    name="next_renewal_price"
                    type="number" min={0} step={0.01}
                    defaultValue={props.nextRenewalPrice ?? ''}
                    placeholder="same as price"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Start Date</label>
                  <input
                    name="start_date"
                    type="date"
                    defaultValue={toDateInput(props.startDate)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">End Date</label>
                  <input
                    name="end_date"
                    type="date"
                    defaultValue={toDateInput(props.endDate)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Zoho Document Linking */}
              <div className="pt-2 border-t border-slate-200">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Link Zoho Documents (Optional)
                </p>
                <p className="text-xs text-slate-400 mb-3">
                  Naya number enter karo → Zoho se verify hokar entry ban jaayegi. Same number phir se save karo → renewal period dates update ho jaayengi.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Last Quote Number</label>
                    <input
                      name="last_quote_number"
                      type="text"
                      defaultValue={props.lastQuoteNumber ?? ''}
                      placeholder="EST-000123"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Last Invoice Number</label>
                    <input
                      name="last_invoice_number"
                      type="text"
                      defaultValue={props.lastInvoiceNumber ?? ''}
                      placeholder="INV-000456"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <SaveBtn />
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
