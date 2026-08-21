import Link from 'next/link';
import { QuoteActions } from './quote-actions';
import { ConvertFromQuoteButton } from './convert-from-quote-button';
import { MarkAcceptedButton } from './mark-accepted-button';
import { UndoAcceptButton } from './undo-accept-button';

const ACCEPTABLE = ['Draft', 'Sent', 'Viewed', 'Expired'];

interface Props {
  quoteId: string;
  status: string;
  publicUrl: string | null;
  /** Lead's email — prefilled as the recipient in the Send compose modal. */
  leadEmail?: string | null;
  /** Present when the Accepted quote can be pushed to Zoho (lead → Customer+Invoice, existing → Invoice). */
  convert?: { mode: 'lead' | 'existing'; leadId?: string; organizationId: string; hasSubscriptionItems?: boolean } | null;
}

/**
 * All quote actions in one bar — rendered at BOTH the top and footer of the
 * quote detail page. Buttons appear conditionally by status:
 *   Edit (Draft) · View as PDF (always) · Send (Draft/Viewed) · Convert (Accepted lead)
 *   · Copy Link (has public link) · Delete (Draft)
 */
export function QuoteActionBar({ quoteId, status, publicUrl, leadEmail, convert }: Props) {
  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {status === 'Draft' && (
        <Link href={`/dashboard/quick-quotes/${quoteId}/edit`}
          className="px-3.5 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium rounded-lg transition-colors">
          ✏️ Edit
        </Link>
      )}
      <a href={`/quotes/${quoteId}/print`} target="_blank" rel="noopener noreferrer"
        className="px-3.5 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium rounded-lg transition-colors">
        📄 View as PDF
      </a>
      {ACCEPTABLE.includes(status) && <MarkAcceptedButton quoteId={quoteId} />}
      {/* Accepted but not yet converted → accidental accept can be undone */}
      {status === 'Accepted' && <UndoAcceptButton quoteId={quoteId} />}
      {convert && (
        <ConvertFromQuoteButton
          quoteId={quoteId}
          mode={convert.mode}
          leadId={convert.leadId}
          organizationId={convert.organizationId}
          hasSubscriptionItems={convert.hasSubscriptionItems}
        />
      )}
      <QuoteActions quoteId={quoteId} status={status} publicUrl={publicUrl} leadEmail={leadEmail} />
    </div>
  );
}
