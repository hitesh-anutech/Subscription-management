'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createSubscriptionsBulkAction, createInvoiceForQuoteAction, sendInvoiceEmailAction, type BulkSubContext, type BulkSubRow } from '../actions';

// Billing cycle → add duration
export function calcEndDate(startStr: string, cycle: string): string {
  if (!startStr) return '';
  const d = new Date(startStr);
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
  return d.toISOString().split('T')[0];
}

export const BILLING_CYCLES = [
  { value: 'monthly',     label: 'Monthly' },
  { value: 'quarterly',   label: 'Quarterly' },
  { value: 'half_yearly', label: 'Half-Yearly' },
  { value: 'annual',      label: 'Annual' },
  { value: 'biennial',    label: 'Biennial (2 yr)' },
  { value: 'triennial',   label: 'Triennial (3 yr)' },
  { value: 'one_time',    label: 'One-Time' },
];

export interface SubItem {
  zohoItemId: string | null;
  zohoItemName: string;
  quantity: number;
  price: number;
  costPrice?: number | null;
  billingCycle: string | null;
  primaryDomain: string | null;
  serviceStartDate?: string | null;
  serviceEndDate?: string | null;
}

/** items query param → SubItem[]; malformed/absent JSON → []. */
export function parseItems(raw: string | null): SubItem[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as SubItem[]) : [];
  } catch {
    return [];
  }
}

// Shared column template for the header + item rows (keeps cells aligned):
// checkbox · item · domain · cycle · qty · price · cost · start · end · amount
const GRID =
  'grid grid-cols-[24px_minmax(170px,1.4fr)_minmax(140px,1fr)_112px_56px_80px_80px_122px_122px_88px] gap-2 items-center';
const CELL_INPUT =
  'w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400';

interface RowState {
  include: boolean;
  done: boolean;          // created successfully in a previous submit
  error: string | null;   // per-row failure from the last submit
  zohoItemId: string | null;
  zohoItemName: string;
  domain: string;
  quantity: number;
  price: number;
  costPrice: number;
  billingCycle: string;
  startDate: string;
  endDate: string;
}

