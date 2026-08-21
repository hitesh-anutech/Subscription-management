'use client';

import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { generateRenewalQuoteAction } from '../actions';

function SendBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="w-full px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-sm font-semibold rounded-lg transition-colors">
      {pending ? 'Sending to Zoho…' : '⚡ Direct Renew (1-Click)'}
    </button>
  );
}

interface Props {
  subscriptionId: string;
  currentPrice: number;
  currentQuantity: number;
  currentEndDate: string;
  billingCycle: string;
}

export function RenewalQuoteForm({
  subscriptionId, currentPrice, currentQuantity, currentEndDate, billingCycle,
}: Props) {
  const boundAction = generateRenewalQuoteAction.bind(null, subscriptionId);
  const [state, action] = useFormState(
    async (_prev: { success?: boolean; error?: string; zohoEstimateNumber?: string } | null, fd: FormData) =>
      boundAction(fd),
    null,
  );

  const nextStart = new Date(currentEndDate);
  nextStart.setDate(nextStart.getDate() + 1);
  const nextStartStr = nextStart.toISOString().split('T')[0];

  return (
    <form action={action} className="space-y-4">
      {state?.error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {state.error}
        </div>
      )}
      {state?.success && (
        <div className="px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
          ✅ Renewal quote Zoho में create हो गई!
          {state.zohoEstimateNumber && (
            <span className="ml-2 font-mono font-semibold">{state.zohoEstimateNumber}</span>
          )}
        </div>
      )}

      <div className="bg-slate-50 rounded-lg px-4 py-3 text-xs text-slate-600 border border-slate-200">
        <p>New period: <strong>{nextStartStr}</strong> → <em>{billingCycle} cycle</em></p>
        <p className="mt-0.5">Renewal price: <strong>₹{currentPrice.toLocaleString('en-IN')}</strong> × {currentQuantity} licenses</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Override Price (optional)
          </label>
          <input
            name="override_price"
            type="number"
            min={0}
            step={0.01}
            placeholder={String(currentPrice)}
            className="w-full px-3 py-2 rounded border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Override Quantity (optional)
          </label>
          <input
            name="override_quantity"
            type="number"
            min={1}
            step={1}
            placeholder={String(currentQuantity)}
            className="w-full px-3 py-2 rounded border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SendBtn />
        <Link
          href={`/dashboard/quick-quotes/new?mode=renewal&subscription_id=${subscriptionId}`}
          className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors text-center"
        >
          ✏️ Renew & Customize
        </Link>
      </div>
    </form>
  );
}
