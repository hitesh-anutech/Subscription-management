'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { convertLeadAction } from '../actions';
import { ConversionDetailsFields } from '../../../quick-quotes/_components/conversion-details-fields';
import { createInvoiceForQuoteAction } from '../../../subscriptions/new/actions';

function ConvertBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-semibold rounded-lg transition-colors">
      {pending ? 'Converting…' : '🚀 Convert to Customer'}
    </button>
  );
}

interface Quote { id: string; quoteNumber: string; status: string; totalAmount: string }

interface ConversionResult {
  success?: boolean;
  error?: string;
  zohoCustomerId?: string;
  zohoCustomerName?: string;
  zohoInvoiceId?: string;
  zohoInvoiceNumber?: string;
  domainId?: string;
  organizationId?: string;
  quickQuoteId?: string;
  subscriptionDecision?: string;
  subscriptionItems?: Array<{
    zohoItemId: string | null;
    zohoItemName: string;
    quantity: number;
    price: number;
    billingCycle: string | null;
    primaryDomain: string | null;
  }>;
}

interface Props {
  leadId: string;
  organizationId: string | null;
  acceptedQuotes: Quote[];
}

export function ConvertLeadPanel({ leadId, organizationId, acceptedQuotes }: Props) {
  const router = useRouter();
  const boundAction = convertLeadAction.bind(null, leadId);
  const [state, action] = useFormState(
    async (_prev: ConversionResult | null, fd: FormData) =>
      boundAction(fd) as Promise<ConversionResult>,
    null,
  );

  // On success → redirect to Subscription Creation page only when the user chose
  // "create now" at convert time ('later'/'never' create invoice immediately then show card).
  const redirectReady = state?.success && state.domainId
    && (state.subscriptionDecision ?? 'create_now') === 'create_now';

  // For later/never: create invoice immediately with defaults (no subscription dates yet).
  const [laterInvoiceNum, setLaterInvoiceNum] = useState<string | null>(null);
  const [laterInvoiceErr, setLaterInvoiceErr] = useState<string | null>(null);
  const invoiceCreatedRef = useRef(false);
  const laterReady = state?.success && !redirectReady && !!state.quickQuoteId;
  useEffect(() => {
    if (!laterReady || !state?.quickQuoteId || invoiceCreatedRef.current) return;
    invoiceCreatedRef.current = true;
    createInvoiceForQuoteAction(state.quickQuoteId, [])
      .then((inv) => setLaterInvoiceNum(inv.zohoInvoiceNumber ?? inv.zohoInvoiceId))
      .catch((err) => setLaterInvoiceErr(err instanceof Error ? err.message : 'Invoice create नहीं हो पाई'));
  }, [laterReady, state?.quickQuoteId]);

  useEffect(() => {
    if (!redirectReady || !state) return;
    const params = new URLSearchParams({
      org_id:        state.organizationId ?? '',
      domain_id:     state.domainId ?? '',
      customer_id:   state.zohoCustomerId ?? '',
      customer_name: state.zohoCustomerName ?? '',
      lead_id:       leadId,
      quote_id:      state.quickQuoteId ?? '',
      items:         JSON.stringify(state.subscriptionItems ?? []),
    });
    router.push(`/dashboard/subscriptions/new?${params.toString()}`);
  }, [redirectReady, state, router]);

  if (redirectReady) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">
        <p className="font-semibold">✅ Customer बन गया — Subscription page खुल रही है…</p>
        <p className="text-xs mt-1 text-emerald-600">Domain + subscription dates wahan confirm karein, Invoice वहीं बनेगी।</p>
      </div>
    );
  }

  if (state?.success && !redirectReady) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
        <p className="font-semibold">✅ Conversion successful!</p>
        {laterInvoiceErr && (
          <p className="text-xs mt-1 text-red-600">⚠ Invoice error: {laterInvoiceErr}</p>
        )}
        {laterInvoiceNum && (
          <p className="text-xs mt-1 text-green-600">Invoice: <strong>{laterInvoiceNum}</strong></p>
        )}
        {!laterInvoiceNum && !laterInvoiceErr && (
          <p className="text-xs mt-1 text-slate-500">⏳ Invoice बन रही है…</p>
        )}
        {state.zohoCustomerId && (
          <p className="text-xs mt-1 text-green-600 font-mono">Zoho ID: {state.zohoCustomerId}</p>
        )}
        {state.subscriptionDecision === 'later' && (
          <p className="text-xs mt-1 text-amber-600">⏳ Subscription pending — quote page par &quot;Create Subscription&quot; se banao.</p>
        )}
        {state.subscriptionDecision === 'never' && (
          <p className="text-xs mt-1 text-slate-500">Subscription skip ki gayi (one-time deal).</p>
        )}
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
        <p className="font-semibold">Organization assign नहीं है</p>
        <p className="text-xs mt-1">Lead edit करके organization select करो।</p>
      </div>
    );
  }

  // No accepted quote → conversion is impossible (backend enforces it), so don't
  // render a form that can only fail — show what's needed to unlock it instead.
  if (acceptedQuotes.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
        <p className="font-semibold">Convert to Customer</p>
        <p className="text-xs mt-1">
          ⚠️ कोई accepted quote नहीं है। पहले quote पर <b>✓ Mark as Accepted</b> करो
          (या customer public link से accept करे) — फिर convert form यहाँ आ जाएगा।
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-emerald-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-emerald-800 mb-3">Convert to Customer</h3>

      <form action={action} className="space-y-3">
        {state?.error && (
          <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded border border-red-200">
            {state.error}
          </div>
        )}

        {/* org passed as hidden field — already set at lead creation */}
        <input type="hidden" name="organization_id" value={organizationId} />

        {acceptedQuotes.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Quote to Convert</label>
            <select
              name="quick_quote_id"
              className="w-full px-3 py-2 rounded border border-slate-300 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="">Latest accepted quote</option>
              {acceptedQuotes.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.quoteNumber} — ₹{Number(q.totalAmount).toLocaleString('en-IN')}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Subscription decision only — domain + dates हर item के साथ Subscription list view पर review होते हैं. */}
        <ConversionDetailsFields />

        <ConvertBtn />
        <p className="text-xs text-slate-400">Zoho में contact + invoice बनेगा (start/end dates ke saath), फिर subscription page खुलेगी।</p>
      </form>
    </div>
  );
}
