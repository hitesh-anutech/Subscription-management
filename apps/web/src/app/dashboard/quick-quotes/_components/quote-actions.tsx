'use client';

import { useState, useTransition } from 'react';
import { sendQuoteAction, deleteQuoteAction } from '../actions';

export function QuoteActions({
  quoteId,
  status,
  publicUrl,
  leadEmail,
}: {
  quoteId: string;
  status: string;
  publicUrl: string | null;
  leadEmail?: string | null;
}) {
  const [, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [recipient, setRecipient] = useState(leadEmail ?? '');

  const canSend = ['Draft', 'Sent', 'Viewed'].includes(status);
  const isResend = status !== 'Draft';
  const canDelete = status === 'Draft';
  // Copy Link only while the quote is still open for a decision —
  // an Accepted/Rejected/Expired quote's link shouldn't be shared around.
  const canCopyLink = !!publicUrl && ['Sent', 'Viewed'].includes(status);

  const doSend = (email?: string) => {
    setSending(true);
    setComposeOpen(false);
    startTransition(async () => {
      try {
        const result = await sendQuoteAction(quoteId, email);
        if (result.emailSent) {
          setSendResult(`✓ Quote email sent to ${result.emailTo}`);
        } else if (result.emailError) {
          setSendResult(`⚠ Link बन गया, लेकिन email fail: ${result.emailError}`);
        } else {
          setSendResult('✓ Quote sent — link Copy Link button से share करो');
        }
      } catch (err) {
        setSendResult(`✕ ${err instanceof Error ? err.message : 'Send failed'}`);
      } finally {
        setSending(false);
      }
    });
  };

  const copyLink = () => {
    if (!publicUrl) return;
    void navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        {canCopyLink && (
          <button onClick={copyLink}
            className="px-3 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
            {copied ? '✓ Copied!' : '🔗 Copy Link'}
          </button>
        )}
        {canSend && (
          <button onClick={() => setComposeOpen(true)} disabled={sending}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-sm font-semibold rounded-lg">
            {sending ? 'Sending…' : isResend ? '↩ Resend Quote' : '📤 Send Quote'}
          </button>
        )}
        {canDelete && (
          <button
            onClick={() => {
              if (confirm('इस Draft quote को delete करें?')) {
                startTransition(() => deleteQuoteAction(quoteId));
              }
            }}
            className="px-3 py-2 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50">
            Delete
          </button>
        )}
      </div>
      {sendResult && (
        <div className={`text-xs px-3 py-1.5 rounded-lg ${
          sendResult.startsWith('✓') ? 'bg-green-50 text-green-700'
          : sendResult.startsWith('⚠') ? 'bg-amber-50 text-amber-700'
          : 'bg-red-50 text-red-700'
        }`}>
          {sendResult}
        </div>
      )}

      {/* Compose modal */}
      {composeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
          onClick={() => setComposeOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-base font-semibold text-slate-800">
                {isResend ? '↩ Resend Quote' : '📤 Send Quote'}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {isResend
                  ? 'Customer को quote दोबारा email होगा — public link वही रहेगा, validity refresh हो जाएगी।'
                  : 'Customer को quote email होगा (public link के साथ), और quote का status Sent हो जाएगा।'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">To</label>
              <input
                type="email"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="customer@example.com"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="text-xs text-slate-400 mt-1">
                Email content Settings → Email Templates के &quot;Quote Sent&quot; template से बनेगा।
              </p>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => doSend(undefined)}
                className="text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2">
                सिर्फ link banao (email नहीं)
              </button>
              <div className="flex gap-2">
                <button onClick={() => setComposeOpen(false)}
                  className="px-3.5 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={() => doSend(recipient.trim())}
                  disabled={!recipient.trim()}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-sm font-semibold rounded-lg">
                  ✉ Send Email
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
