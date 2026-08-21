'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  sendProformaAction, getEmailPreviewAction, refreshProformaAction,
  sendInvoiceAction, getInvoiceEmailPreviewAction, convertProformaToInvoiceAction,
} from '../actions';
import { SendEmailModal } from '@/components/send-email-modal';

type Mode = 'quote' | 'invoice';

interface Props {
  historyId:          string;
  quoteId:            string | null;
  quoteNumber:        string | null;
  invoiceId:          string | null;
  invoiceNumber:      string | null;
  renewalStatus:      string;
  zohoEstimateStatus: string | null;
  zohoInvoiceStatus:  string | null;
}

/** Refresh/sync icon — spins while refreshing. */
function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={`w-4 h-4 ${spinning ? 'animate-spin' : ''}`}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/** Per renewal-history row: Send/Resend Quote, Resend Tax Invoice, and Refresh (sync from Zoho). */
export function ProformaActions({
  historyId, quoteId, invoiceId, renewalStatus, zohoEstimateStatus, zohoInvoiceStatus,
}: Props) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [msg, setMsg]              = useState<string | null>(null);
  const [modal, setModal]          = useState<Mode | null>(null);

  const handleRefresh = () => {
    setMsg(null);
    startRefresh(async () => {
      const res = await refreshProformaAction(historyId);
      if (res.error) setMsg(res.error);
      else router.refresh();
    });
  };

  const handleConvert = () => {
    setMsg(null);
    startRefresh(async () => {
      const res = await convertProformaToInvoiceAction(historyId);
      if (res.error) setMsg(res.error);
      else router.refresh();
    });
  };

  if (!quoteId) {
    return <span className="text-xs px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-600">{renewalStatus}</span>;
  }

  const estStatus     = (zohoEstimateStatus ?? 'draft').toLowerCase();
  const quoteSent     = ['sent', 'accepted', 'invoiced'].includes(estStatus);
  const hasInvoice    = Boolean(invoiceId);
  const invoicePaid   = (zohoInvoiceStatus ?? '').toLowerCase() === 'paid';

  const isInvoice = modal === 'invoice';

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          {/* Send / Resend Quote */}
          <button
            type="button"
            disabled={hasInvoice}
            onClick={() => { setMsg(null); setModal('quote'); }}
            title={hasInvoice ? 'Quote is already invoiced' : undefined}
            className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
              hasInvoice
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : quoteSent
                ? 'bg-slate-500 hover:bg-slate-600 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            {quoteSent ? '↩ Resend Quote' : '✉ Send Quote'}
          </button>

          {/* Convert to Invoice (when quote is sent but no invoice exists yet) */}
          {quoteSent && !hasInvoice && (
            <button
              type="button"
              disabled={refreshing}
              onClick={handleConvert}
              title="Convert this Quote into a Tax Invoice in Zoho Books"
              className="text-xs px-2.5 py-1 rounded-md font-medium text-white bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              {refreshing ? <SyncIcon spinning={true} /> : '⚡ Convert to Invoice'}
            </button>
          )}

          {/* Send/Resend Tax Invoice — only once the estimate is converted */}
          {hasInvoice && (
            <button
              type="button"
              onClick={() => { setMsg(null); setModal('invoice'); }}
              disabled={invoicePaid}
              title={invoicePaid ? 'Invoice already paid' : 'Send Tax Invoice to customer'}
              className="text-xs px-2.5 py-1 rounded-md font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              🧾 Send Invoice
            </button>
          )}

          {/* Refresh / sync from Zoho */}
          <button
            type="button"
            disabled={refreshing}
            onClick={handleRefresh}
            title="Sync status from Zoho Books"
            className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
          >
            <SyncIcon spinning={refreshing} />
          </button>
        </div>
        {msg && <span className="text-[11px] text-red-600 max-w-[220px] text-right">{msg}</span>}
      </div>

      {modal && (
        <SendEmailModal
          title={isInvoice ? '🧾 Send Tax Invoice' : '✉ Send Quote Email'}
          sendLabel={isInvoice ? '🧾 Send Invoice' : '✉ Send Quote'}
          docLabel={isInvoice ? 'Tax Invoice' : 'Quote'}
          previewFn={(tpl) => (isInvoice ? getInvoiceEmailPreviewAction : getEmailPreviewAction)(historyId, tpl)}
          sendFn={(override) => (isInvoice ? sendInvoiceAction : sendProformaAction)(historyId, override)}
          onClose={() => setModal(null)}
          onSent={() => { setModal(null); router.refresh(); }}
        />
      )}
    </>
  );
}
