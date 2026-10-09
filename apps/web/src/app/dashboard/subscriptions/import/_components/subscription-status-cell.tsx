'use client';

import { useState } from 'react';
import { QuickEditModal } from './quick-edit-modal';

export interface SubscriptionCheckResult {
  id: string;
  subscriptionNumber: string;
  lifecycleStatus: string;
  processStatus: string;
  startDate: string;
  endDate: string;
  quantity: number;
  subscriptionPrice: number;
  billingCycle: string;
  autoRenew: boolean;
  currency: string;
  exchangeRate: number;
  zohoItemId: string;
  zohoItemName: string;
  lastQuoteNumber: string | null;
  lastInvoiceNumber: string | null;
  subscriptionCategory: string | null;
}

const LIFECYCLE_COLOR: Record<string, string> = {
  Active:         'bg-emerald-100 text-emerald-700',
  Expiring_Soon:  'bg-amber-100 text-amber-700',
  Expired:        'bg-red-100 text-red-700',
  Pending:        'bg-slate-100 text-slate-600',
  Cancelled:      'bg-slate-100 text-slate-400',
  Inactive:       'bg-slate-100 text-slate-400',
};

function InfoCard({ match }: { match: SubscriptionCheckResult }) {
  return (
    <div className="absolute right-0 top-6 z-50 w-64 bg-white border border-slate-200 rounded-xl shadow-xl p-3.5 text-xs space-y-2 pointer-events-none">
      <p className="font-bold text-slate-800 font-mono">{match.subscriptionNumber}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${LIFECYCLE_COLOR[match.lifecycleStatus] ?? 'bg-slate-100 text-slate-600'}`}>
          {match.lifecycleStatus.replace('_', ' ')}
        </span>
        {match.processStatus && match.processStatus !== 'None' && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700">
            {match.processStatus.replace(/_/g, ' ')}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-slate-600 pt-1.5 border-t border-slate-100">
        <span className="text-slate-400">Start</span><span className="font-mono">{match.startDate}</span>
        <span className="text-slate-400">End</span><span className="font-mono">{match.endDate}</span>
        <span className="text-slate-400">Price</span>
        <span className="font-semibold">
          {match.currency !== 'INR' ? match.currency : '₹'}
          {match.subscriptionPrice.toLocaleString('en-IN')} / {match.billingCycle}
        </span>
        <span className="text-slate-400">Qty</span><span>{match.quantity}</span>
      </div>
      {(match.lastInvoiceNumber || match.lastQuoteNumber) && (
        <div className="pt-1.5 border-t border-slate-100 space-y-0.5">
          {match.lastInvoiceNumber && (
            <p className="text-slate-400">Invoice: <span className="font-mono text-slate-600">{match.lastInvoiceNumber}</span></p>
          )}
          {match.lastQuoteNumber && (
            <p className="text-slate-400">Quote: <span className="font-mono text-slate-600">{match.lastQuoteNumber}</span></p>
          )}
        </div>
      )}
      <a
        href={`/dashboard/subscriptions?search=${match.subscriptionNumber}`}
        target="_blank"
        rel="noreferrer"
        className="block text-blue-500 hover:underline pt-0.5 pointer-events-auto"
      >
        View →
      </a>
    </div>
  );
}

interface Props {
  match: SubscriptionCheckResult | null;
  isLoading: boolean;
  isOverride: boolean;
  onEditSaved: () => void;
}

export function SubscriptionStatusCell({ match, isLoading, isOverride, onEditSaved }: Props) {
  const [showInfo, setShowInfo] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  if (isLoading) {
    return (
      <td className="px-3 py-2">
        <div className="h-4 w-20 bg-slate-100 rounded animate-pulse" />
      </td>
    );
  }

  if (!match) {
    return (
      <td className="px-3 py-2">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-semibold border border-amber-200 whitespace-nowrap">
          ✗ No Sub
        </span>
      </td>
    );
  }

  return (
    <td className="px-3 py-2">
      <div className="flex items-center gap-1">
        <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${
          isOverride
            ? 'bg-orange-50 text-orange-700 border-orange-200'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
        }`}>
          {isOverride ? '⚠ Override' : '✓ Exists'}
        </span>

        {/* Info hover button */}
        <div
          className="relative"
          onMouseEnter={() => setShowInfo(true)}
          onMouseLeave={() => setShowInfo(false)}
        >
          <button
            type="button"
            className="w-4 h-4 rounded-full bg-blue-100 text-blue-600 text-[9px] font-bold hover:bg-blue-200 flex items-center justify-center leading-none"
            aria-label="Show subscription details"
          >
            i
          </button>
          {showInfo && <InfoCard match={match} />}
        </div>

        {/* Edit button */}
        <button
          type="button"
          onClick={() => setShowEdit(true)}
          className="w-4 h-4 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center text-[10px]"
          title="Edit existing subscription"
        >
          ✏
        </button>
      </div>

      {showEdit && (
        <QuickEditModal
          match={match}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); onEditSaved(); }}
        />
      )}
    </td>
  );
}
