'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { bulkCreateSubscriptionsAction, emailQuoteInvoiceAction, getQuoteInvoiceEmailPreviewAction, refreshQuoteInvoiceAction, setSubscriptionDecisionAction } from '../actions';
import { SendEmailModal } from '@/components/send-email-modal';
import { ViewPdfButton } from '@/components/view-pdf-button';

interface SubItem {
  zohoItemId: string | null;
  zohoItemName: string;
  quantity: number;
  price: number;
  costPrice?: number | null;
  billingCycle: string | null;
  primaryDomain: string | null;
  serviceStartDate?: string | null;
  serviceEndDate?: string | null;
}
export interface PostConvert {
  invoice: { id: string | null; number: string | null; status: string };
  zohoInvoiceUrl: string | null;
  existingSubscriptionId: string | null;
  /** Convert-time choice: 'create_now' | 'later' | 'never' (backend maps null → 'later') */
  subscriptionDecision: string;
  /** >1 → bulk-domains quote: the button runs the bulk create instead of the single-sub page */
  bulkDomainCount: number;
  prefill: {
    organizationId: string;
    zohoCustomerId: string;
    zohoCustomerName: string;
    domainId: string;
    zohoInvoiceId: string | null;
    zohoInvoiceNumber: string | null;
    leadId: string;
    quickQuoteId: string;
    subscriptionItems: SubItem[];
  };
}

