'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

/**
 * Accept / Decline actions on the public quote page.
 * `initialAction` comes from the email buttons (`?action=accept|reject`) —
 * it pre-opens the matching confirmation so the customer lands one click away,
 * but nothing mutates without an explicit in-page confirmation (mail scanners
 * that prefetch links therefore can't change the quote).
 */
export function QuoteDecision({ token, initialAction }: { token: string; initialAction?: string }) {
  const [, startTransition] = useTransition();
  const [done, setDone] = useState<'accepted' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(initialAction === 'reject');
  const [reason, setReason] = useState('');
  const autoAsked = useRef(false);

  // Email "Accept" button → open the native confirm once on load
  useEffect(() => {
    if (initialAction === 'accept' && !autoAsked.current) {
      autoAsked.current = true;
      const t = setTimeout(() => handleAccept(), 400);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const post = (path: string, body: Record<string, string>, onOk: () => void) => {
    setLoading(true);
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`${API_BASE}/quick-quotes/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: { message: string } };
          setError(data.error?.message ?? 'Request fail हो गई');
        } else {
          onOk();
        }
      } catch {
        setError('Server से connect नहीं हो पाया');
      } finally {
        setLoading(false);
      }
    });
  };

  const handleAccept = () => {
    if (!confirm('क्या आप इस quote को accept करना चाहते हैं?')) return;
    post('accept', { token }, () => setDone('accepted'));
  };

  const handleDecline = () => {
    post('reject', { token, ...(reason.trim() ? { reason: reason.trim() } : {}) }, () => setDone('rejected'));
  };

  if (done === 'accepted') {
    return (
      <div className="px-5 py-4 bg-green-50 border border-green-200 rounded-xl text-center">
        <div className="text-2xl mb-2">✅</div>
        <div className="font-semibold text-green-800">Quote Accept हो गई!</div>
        <div className="text-sm text-green-600 mt-1">हम जल्द ही आपसे contact करेंगे।</div>
      </div>
    );
  }
  if (done === 'rejected') {
    return (
      <div className="px-5 py-4 bg-slate-100 border border-slate-200 rounded-xl text-center">
        <div className="text-2xl mb-2">🙏</div>
        <div className="font-semibold text-slate-700">Quote Decline हो गई</div>
        <div className="text-sm text-slate-500 mt-1">आपके feedback के लिए धन्यवाद।</div>
      </div>
    );
  }

  return (
    <div className="text-center space-y-3">
      {error && (
        <div className="px-4 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>
      )}

      <div className="flex items-center justify-center gap-3">
        <button
          onClick={handleAccept}
          disabled={loading}
          className="px-8 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold rounded-xl text-base transition-colors"
        >
          {loading ? 'Processing…' : '✅ Quote Accept करें'}
        </button>
        <button
          onClick={() => setDeclineOpen(!declineOpen)}
          disabled={loading}
          className="px-6 py-3 border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50 font-semibold rounded-xl text-base transition-colors"
        >
          ✗ Decline
        </button>
      </div>

      {declineOpen && (
        <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-left">
          <label className="block text-sm font-medium text-slate-700">
            Decline करने की वजह
            <span className="ml-1 text-xs text-slate-400 font-normal">(optional)</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Price too high / requirement changed…"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeclineOpen(false)}
              className="px-3.5 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
              Cancel
            </button>
            <button onClick={handleDecline} disabled={loading}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-semibold rounded-lg">
              {loading ? 'Processing…' : 'Confirm Decline'}
            </button>
          </div>
        </div>
      )}

      <div className="text-xs text-slate-400">
        Accept करने पर हमारी team आपसे invoice और next steps के लिए contact करेगी।
      </div>
    </div>
  );
}