export function MultiSubscriptionForm({ items, ctx }: { items: SubItem[]; ctx: BulkSubContext }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [invoiceNum, setInvoiceNum] = useState<string | null>(ctx.zohoInvoiceNumber ?? null);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [sendErr, setSendErr] = useState<string | null>(null);

  const today = new Date().toISOString().split('T')[0];
  const [rows, setRows] = useState<RowState[]>(() =>
    items.map((it) => {
      const cycle = it.billingCycle ?? 'annual';
      const start = it.serviceStartDate || today;
      return {
        include: true,
        done: false,
        error: null,
        zohoItemId: it.zohoItemId,
        zohoItemName: it.zohoItemName,
        domain: it.primaryDomain ?? '',
        quantity: it.quantity ?? 1,
        price: it.price ?? 0,
        costPrice: it.costPrice ?? 0,
        billingCycle: cycle,
        startDate: start,
        endDate: it.serviceEndDate || calcEndDate(start, cycle),
      };
    }),
  );

  const patchRow = (i: number, patch: Partial<RowState>) =>
    setRows((prev) => prev.map((r, idx) => {
      if (idx !== i) return r;
      const next = { ...r, ...patch };
      // cycle/start change → re-derive end date (still editable directly)
      if (('billingCycle' in patch || 'startDate' in patch) && !('endDate' in patch)) {
        next.endDate = calcEndDate(next.startDate, next.billingCycle);
      }
      return next;
    }));

  const selected = rows.filter((r) => r.include && !r.done);
  const missing = selected
    .filter((r) => !r.domain.trim() || !r.startDate || !r.endDate)
    .map((r) => r.zohoItemName);
  const totalValue = selected.reduce((s, r) => s + r.quantity * r.price, 0);
  const allDone = rows.every((r) => r.done);

  /** Build the invoice items array from current row state (all rows, not just selected). */
  const invoiceItemsFromRows = () =>
    rows.map((r) => ({
      domainName:   r.domain.trim(),
      billingCycle: r.billingCycle,
      startDate:    r.startDate,
      endDate:      r.endDate,
      costPrice:    r.costPrice,
    }));

  /** Call the create-invoice endpoint and update state. Does NOT auto-redirect — user can send invoice first. */
  const createInvoiceAndNavigate = async (invoiceItems: ReturnType<typeof invoiceItemsFromRows>) => {
    if (!ctx.quoteId) { router.push('/dashboard/subscriptions'); return; }
    try {
      const inv = await createInvoiceForQuoteAction(ctx.quoteId, invoiceItems);
      setInvoiceNum(inv.zohoInvoiceNumber ?? inv.zohoInvoiceId);
      setBanner(null);
    } catch (err) {
      setBanner({ kind: 'err', text: err instanceof Error ? err.message : 'Invoice create nahi hui' });
    }
  };

  const handleSendInvoice = async () => {
    if (!ctx.quoteId) return;
    setSendState('sending');
    setSendErr(null);
    const result = await sendInvoiceEmailAction(ctx.quoteId);
    if (result.ok) {
      setSendState('sent');
    } else {
      setSendState('idle');
      setSendErr(result.error ?? 'Email send nahi hui');
    }
  };

  const submit = () => {
    setBanner(null);
    const payload: BulkSubRow[] = [];
    const rowIdx: number[] = [];
    rows.forEach((r, i) => {
      if (!r.include || r.done) return;
      payload.push({
        zohoItemId: r.zohoItemId,
        zohoItemName: r.zohoItemName,
        domainName: r.domain.trim(),
        quantity: r.quantity,
        price: r.price,
        costPrice: r.costPrice,
        billingCycle: r.billingCycle,
        startDate: r.startDate,
        endDate: r.endDate,
      });
      rowIdx.push(i);
    });
    startTransition(async () => {
      const res = await createSubscriptionsBulkAction(ctx, payload);
      setRows((prev) => prev.map((r, i) => {
        const at = rowIdx.indexOf(i);
        if (at === -1) return r;
        const out = res.results[at];
        return out?.ok ? { ...r, done: true, error: null } : { ...r, error: out?.error ?? 'Failed' };
      }));
      const failed = res.results.filter((x) => !x.ok).length;
      if (failed === 0) {
        // All subscriptions created — now create the Zoho invoice.
        await createInvoiceAndNavigate(invoiceItemsFromRows());
      } else {
        setBanner({
          kind: res.created > 0 ? 'ok' : 'err',
          text: `${res.created} created, ${failed} failed — नीचे errors देखें और दोबारा try करें।`,
        });
        router.refresh();
      }
    });
  };

  const handleSkip = () => {
    startTransition(async () => {
      // Skip subscriptions — create invoice with current row data (domain may be blank).
      await createInvoiceAndNavigate(invoiceItemsFromRows());
    });
  };

  return (
    <div className="max-w-6xl space-y-6">
      {/* Header */}
      <div>
        <nav className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
          <Link href="/dashboard/subscriptions" className="hover:text-slate-600">Subscriptions</Link>
          <span>›</span>
          <span className="text-slate-600">New Subscriptions</span>
        </nav>
        <h1 className="text-2xl font-bold text-slate-900">
          Create Subscription{items.length === 1 ? '' : 's'} ({items.length} item{items.length === 1 ? '' : 's'})
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Domain name और subscription dates confirm करो — ✓ Create Subscriptions से सब बनेगा और Zoho Invoice भी।
        </p>
      </div>

      {/* Invoice confirmation card — shown after invoice is created; user can send before navigating away */}
      {invoiceNum && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-emerald-600 text-lg">🧾</span>
            <div>
              <p className="text-sm font-semibold text-emerald-800">Zoho Invoice Created</p>
              <p className="text-xs text-emerald-600 font-mono">{invoiceNum}</p>
            </div>
            <p className="ml-auto text-xs text-emerald-700">{ctx.zohoCustomerName}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-emerald-100">
            {sendState === 'sent' ? (
              <span className="text-xs text-emerald-700 font-medium">✅ Invoice customer को email हो गई</span>
            ) : (
              <button
                type="button"
                onClick={() => void handleSendInvoice()}
                disabled={sendState === 'sending'}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                {sendState === 'sending' ? '⏳ Sending…' : '📧 Send Invoice to Customer'}
              </button>
            )}
            {sendErr && <span className="text-xs text-red-600">⚠ {sendErr}</span>}
            <Link href="/dashboard/subscriptions"
              className="ml-auto px-3.5 py-1.5 border border-emerald-300 text-emerald-700 text-xs font-medium rounded-lg hover:bg-emerald-100">
              ← Go to Subscriptions
            </Link>
          </div>
        </div>
      )}

      {banner && (
        <div className={`px-4 py-3 text-sm rounded-xl border ${
          banner.kind === 'ok'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {banner.text}
        </div>
      )}

      {missing.length > 0 && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl">
          ⚠️ इन items में Domain / dates missing हैं: <b>{missing.join(', ')}</b>
        </div>
      )}

      {/* Item rows — compact table: one line per item so bulk invoices fit on screen */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <div className="min-w-[1060px]">
          <div className={GRID + ' px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wide'}>
            <span />
            <span>Item</span>
            <span>Domain</span>
            <span>Cycle</span>
            <span>Qty</span>
            <span>Price ₹</span>
            <span>Cost ₹</span>
            <span>Start</span>
            <span>End <span className="normal-case font-normal text-slate-400">auto</span></span>
            <span className="text-right">Amount</span>
          </div>

          {rows.map((r, i) => {
            const dim = !r.include && !r.done;
            const locked = pending || r.done || !r.include;
            return (
              <div key={i} className={`border-b border-slate-100 last:border-b-0 ${
                r.done ? 'bg-emerald-50/50' : r.error ? 'bg-red-50/40' : ''
              }`}>
                <div className={GRID + ` px-4 py-2 ${dim ? 'opacity-50' : ''}`}>
                  {r.done ? (
                    <span className="text-emerald-600 text-sm" title="Subscription बन गई">✅</span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={r.include}
                      disabled={pending}
                      onChange={(e) => patchRow(i, { include: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  )}
                  <span className="text-sm font-medium text-slate-800 truncate" title={r.zohoItemName}>
                    {r.zohoItemName}
                  </span>
                  <input type="text" value={r.domain} placeholder="example.com" disabled={locked}
                    onChange={(e) => patchRow(i, { domain: e.target.value })}
                    className={CELL_INPUT} />
                  <select value={r.billingCycle} disabled={locked}
                    onChange={(e) => patchRow(i, { billingCycle: e.target.value })}
                    className={CELL_INPUT + ' bg-white'}>
                    {BILLING_CYCLES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <input type="number" min={1} value={r.quantity} disabled={locked}
                    onChange={(e) => patchRow(i, { quantity: Number(e.target.value) })}
                    className={CELL_INPUT} />
                  <input type="number" min={0} value={r.price} disabled={locked}
                    onChange={(e) => patchRow(i, { price: Number(e.target.value) })}
                    className={CELL_INPUT} />
                  <input type="number" min={0} value={r.costPrice} disabled={locked}
                    onChange={(e) => patchRow(i, { costPrice: Number(e.target.value) })}
                    className={CELL_INPUT} />
                  <input type="date" value={r.startDate} disabled={locked}
                    onChange={(e) => patchRow(i, { startDate: e.target.value })}
                    className={CELL_INPUT} />
                  <input type="date" value={r.endDate} disabled={locked}
                    onChange={(e) => patchRow(i, { endDate: e.target.value })}
                    className={CELL_INPUT} />
                  <span className="text-sm font-semibold text-slate-700 text-right whitespace-nowrap">
                    ₹{(r.quantity * r.price).toLocaleString('en-IN')}
                  </span>
                </div>
                {r.error && (
                  <p className="px-4 pb-2 -mt-0.5 text-xs text-red-600">⚠ {r.error}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary + actions */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center gap-4">
        <div>
          <p className="text-sm text-slate-500">{selected.length} of {rows.length} items selected</p>
          <p className="text-lg font-bold text-blue-800">₹{totalValue.toLocaleString('en-IN')}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {allDone ? (
            <Link href="/dashboard/subscriptions"
              className="px-5 py-2.5 border border-slate-300 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50">
              ← Back to Subscriptions
            </Link>
          ) : (
            <button type="button" onClick={handleSkip} disabled={pending}
              className="px-5 py-2.5 border border-slate-300 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">
              {pending ? 'Processing…' : 'Skip (बाद में बनाएँ)'}
            </button>
          )}
          {!allDone && (
            <button type="button" onClick={submit}
              disabled={pending || selected.length === 0 || missing.length > 0}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors">
              {pending ? 'Creating…' : `✓ Create ${selected.length} Subscription${selected.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