export function ConvertedInvoiceActions({ quoteId, info }: { quoteId: string; info: PostConvert }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  const status = info.invoice.status.toLowerCase();
  const alreadySent = ['sent', 'paid', 'overdue'].includes(status);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) => {
    setMsg(null);
    setSuccessMsg(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setMsg(res.error);
      else router.refresh();
    });
  };

  // Build the subscription-creation URL from prefill
  const p = info.prefill;
  const subParams = new URLSearchParams({
    org_id: p.organizationId,
    domain_id: p.domainId,
    customer_id: p.zohoCustomerId,
    customer_name: p.zohoCustomerName,
    invoice_num: p.zohoInvoiceNumber ?? '',
    invoice_id: p.zohoInvoiceId ?? '',
    lead_id: p.leadId,
    quote_id: p.quickQuoteId,
    items: JSON.stringify(p.subscriptionItems),
  });

  const hasSubs = p.subscriptionItems.length > 0;
  const skippedSubscription = info.subscriptionDecision === 'never';

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2 flex-wrap justify-end">
        {/* Create / View subscription — hidden when the user chose "never" at convert.
            Bulk-domains quote → one-click bulk create (single-sub page handles one domain only). */}
        {info.existingSubscriptionId ? (
          <Link href={`/dashboard/subscriptions/${info.existingSubscriptionId}`}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg">
            ✅ View Subscription
          </Link>
        ) : info.bulkDomainCount > 1 && !skippedSubscription ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!confirm(`${info.bulkDomainCount} domains के लिए subscriptions बनाएँ?`)) return;
              setMsg(null);
              setSuccessMsg(null);
              startTransition(async () => {
                const res = await bulkCreateSubscriptionsAction(quoteId);
                if (res.error) setMsg(res.error);
                else {
                  setSuccessMsg(
                    `✅ Subscriptions: ${res.created ?? 0} created${res.enriched ? `, ${res.enriched} enriched` : ''}${res.skipped ? `, ${res.skipped} skipped` : ''}`,
                  );
                  if (res.errors?.length) setMsg(res.errors.slice(0, 5).join(' · '));
                  router.refresh();
                }
              });
            }}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-semibold rounded-lg">
            {pending ? 'Creating…' : `🚀 Create ${info.bulkDomainCount} Subscriptions`}
          </button>
        ) : hasSubs && !skippedSubscription ? (
          <Link href={`/dashboard/subscriptions/new?${subParams.toString()}`}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg">
            🚀 Create {p.subscriptionItems.length > 1 ? `${p.subscriptionItems.length} Subscriptions` : 'Subscription'}
          </Link>
        ) : null}

        {/* Email invoice — opens the compose modal (review + edit before send) */}
        <button
          type="button"
          disabled={pending}
          onClick={() => { setMsg(null); setSuccessMsg(null); setComposeOpen(true); }}
          className={`px-3.5 py-2 border text-sm font-medium rounded-lg disabled:opacity-50 transition-colors ${
            alreadySent
              ? 'border-blue-300 text-blue-700 hover:bg-blue-50'
              : 'border-slate-300 text-slate-700 hover:bg-slate-50'
          }`}
          title={alreadySent ? 'Invoice phir se bhejo' : 'Invoice email karo'}
        >
          {alreadySent ? '↺ Re-send Invoice' : '✉ Email Invoice'}
        </button>

        {/* Refresh status */}
        <button type="button" disabled={pending} onClick={() => run(() => refreshQuoteInvoiceAction(quoteId))}
          title="Refresh invoice status from Zoho"
          className="px-2.5 py-2 border border-slate-300 text-slate-500 hover:bg-slate-50 disabled:opacity-50 text-sm rounded-lg">
          ↻
        </button>

        {/* View in Zoho */}
        {info.zohoInvoiceUrl && (
          <a href={info.zohoInvoiceUrl} target="_blank" rel="noopener noreferrer"
            className="px-3.5 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium rounded-lg">
            🔗 View in Zoho
          </a>
        )}

        {/* Actual Zoho Tax Invoice PDF (cached in-app) */}
        {(p.zohoInvoiceId || info.invoice.id) && (
          <ViewPdfButton
            orgId={p.organizationId}
            kind="invoice"
            docId={p.zohoInvoiceId ?? info.invoice.id}
            label="📄 Invoice PDF"
            title="View the Zoho Tax Invoice PDF"
            className="px-3.5 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium rounded-lg disabled:opacity-50"
          />
        )}

        {/* App-rendered quote sheet (the quote as designed in-app) */}
        <a href={`/quotes/${quoteId}/print`} target="_blank" rel="noopener noreferrer"
          className="px-3.5 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium rounded-lg">
          📄 Quote Sheet
        </a>
      </div>
      {/* One-time deal: subscription intentionally skipped — leave an undo path */}
      {skippedSubscription && !info.existingSubscriptionId && hasSubs && (
        <span className="text-xs text-slate-400">
          Subscription नहीं बनाई गई (one-time deal) —{' '}
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setSubscriptionDecisionAction(quoteId, 'later'))}
            className="text-blue-600 hover:underline disabled:opacity-50"
          >
            बदलना हो तो यहाँ click करें
          </button>
        </span>
      )}
      {msg && <span className="text-xs text-red-600 max-w-xs text-right">{msg}</span>}
      {successMsg && (
        <span className="text-xs text-emerald-600 font-medium max-w-sm text-right bg-emerald-50 border border-emerald-200 rounded-md px-3 py-1.5">
          {successMsg}
        </span>
      )}

      {/* Compose modal — same UX as quote/renewal sends: Zoho template preview,
          editable To/CC/BCC/subject/body, template switcher. */}
      {composeOpen && (
        <SendEmailModal
          title={alreadySent ? 'Re-send Tax Invoice' : 'Send Tax Invoice'}
          sendLabel={alreadySent ? 'Resend Invoice' : 'Send Invoice'}
          docLabel={`Invoice ${info.invoice.number ?? ''}`.trim()}
          previewFn={(templateId?: string) => getQuoteInvoiceEmailPreviewAction(quoteId, templateId)}
          sendFn={(override) => emailQuoteInvoiceAction(quoteId, override)}
          onClose={() => setComposeOpen(false)}
          onSent={() => {
            setComposeOpen(false);
            setSuccessMsg('✅ Invoice ईमेल सफलतापूर्वक भेज दिया गया!');
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
