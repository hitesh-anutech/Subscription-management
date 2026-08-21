'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { convertFromQuoteAction, convertExistingQuoteAction, bulkCreateSubscriptionsAction, type ConversionResult } from '../actions';
import { createInvoiceForQuoteAction } from '../../subscriptions/new/actions';
import { ConversionDetailsFields } from './conversion-details-fields';

interface Props {
  quoteId: string;
  mode: 'lead' | 'existing';
  leadId?: string;        // required when mode === 'lead'
  organizationId: string;
  /** Show the subscription-decision radio only when the quote has subscription items. */
  hasSubscriptionItems?: boolean;
}

export function ConvertFromQuoteButton({ quoteId, mode, leadId, organizationId, hasSubscriptionItems = true }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 'existing' = the customer already exists in Zoho (existing-customer quote,
  // or a lead that was converted earlier) — only an invoice is created.
  const label = mode === 'lead' ? '🚀 Convert to Customer' : '🧾 Create Invoice';

  /**
   * Direct submit handler (NOT useFormState): the redirect must run in the same
   * async continuation as the action result. With useFormState the navigation
   * lived in a useEffect — a page re-render into post-convert mode could unmount
   * this component before the effect fired, so the invoice was created but the
   * Subscription page never opened (redirect race).
   */
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const res: ConversionResult = mode === 'lead'
        ? await convertFromQuoteAction(leadId ?? '', organizationId, quoteId, null, fd)
        : await convertExistingQuoteAction(quoteId, null, fd);

      if (res.error || !res.success) {
        setError(res.error ?? 'Conversion failed');
        return;
      }

      const createNow = (res.subscriptionDecision ?? 'create_now') === 'create_now'
        && (res.subscriptionItems?.length ?? 0) > 0;

      setOpen(false);
      // Bulk-domains quote + "create now" → create ALL subscriptions in one call,
      // then create the Zoho invoice with default dates (backend uses quote item data).
      if (createNow && (res.bulkDomainCount ?? 0) > 1) {
        setSuccessMsg(`⏳ ${res.bulkDomainCount} subscriptions बन रही हैं…`);
        const bulk = await bulkCreateSubscriptionsAction(quoteId);
        let invNum = '';
        try {
          const inv = await createInvoiceForQuoteAction(res.quickQuoteId ?? quoteId, []);
          invNum = inv.zohoInvoiceNumber ?? inv.zohoInvoiceId;
        } catch (invErr) {
          setError(`Subscriptions बनीं, लेकिन invoice fail: ${invErr instanceof Error ? invErr.message : 'unknown error'}`);
        }
        if (bulk.error) {
          setError(`Invoice ${invNum ? `(${invNum}) ` : ''}बनी, लेकिन bulk subscriptions fail: ${bulk.error}`);
        } else {
          setSuccessMsg(
            `✅ Invoice ${invNum} + subscriptions: ${bulk.created ?? 0} created` +
            `${bulk.enriched ? `, ${bulk.enriched} enriched` : ''}${bulk.errors?.length ? `, ${bulk.errors.length} errors` : ''}`,
          );
          if (bulk.errors?.length) setError(bulk.errors.slice(0, 5).join(' · '));
        }
        router.refresh();
        return;
      }
      if (createNow) {
        // Redirect to subscription page — invoice will be created there after subscriptions.
        setSuccessMsg(`✅ Customer ready — Subscription page खुल रही है…`);
        const params = new URLSearchParams({
          org_id:        res.organizationId ?? '',
          domain_id:     res.domainId ?? '',
          customer_id:   res.zohoCustomerId ?? '',
          customer_name: res.zohoCustomerName ?? '',
          lead_id:       leadId ?? '',
          quote_id:      res.quickQuoteId ?? quoteId,
          items:         JSON.stringify(res.subscriptionItems ?? []),
        });
        router.push(`/dashboard/subscriptions/new?${params.toString()}`);
      } else {
        // later / never — create invoice immediately with defaults (no subscription dates known yet).
        try {
          const inv = await createInvoiceForQuoteAction(res.quickQuoteId ?? quoteId, []);
          setSuccessMsg(`✅ Invoice ${inv.zohoInvoiceNumber ?? inv.zohoInvoiceId} बन गई`);
        } catch (invErr) {
          setError(invErr instanceof Error ? invErr.message : 'Invoice create नहीं हो पाई');
        }
        router.refresh(); // show quote page in Pushed_To_Zoho mode
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={() => { setError(null); setOpen(true); }}
        className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap">
        {label}
      </button>
      {successMsg && <span className="text-xs text-emerald-600">{successMsg}</span>}
      {!open && error && (
        <span className="text-xs text-red-600 max-w-xs text-right">{error}</span>
      )}

      {/* Convert popup — overlay modal so the page layout stays untouched */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
          onClick={() => !pending && setOpen(false)}>
          <form onSubmit={handleSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-xl shadow-xl p-6 space-y-4 text-left max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-base font-semibold text-emerald-800">
                {mode === 'lead' ? '🚀 Convert to Customer' : '🧾 Create Invoice'}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {mode === 'lead'
                  ? 'Zoho में customer + tax invoice बनेगा।'
                  : 'Customer Zoho में already है — सिर्फ tax invoice बनेगा।'}
              </p>
            </div>
            {/* Subscription decision only — domain + dates हर item के साथ Subscription list view पर review होते हैं. */}
            <ConversionDetailsFields showSubscriptionChoice={hasSubscriptionItems} />
            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" disabled={pending} onClick={() => setOpen(false)}
                className="px-3.5 py-2 text-sm text-slate-500 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" disabled={pending}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap">
                {pending ? 'Converting…' : '🚀 Confirm & Convert'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
