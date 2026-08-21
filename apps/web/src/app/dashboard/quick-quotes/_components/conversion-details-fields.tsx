'use client';

import { useState } from 'react';

/**
 * Subscription-decision radio captured at the Convert/Push step.
 * Domain + service dates are NOT asked here anymore — every quote item already
 * carries its own domain, and dates are reviewed per-item on the Subscription
 * Creation list view (the screen right after Convert).
 */
const DECISION_OPTIONS = [
  { value: 'create_now', label: 'हाँ, अभी बनाओ', hint: 'invoice के बाद सीधे Subscription list खुलेगी — हर item review करके बनाओ' },
  { value: 'later',      label: 'बाद में (Ask me later)', hint: '"Create Subscription" button quote page पर दिखता रहेगा' },
  { value: 'never',      label: 'नहीं — one-time deal', hint: 'subscription नहीं बनेगी (बाद में बदल सकते हैं)' },
] as const;

export function ConversionDetailsFields({
  showSubscriptionChoice = true,
}: {
  /** Show the "Subscription banani hai?" radio — pass false when the quote has no subscription items. */
  showSubscriptionChoice?: boolean;
}) {
  const [decision, setDecision] = useState<string>('create_now');

  if (!showSubscriptionChoice) return null;

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1.5">
        Items को Subscription में convert करना है?
      </label>
      <div className="space-y-1.5">
        {DECISION_OPTIONS.map((opt) => (
          <label key={opt.value}
            className={`flex items-start gap-2 px-2.5 py-1.5 rounded border cursor-pointer text-xs transition-colors ${
              decision === opt.value ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'
            }`}>
            <input
              type="radio"
              name="subscription_decision"
              value={opt.value}
              checked={decision === opt.value}
              onChange={() => setDecision(opt.value)}
              className="mt-0.5 accent-emerald-600"
            />
            <span>
              <span className="font-medium text-slate-700">{opt.label}</span>
              <span className="block text-slate-400">{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
