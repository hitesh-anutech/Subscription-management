'use client';

import { useState, useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { startSubscriptionAction } from '../actions';

function StartBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-semibold rounded-lg transition-colors">
      {pending ? 'Starting…' : '▶ Start Subscription'}
    </button>
  );
}

// Add months to a date and return ISO date string YYYY-MM-DD
function addBillingCycle(startStr: string, cycle: string): string {
  const d = new Date(startStr);
  switch (cycle) {
    case 'monthly':     d.setMonth(d.getMonth() + 1); break;
    case 'quarterly':   d.setMonth(d.getMonth() + 3); break;
    case 'half_yearly': d.setMonth(d.getMonth() + 6); break;
    case 'annual':      d.setFullYear(d.getFullYear() + 1); break;
    case 'biennial':    d.setFullYear(d.getFullYear() + 2); break;
    case 'triennial':   d.setFullYear(d.getFullYear() + 3); break;
    default:            d.setFullYear(d.getFullYear() + 1);
  }
  d.setDate(d.getDate() - 1); // last day of period
  return d.toISOString().split('T')[0];
}

interface Props {
  subscriptionId: string;
  billingCycle: string;
  customerName: string | null;
  itemName: string | null;
}

export function StartSubscriptionModal({ subscriptionId, billingCycle, customerName, itemName }: Props) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate]     = useState(() => addBillingCycle(today, billingCycle));

  // Recalculate end date when start date changes
  useEffect(() => {
    if (startDate) setEndDate(addBillingCycle(startDate, billingCycle));
  }, [startDate, billingCycle]);

  const boundAction = startSubscriptionAction.bind(null, subscriptionId);
  const [state, action] = useFormState(
    async (_prev: { success?: boolean; error?: string; zohoDocumentNumber?: string } | null, fd: FormData) =>
      boundAction(fd),
    null,
  );

  if (state?.success) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">
        <p className="font-semibold">✅ Subscription started!</p>
        {state.zohoDocumentNumber && (
          <p className="text-xs mt-1 font-mono text-emerald-600">Zoho: {state.zohoDocumentNumber}</p>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors"
      >
        ▶ Start Subscription
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Start Subscription</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {customerName ?? 'Customer'} — {itemName ?? 'Item'}
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>

            <form action={action} className="p-6 space-y-5">
              {state?.error && (
                <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
                  {state.error}
                </div>
              )}

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Start Date</label>
                  <input
                    name="start_date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    End Date
                    <span className="ml-1 text-xs text-slate-400 font-normal">auto-calc, editable</span>
                  </label>
                  <input
                    name="end_date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Zoho document type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Zoho Books में create करो
                </label>
                <div className="space-y-2">
                  <label className="flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 border-slate-200 hover:border-slate-300 transition-colors">
                    <input
                      type="radio"
                      name="zoho_document_type"
                      value="estimate"
                      defaultChecked
                      className="mt-0.5 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-800">Estimate (Quote)</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Payment अभी नहीं मिली — पहले quote भेजो, फिर invoice।
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 border-slate-200 hover:border-slate-300 transition-colors">
                    <input
                      type="radio"
                      name="zoho_document_type"
                      value="invoice"
                      className="mt-0.5 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-800">Invoice</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Payment मिल चुकी है या credit period पर है — सीधे invoice बनाओ।
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes (optional)</label>
                <textarea
                  name="notes"
                  rows={2}
                  placeholder="Additional notes for Zoho document…"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <StartBtn />
                <button type="button" onClick={() => setOpen(false)}
                  className="px-4 py-2.5 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
