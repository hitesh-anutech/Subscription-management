'use client';

import { useState, useEffect, useRef } from 'react';
import { QuickEditModal } from './quick-edit-modal';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

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

export interface CandidateSnapshot {
  start: string;
  end: string;
  qty: number;
  rate: number;
  billingCycle: string;
  invoiceNumber?: string;
  quoteNumber?: string;
}

// Fix 1 — DD-MM-YYYY format
function formatDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

const LIFECYCLE_COLOR: Record<string, string> = {
  Active:        'bg-emerald-100 text-emerald-700',
  Expiring_Soon: 'bg-amber-100 text-amber-700',
  Expired:       'bg-red-100 text-red-700',
  Pending:       'bg-slate-100 text-slate-600',
  Cancelled:     'bg-slate-100 text-slate-400',
  Inactive:      'bg-slate-100 text-slate-400',
};

function differs(a: string | number, b: string | number) {
  return String(a).trim() !== String(b).trim();
}

interface InfoCardProps {
  match: SubscriptionCheckResult;
  candidate: CandidateSnapshot;
  onEdit: () => void;
  onSynced: () => void;
  onClose: () => void;
}

function InfoCard({ match, candidate, onEdit, onSynced, onClose }: InfoCardProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');

  // Detect if fetched data differs from existing subscription
  const dateDiffers   = differs(match.startDate, candidate.start) || differs(match.endDate, candidate.end);
  const priceDiffers  = differs(match.subscriptionPrice, candidate.rate);
  const qtyDiffers    = differs(match.quantity, candidate.qty);
  const cycleDiffers  = differs(match.billingCycle, candidate.billingCycle);
  const hasChanges    = dateDiffers || priceDiffers || qtyDiffers || cycleDiffers;

  const handleSync = async () => {
    setSyncing(true);
    setSyncError('');
    try {
      const res = await fetch(`${API_BASE}/subscriptions/${match.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate:         candidate.start,
          endDate:           candidate.end,
          quantity:          candidate.qty,
          subscriptionPrice: candidate.rate,
          billingCycle:      candidate.billingCycle,
          ...(candidate.invoiceNumber && { lastInvoiceNumber: candidate.invoiceNumber }),
          ...(candidate.quoteNumber   && { lastQuoteNumber:   candidate.quoteNumber }),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onClose();
      onSynced();
    } catch (e: unknown) {
      setSyncError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSyncing(false);
    }
  };

  const currSymbol = match.currency !== 'INR' ? match.currency : '₹';

  return (
    // Fix 2 — pointer-events-auto so mouse can enter the card
    <div className="absolute right-0 top-6 z-50 w-72 bg-white border border-slate-200 rounded-xl shadow-xl text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 pt-3 pb-2 border-b border-slate-100">
        <div>
          <p className="font-bold text-slate-800 font-mono">{match.subscriptionNumber}</p>
          <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${LIFECYCLE_COLOR[match.lifecycleStatus] ?? 'bg-slate-100 text-slate-600'}`}>
            {match.lifecycleStatus.replace('_', ' ')}
          </span>
          {match.processStatus && match.processStatus !== 'None' && (
            <span className="ml-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700">
              {match.processStatus.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-base leading-none pl-2">✕</button>
      </div>

      {/* Comparison table — existing vs fetched */}
      <div className="px-3.5 py-2.5 space-y-1">
        <div className="grid grid-cols-3 gap-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
          <span></span><span>Existing</span><span className="text-blue-500">From Invoice</span>
        </div>

        {/* Start date */}
        <div className={`grid grid-cols-3 gap-1 items-center py-0.5 rounded px-1 ${dateDiffers ? 'bg-orange-50' : ''}`}>
          <span className="text-slate-400">Start</span>
          <span className="font-mono">{formatDate(match.startDate)}</span>
          <span className={`font-mono ${dateDiffers ? 'text-orange-600 font-semibold' : 'text-slate-400'}`}>
            {formatDate(candidate.start) || '—'}
          </span>
        </div>

        {/* End date */}
        <div className={`grid grid-cols-3 gap-1 items-center py-0.5 rounded px-1 ${dateDiffers ? 'bg-orange-50' : ''}`}>
          <span className="text-slate-400">End</span>
          <span className="font-mono">{formatDate(match.endDate)}</span>
          <span className={`font-mono ${dateDiffers ? 'text-orange-600 font-semibold' : 'text-slate-400'}`}>
            {formatDate(candidate.end) || '—'}
          </span>
        </div>

        {/* Price */}
        <div className={`grid grid-cols-3 gap-1 items-center py-0.5 rounded px-1 ${priceDiffers ? 'bg-orange-50' : ''}`}>
          <span className="text-slate-400">Price</span>
          <span>{currSymbol}{match.subscriptionPrice.toLocaleString('en-IN')}</span>
          <span className={priceDiffers ? 'text-orange-600 font-semibold' : 'text-slate-400'}>
            {currSymbol}{candidate.rate.toLocaleString('en-IN')}
          </span>
        </div>

        {/* Qty */}
        <div className={`grid grid-cols-3 gap-1 items-center py-0.5 rounded px-1 ${qtyDiffers ? 'bg-orange-50' : ''}`}>
          <span className="text-slate-400">Qty</span>
          <span>{match.quantity}</span>
          <span className={qtyDiffers ? 'text-orange-600 font-semibold' : 'text-slate-400'}>{candidate.qty}</span>
        </div>

        {/* Cycle */}
        <div className={`grid grid-cols-3 gap-1 items-center py-0.5 rounded px-1 ${cycleDiffers ? 'bg-orange-50' : ''}`}>
          <span className="text-slate-400">Cycle</span>
          <span>{match.billingCycle}</span>
          <span className={cycleDiffers ? 'text-orange-600 font-semibold' : 'text-slate-400'}>{candidate.billingCycle}</span>
        </div>
      </div>

      {/* Doc refs */}
      {(match.lastInvoiceNumber || match.lastQuoteNumber) && (
        <div className="px-3.5 py-2 border-t border-slate-100 space-y-0.5 text-[10px]">
          {match.lastInvoiceNumber && (
            <p className="text-slate-400">Invoice: <span className="font-mono text-slate-600">{match.lastInvoiceNumber}</span></p>
          )}
          {match.lastQuoteNumber && (
            <p className="text-slate-400">Quote: <span className="font-mono text-slate-600">{match.lastQuoteNumber}</span></p>
          )}
        </div>
      )}

      {syncError && (
        <p className="mx-3.5 mb-2 text-red-600 text-[10px] bg-red-50 px-2 py-1 rounded">❌ {syncError}</p>
      )}

      {/* Actions */}
      <div className="flex gap-1.5 px-3.5 pb-3 pt-2 border-t border-slate-100">
        {/* Sync from Invoice */}
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={syncing || !hasChanges}
          title={!hasChanges ? 'Already in sync with invoice data' : 'Update subscription with invoice dates/price/qty'}
          className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-colors ${
            hasChanges
              ? 'bg-orange-500 hover:bg-orange-600 text-white'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          {syncing ? 'Syncing…' : hasChanges ? '↓ Sync from Invoice' : '✓ In Sync'}
        </button>

        {/* Edit */}
        <button
          type="button"
          onClick={() => { onClose(); onEdit(); }}
          className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-semibold transition-colors"
        >
          ✏ Edit
        </button>

        {/* View */}
        <a
          href={`/dashboard/subscriptions/${match.id}`}
          target="_blank"
          rel="noreferrer"
          className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-[10px] font-semibold transition-colors whitespace-nowrap"
        >
          View ↗
        </a>
      </div>
    </div>
  );
}

interface Props {
  match: SubscriptionCheckResult | null;
  isLoading: boolean;
  isOverride: boolean;
  candidateData: CandidateSnapshot;
  onEditSaved: () => void;
}

export function SubscriptionStatusCell({ match, isLoading, isOverride, candidateData, onEditSaved }: Props) {
  // Fix 2 — click-to-toggle, outside click closes
  const [cardOpen,  setCardOpen]  = useState(false);
  const [showEdit,  setShowEdit]  = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setCardOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [cardOpen]);

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
      <div ref={wrapperRef} className="relative inline-flex items-center gap-1">
        {/* Status badge */}
        <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${
          isOverride
            ? 'bg-orange-50 text-orange-700 border-orange-200'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
        }`}>
          {isOverride ? '⚠ Override' : '✓ Exists'}
        </span>

        {/* "i" button — click to toggle card */}
        <button
          type="button"
          onClick={() => setCardOpen((o) => !o)}
          className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center leading-none transition-colors ${
            cardOpen ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
          }`}
          aria-label="Show subscription details"
        >
          i
        </button>

        {/* Info card — Fix 2+3: click-based, pointer-events-auto, actions inside */}
        {cardOpen && (
          <InfoCard
            match={match}
            candidate={candidateData}
            onEdit={() => setShowEdit(true)}
            onSynced={onEditSaved}
            onClose={() => setCardOpen(false)}
          />
        )}
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
