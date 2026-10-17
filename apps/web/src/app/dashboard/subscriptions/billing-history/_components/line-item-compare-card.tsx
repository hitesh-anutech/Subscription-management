'use client';

import { useState } from 'react';
import { CheckCircle2, AlertCircle, HelpCircle, RefreshCw } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

export interface LineItem {
  name: string;
  qty: number;
  rate: number;
  domain: string;
  startDate: string;
  endDate: string;
  costPrice: number | null;
  itemId: string;
}

export interface SubscriptionMatch {
  id: string;
  subscriptionNumber: string;
  lifecycleStatus: string;
  startDate: string;
  endDate: string;
  quantity: number;
  subscriptionPrice: number;
  billingCycle: string;
  currency: string;
  zohoItemName: string;
  lastInvoiceNumber: string | null;
  lastQuoteNumber: string | null;
}

interface Props {
  lineItem: LineItem;
  match: SubscriptionMatch | null;
  businessType: string;
  onSynced: () => void;
}

function differs(a: string | number, b: string | number) {
  return String(a).trim() !== String(b).trim();
}

function detectBillingCycle(start: string, end: string): string {
  if (!start || !end) return 'annual';
  const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000);
  if (days <= 35)  return 'monthly';
  if (days <= 95)  return 'quarterly';
  if (days <= 190) return 'half_yearly';
  if (days <= 370) return 'annual';
  if (days <= 740) return 'biennial';
  return 'triennial';
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function fmtMoney(amount: number | null | undefined, currency = 'INR'): string {
  if (amount == null) return '—';
  const sym: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };
  const s = sym[currency] ?? `${currency} `;
  return `${s}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const LIFECYCLE_COLOR: Record<string, string> = {
  Active:        'bg-emerald-100 text-emerald-700',
  Expiring_Soon: 'bg-amber-100 text-amber-700',
  Expired:       'bg-red-100 text-red-700',
  Pending:       'bg-slate-100 text-slate-600',
};

export function LineItemCompareCard({ lineItem, match, businessType, onSynced }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError]   = useState('');
  const [done, setDone]     = useState(false);

  const isProRata = businessType === 'ProRata';
  const invoiceCycle = detectBillingCycle(lineItem.startDate, lineItem.endDate);

  // ── mismatch detection ──────────────────────────────────────────────
  const dateDiffers_  = match ? differs(match.startDate, lineItem.startDate) || differs(match.endDate, lineItem.endDate) : false;
  const priceDiffers_ = match ? differs(match.subscriptionPrice, lineItem.rate) : false;
  const qtyDiffers_   = match ? differs(match.quantity, lineItem.qty) : false;
  const cycleDiffers_ = match ? differs(match.billingCycle, invoiceCycle) : false;
  const costDiffers_  = (match && lineItem.costPrice != null)
    ? differs(lineItem.costPrice, 0) // just show if costPrice is available from invoice
    : false;

  const hasChanges = isProRata
    ? lineItem.qty > 0
    : dateDiffers_ || priceDiffers_ || qtyDiffers_ || cycleDiffers_ || costDiffers_;

  const allInSync = match && !hasChanges;

  const handleSync = async () => {
    if (!match) return;
    setSyncing(true);
    setError('');
    try {
      const body = isProRata
        ? { quantity: Number(match.quantity) + lineItem.qty }
        : {
            startDate:         lineItem.startDate,
            endDate:           lineItem.endDate,
            subscriptionPrice: lineItem.rate,
            quantity:          lineItem.qty,
            billingCycle:      invoiceCycle,
            ...(lineItem.costPrice != null ? { costPrice: lineItem.costPrice } : {}),
          };

      const res = await fetch(`${API_BASE}/subscriptions/${match.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDone(true);
      onSynced();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      {/* ── Header ── */}
      <div className="flex items-start justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 text-sm truncate">{lineItem.name}</p>
          {lineItem.domain && (
            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-50 text-blue-700 border border-blue-100">
              {lineItem.domain}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 ml-3 shrink-0">
          {isProRata && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700">Pro-rata</span>
          )}
          {!match && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
              <HelpCircle size={10} /> No Subscription
            </span>
          )}
          {match && (done || allInSync) && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
              <CheckCircle2 size={10} /> In Sync
            </span>
          )}
          {match && !done && !allInSync && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700">
              <AlertCircle size={10} /> Mismatch
            </span>
          )}
        </div>
      </div>

      {/* ── Subscription ref ── */}
      {match && (
        <div className="px-4 pt-2.5 pb-1 flex items-center gap-2">
          <span className="text-[10px] font-mono text-slate-500">{match.subscriptionNumber}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${LIFECYCLE_COLOR[match.lifecycleStatus] ?? 'bg-slate-100 text-slate-600'}`}>
            {match.lifecycleStatus.replace('_', ' ')}
          </span>
        </div>
      )}

      {/* ── Comparison body ── */}
      {match && (
        <div className="px-4 py-2 space-y-0.5">

          {/* Column headers */}
          {!isProRata && (
            <div className="grid grid-cols-3 gap-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5 px-1">
              <span />
              <span>System</span>
              <span className="text-blue-500">Invoice</span>
            </div>
          )}

          {/* ProRata: additive qty view */}
          {isProRata && (
            <div className="py-2">
              <div className="grid grid-cols-3 gap-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2 px-1">
                <span>System Qty</span>
                <span className="text-blue-500">+Invoice Qty</span>
                <span className="text-emerald-600">After Sync</span>
              </div>
              <div className="grid grid-cols-3 gap-2 items-center px-1 py-1 bg-blue-50 rounded-lg">
                <span className="font-semibold text-slate-700">{match.quantity}</span>
                <span className="font-semibold text-blue-600">+{lineItem.qty}</span>
                <span className="font-bold text-emerald-700">{Number(match.quantity) + lineItem.qty}</span>
              </div>
            </div>
          )}

          {/* Non-ProRata: full comparison */}
          {!isProRata && (
            <>
              {/* Start date */}
              <div className={`grid grid-cols-3 gap-2 items-center py-0.5 px-1 rounded ${dateDiffers_ ? 'bg-orange-50' : ''}`}>
                <span className="text-[11px] text-slate-400">Start</span>
                <span className="text-[11px] font-mono">{fmtDate(match.startDate)}</span>
                <span className={`text-[11px] font-mono ${dateDiffers_ ? 'text-orange-600 font-semibold' : 'text-slate-400'}`}>
                  {fmtDate(lineItem.startDate) || '—'}
                </span>
              </div>

              {/* End date */}
              <div className={`grid grid-cols-3 gap-2 items-center py-0.5 px-1 rounded ${dateDiffers_ ? 'bg-orange-50' : ''}`}>
                <span className="text-[11px] text-slate-400">End</span>
                <span className="text-[11px] font-mono">{fmtDate(match.endDate)}</span>
                <span className={`text-[11px] font-mono ${dateDiffers_ ? 'text-orange-600 font-semibold' : 'text-slate-400'}`}>
                  {fmtDate(lineItem.endDate) || '—'}
                </span>
              </div>

              {/* Billing cycle */}
              <div className={`grid grid-cols-3 gap-2 items-center py-0.5 px-1 rounded ${cycleDiffers_ ? 'bg-orange-50' : ''}`}>
                <span className="text-[11px] text-slate-400">Cycle</span>
                <span className="text-[11px]">{match.billingCycle}</span>
                <span className={`text-[11px] ${cycleDiffers_ ? 'text-orange-600 font-semibold' : 'text-slate-400'}`}>{invoiceCycle}</span>
              </div>

              {/* Price */}
              <div className={`grid grid-cols-3 gap-2 items-center py-0.5 px-1 rounded ${priceDiffers_ ? 'bg-orange-50' : ''}`}>
                <span className="text-[11px] text-slate-400">Price</span>
                <span className="text-[11px]">{fmtMoney(match.subscriptionPrice, match.currency)}</span>
                <span className={`text-[11px] ${priceDiffers_ ? 'text-orange-600 font-semibold' : 'text-slate-400'}`}>
                  {fmtMoney(lineItem.rate, match.currency)}
                </span>
              </div>

              {/* Quantity */}
              <div className={`grid grid-cols-3 gap-2 items-center py-0.5 px-1 rounded ${qtyDiffers_ ? 'bg-orange-50' : ''}`}>
                <span className="text-[11px] text-slate-400">Qty</span>
                <span className="text-[11px]">{match.quantity}</span>
                <span className={`text-[11px] ${qtyDiffers_ ? 'text-orange-600 font-semibold' : 'text-slate-400'}`}>{lineItem.qty}</span>
              </div>

              {/* Cost price (only if available from invoice) */}
              {lineItem.costPrice != null && (
                <div className="grid grid-cols-3 gap-2 items-center py-0.5 px-1 rounded">
                  <span className="text-[11px] text-slate-400">Cost</span>
                  <span className="text-[11px] text-slate-400">—</span>
                  <span className="text-[11px] text-slate-600">{fmtMoney(lineItem.costPrice, match.currency)}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Footer / Actions ── */}
      <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between gap-2">
        {error && <p className="text-[10px] text-red-600 bg-red-50 px-2 py-1 rounded flex-1">{error}</p>}

        {match && (
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing || done || allInSync || !hasChanges}
            className="ml-auto flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg font-medium transition-colors
              disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed
              bg-blue-600 text-white hover:bg-blue-700"
          >
            {syncing && <RefreshCw size={11} className="animate-spin" />}
            {done || allInSync
              ? '✓ In Sync'
              : isProRata
                ? `Add +${lineItem.qty} to Subscription`
                : 'Sync'}
          </button>
        )}

        {!match && (
          <span className="ml-auto text-[10px] text-slate-400 italic">No matching subscription found</span>
        )}
      </div>
    </div>
  );
}
