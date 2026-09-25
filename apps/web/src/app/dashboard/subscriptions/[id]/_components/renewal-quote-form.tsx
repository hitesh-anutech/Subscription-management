'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { ZohoItemSearch } from '../../../quick-quotes/_components/zoho-search';

interface AddonItem {
  id: number;
  zohoItemId: string;
  itemName: string;
  itemSearch: string;
  quantity: number;
  rate: number;
}

interface Props {
  subscriptionId: string;
  orgId: string;
  currentPrice: number;
  currentQuantity: number;
  currentEndDate: string;
  billingCycle: string;
}

let nextId = 0;

export function RenewalQuoteForm({
  subscriptionId, orgId, currentPrice, currentQuantity, currentEndDate, billingCycle,
}: Props) {
  const router = useRouter();
  const [overridePrice, setOverridePrice]       = useState('');
  const [overrideQuantity, setOverrideQuantity] = useState('');
  const [addonItems, setAddonItems]             = useState<AddonItem[]>([]);
  const [addonsOpen, setAddonsOpen]             = useState(false);
  const [pending, setPending]                   = useState(false);
  const [result, setResult]                     = useState<{
    success?: boolean; error?: string; zohoEstimateNumber?: string; zohoWarning?: string;
  } | null>(null);

  const nextStart = new Date(currentEndDate);
  nextStart.setDate(nextStart.getDate() + 1);

  function calcEnd(start: Date, cycle: string): Date {
    const d = new Date(start);
    switch (cycle) {
      case 'monthly':     d.setMonth(d.getMonth() + 1); break;
      case 'quarterly':   d.setMonth(d.getMonth() + 3); break;
      case 'half_yearly': d.setMonth(d.getMonth() + 6); break;
      case 'annual':      d.setFullYear(d.getFullYear() + 1); break;
      case 'biennial':    d.setFullYear(d.getFullYear() + 2); break;
      case 'triennial':   d.setFullYear(d.getFullYear() + 3); break;
      default:            d.setFullYear(d.getFullYear() + 1);
    }
    d.setDate(d.getDate() - 1);
    return d;
  }

  function fmtDate(d: Date) {
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  const nextEnd = calcEnd(nextStart, billingCycle);
  const nextStartStr = fmtDate(nextStart);
  const nextEndStr   = fmtDate(nextEnd);

  function addAddon() {
    setAddonItems(prev => [...prev, { id: nextId++, zohoItemId: '', itemName: '', itemSearch: '', quantity: 1, rate: 0 }]);
    if (!addonsOpen) setAddonsOpen(true);
  }

  function removeAddon(id: number) {
    setAddonItems(prev => prev.filter(a => a.id !== id));
  }

  function updateAddon(id: number, patch: Partial<AddonItem>) {
    setAddonItems(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    setPending(true);

    const body: Record<string, unknown> = {};
    if (overridePrice    && Number(overridePrice)    > 0) body.overridePrice    = Number(overridePrice);
    if (overrideQuantity && Number(overrideQuantity) > 0) body.overrideQuantity = Number(overrideQuantity);

    const filledAddons = addonItems.filter(a => a.zohoItemId && a.rate > 0);
    if (filledAddons.length > 0) {
      body.addonItems = filledAddons.map(a => ({
        zohoItemId: a.zohoItemId,
        itemName:   a.itemName,
        quantity:   a.quantity,
        rate:       a.rate,
      }));
    }

    try {
      const data = await api.post<{ zoho_estimate_number?: string; zoho_warning?: string }>(
        `/subscriptions/${subscriptionId}/renewal-quote`,
        body,
      );
      setResult({ success: true, zohoEstimateNumber: data.zoho_estimate_number, zohoWarning: data.zoho_warning });
      router.refresh();
    } catch (err: any) {
      setResult({ error: err?.message ?? 'Renewal quote failed' });
    } finally {
      setPending(false);
    }
  }

  const filledAddonCount = addonItems.filter(a => a.zohoItemId).length;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {result?.error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {result.error}
        </div>
      )}
      {result?.success && !result.zohoWarning && (
        <div className="px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
          ✅ Renewal quote Zoho में create हो गई!
          {result.zohoEstimateNumber && (
            <span className="ml-2 font-mono font-semibold">{result.zohoEstimateNumber}</span>
          )}
        </div>
      )}
      {result?.success && result.zohoWarning && (
        <div className="px-4 py-3 rounded-lg bg-yellow-50 border border-yellow-300 text-yellow-800 text-sm">
          ⚠️ Renewal record saved, but Zoho quote creation failed.
          <div className="mt-1 text-xs opacity-80">{result.zohoWarning}</div>
        </div>
      )}

      <div className="bg-slate-50 rounded-lg px-4 py-3 text-xs text-slate-600 border border-slate-200">
        <p>New period: <strong>{nextStartStr}</strong> → <strong>{nextEndStr}</strong> · <em>{billingCycle} cycle</em></p>
        <p className="mt-0.5">Renewal price: <strong>₹{currentPrice.toLocaleString('en-IN')}</strong> × {currentQuantity} licenses</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Override Price (optional)</label>
          <input
            type="number" min={0} step={0.01}
            placeholder={String(currentPrice)}
            value={overridePrice}
            onChange={e => setOverridePrice(e.target.value)}
            className="w-full px-3 py-2 rounded border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Override Quantity (optional)</label>
          <input
            type="number" min={1} step={1}
            placeholder={String(currentQuantity)}
            value={overrideQuantity}
            onChange={e => setOverrideQuantity(e.target.value)}
            className="w-full px-3 py-2 rounded border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Addon Items */}
      <div className="rounded-lg border border-amber-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setAddonsOpen(o => !o)}
          className="w-full flex items-center justify-between px-3 py-2 bg-amber-50 hover:bg-amber-100 transition-colors text-left"
        >
          <span className="text-xs font-semibold text-amber-800 flex items-center gap-2">
            ＋ Addon Items
            {filledAddonCount > 0 && (
              <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {filledAddonCount}
              </span>
            )}
          </span>
          <span className="text-amber-600 text-[10px]">{addonsOpen ? '▲' : '▼'}</span>
        </button>

        {addonsOpen && (
          <div className="p-3 bg-amber-50/50 border-t border-amber-200 space-y-2">
            {addonItems.map((addon, idx) => (
              <div key={addon.id} className="rounded border border-amber-200 bg-white p-2 space-y-1.5">
                {/* item search — full width */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide shrink-0">
                    Item {idx + 1}
                  </span>
                  <div className="flex-1">
                    <ZohoItemSearch
                      orgId={orgId}
                      value={addon.itemSearch}
                      onChange={name => updateAddon(addon.id, { itemSearch: name, zohoItemId: '', itemName: '' })}
                      onSelect={(zohoItemId, name, rate) =>
                        updateAddon(addon.id, { zohoItemId, itemName: name, itemSearch: name, rate })
                      }
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAddon(addon.id)}
                    className="w-6 h-6 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 text-sm leading-none shrink-0"
                  >
                    ×
                  </button>
                </div>
                {/* qty + rate on same line */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide block mb-0.5">Qty</label>
                    <input
                      type="number" min={1} step={1}
                      value={addon.quantity}
                      onChange={e => updateAddon(addon.id, { quantity: Number(e.target.value) || 1 })}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 text-xs text-center focus:outline-none focus:ring-1 focus:ring-amber-400 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide block mb-0.5">Rate (₹)</label>
                    <input
                      type="number" min={0} step={1}
                      value={addon.rate || ''}
                      onChange={e => updateAddon(addon.id, { rate: Number(e.target.value) || 0 })}
                      placeholder="0"
                      className="w-full px-2 py-1.5 rounded border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 tabular-nums"
                    />
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={addAddon}
              className="text-xs font-medium text-amber-700 border border-dashed border-amber-400 rounded px-3 py-1.5 hover:bg-amber-100 transition-colors w-full"
            >
              ＋ Add Item
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="submit"
          disabled={pending}
          className="w-full px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {pending ? 'Sending to Zoho…' : '⚡ Direct Renew (1-Click)'}
        </button>
        <Link
          href={`/dashboard/quick-quotes/new?mode=renewal&subscription_id=${subscriptionId}`}
          className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors text-center"
        >
          ✏️ Renew &amp; Customize
        </Link>
      </div>
    </form>
  );
}
