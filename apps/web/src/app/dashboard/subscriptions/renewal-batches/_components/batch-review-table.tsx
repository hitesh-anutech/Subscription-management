'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SendEmailModal } from '@/components/send-email-modal';
import { ViewPdfButton } from '@/components/view-pdf-button';
import { getBatchEmailPreviewAction, sendBatchAction, refreshBatchAction } from '../actions';

const DC_TLD: Record<string, string> = {
  in: 'in', com: 'com', eu: 'eu', com_au: 'com.au', jp: 'jp', sa: 'sa',
};

export interface RenewalBatch {
  id: string;
  organizationId: string;
  zohoCustomerName: string | null;
  zohoItemName: string | null;
  billingCycle: string;
  domainCount: number;
  unitPrice: string;
  totalAmount: string;
  zohoEstimateId: string | null;
  zohoEstimateNumber: string | null;
  hasAnnexure: boolean;
  createdAt: string;
  createdBy: string | null;
  subscriptionIds: string[];
  matchedDomains?: string[];
  status?: string | null;
  zohoEstimateStatus?: string | null;
  zohoInvoiceStatus?: string | null;
  organization?: { zohoOrgId: string | null; dataCenter: string } | null;
}

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/** Zoho Books deep link — estimates live under the `#/quotes/` web route (not `#/estimates/`). */
function quoteDeepLink(b: RenewalBatch): string | null {
  if (!b.organization?.zohoOrgId || !b.zohoEstimateId) return null;
  const tld = DC_TLD[b.organization.dataCenter] ?? 'com';
  return `https://books.zoho.${tld}/app/${b.organization.zohoOrgId}#/quotes/${b.zohoEstimateId}`;
}

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  draft:          { label: 'Draft',         cls: 'bg-slate-100 text-slate-600' },
  sent:           { label: 'Sent',          cls: 'bg-blue-100 text-blue-700' },
  accepted:       { label: 'Accepted',      cls: 'bg-emerald-100 text-emerald-700' },
  declined:       { label: 'Declined',      cls: 'bg-red-100 text-red-700' },
  expired:        { label: 'Expired',       cls: 'bg-orange-100 text-orange-700' },
  invoiced:       { label: 'Invoiced',      cls: 'bg-indigo-100 text-indigo-700' },
  paid:           { label: 'Paid',          cls: 'bg-emerald-100 text-emerald-700' },
};

function StatusBadge({ status }: { status?: string | null }) {
  const key = (status ?? 'draft').toLowerCase();
  const s = STATUS_STYLES[key] ?? { label: status ?? '—', cls: 'bg-slate-100 text-slate-600' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

/** Refresh/sync icon — spins while refreshing. */
function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg className={`w-4 h-4 ${spinning ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function BatchReviewTable({ batches }: { batches: RenewalBatch[] }) {
  const router = useRouter();
  const sendable = batches.filter(b => b.zohoEstimateId);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy]         = useState<Set<string>>(new Set());   // batch ids mid-action
  const [bulkBusy, setBulkBusy] = useState(false);
  const [msg, setMsg]           = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [composeBatch, setComposeBatch] = useState<RenewalBatch | null>(null);

  const allSelected = sendable.length > 0 && sendable.every(b => selected.has(b.id));

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(sendable.map(b => b.id)));
  };
  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const markBusy = (id: string, on: boolean) =>
    setBusy(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });

  /** Bulk-send the given batch ids with Zoho's default template (no per-email compose). */
  const bulkSend = async (ids: string[]) => {
    if (!ids.length) return;
    if (!confirm(`${ids.length} quote${ids.length > 1 ? 's' : ''} customer ko Zoho default template se bhejein?`)) return;
    setBulkBusy(true);
    setMsg(null);
    let ok = 0;
    const errors: string[] = [];
    for (const id of ids) {
      const res = await sendBatchAction(id);
      if (res.error) errors.push(`${id.slice(0, 8)}: ${res.error}`);
      else ok++;
    }
    setBulkBusy(false);
    setSelected(new Set());
    setMsg(errors.length
      ? { kind: 'err', text: `${ok} sent, ${errors.length} failed — ${errors.join(' | ')}` }
      : { kind: 'ok', text: `✅ ${ok} quote${ok > 1 ? 's' : ''} sent.` });
    router.refresh();
  };

  const refreshOne = async (id: string) => {
    markBusy(id, true);
    setMsg(null);
    const res = await refreshBatchAction(id);
    markBusy(id, false);
    if (res.error) setMsg({ kind: 'err', text: res.error });
    else router.refresh();
  };

  const refreshAll = async () => {
    setBulkBusy(true);
    setMsg(null);
    for (const b of sendable) await refreshBatchAction(b.id);
    setBulkBusy(false);
    setMsg({ kind: 'ok', text: '🔄 Status refreshed.' });
    router.refresh();
  };

  return (
    <>
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">
          {selected.size > 0 ? `${selected.size} selected` : `${sendable.length} quote${sendable.length === 1 ? '' : 's'}`}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={() => bulkSend([...selected])}
            disabled={bulkBusy || selected.size === 0}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg"
          >
            ✉ Send Selected ({selected.size})
          </button>
          <button
            type="button"
            onClick={() => bulkSend(sendable.map(b => b.id))}
            disabled={bulkBusy || sendable.length === 0}
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold rounded-lg"
          >
            ✉ Send All
          </button>
          <button
            type="button"
            onClick={refreshAll}
            disabled={bulkBusy}
            className="px-3 py-1.5 border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5"
          >
            <SyncIcon spinning={bulkBusy} /> Refresh All
          </button>
        </div>
      </div>

      {msg && (
        <div className={`px-4 py-2 text-xs ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-3 py-3 w-8">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
            </th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Date</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Customer</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Item</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Cycle</th>
            <th className="text-right px-4 py-3 font-medium text-slate-600">Domains</th>
            <th className="text-right px-4 py-3 font-medium text-slate-600">Total</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Estimate</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {batches.map((batch) => {
            const link = quoteDeepLink(batch);
            const rowBusy = busy.has(batch.id);
            return (
              <tr key={batch.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-3 py-3 align-top">
                  <input
                    type="checkbox"
                    checked={selected.has(batch.id)}
                    onChange={() => toggleOne(batch.id)}
                    disabled={!batch.zohoEstimateId}
                    aria-label="Select batch"
                  />
                </td>
                <td className="px-4 py-3 align-top">
                  <p className="text-sm font-medium text-slate-800">{fmt(batch.createdAt)}</p>
                  <p className="text-xs text-slate-400">{fmtTime(batch.createdAt)}</p>
                  {batch.createdBy && <p className="text-xs text-slate-400">{batch.createdBy}</p>}
                </td>
                <td className="px-4 py-3 align-top">
                  <p className="font-medium text-slate-800 truncate max-w-40">{batch.zohoCustomerName ?? '—'}</p>
                  {batch.matchedDomains && batch.matchedDomains.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1 max-w-52">
                      {batch.matchedDomains.map((d) => (
                        <span key={d} title="Matched domain"
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-green-100 text-green-700">
                          🔗 {d}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <p className="text-slate-700 truncate max-w-40 text-xs">{batch.zohoItemName ?? '—'}</p>
                  {batch.hasAnnexure && (
                    <span className="mt-1 inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-purple-100 text-purple-700">
                      📎 Annexure
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                    {batch.billingCycle}
                  </span>
                </td>
                <td className="px-4 py-3 text-right align-top">
                  <span className={`font-semibold ${batch.hasAnnexure ? 'text-purple-700' : 'text-slate-700'}`}>
                    {batch.domainCount}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-semibold text-slate-800 align-top">
                  ₹{Number(batch.totalAmount).toLocaleString('en-IN')}
                </td>
                <td className="px-4 py-3 align-top">
                  {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer"
                      className="font-mono text-xs text-blue-600 hover:underline">
                      {batch.zohoEstimateNumber ?? 'Open'} ↗
                    </a>
                  ) : (
                    <span className="font-mono text-xs text-slate-500">{batch.zohoEstimateNumber ?? '—'}</span>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <StatusBadge status={batch.status} />
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-col items-start gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => { setMsg(null); setComposeBatch(batch); }}
                        disabled={!batch.zohoEstimateId}
                        className="text-xs px-2.5 py-1 rounded-md font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 transition-colors"
                        title="Compose & send this quote"
                      >
                        ✉ Send
                      </button>
                      <button
                        type="button"
                        onClick={() => refreshOne(batch.id)}
                        disabled={rowBusy}
                        title="Sync status from Zoho Books"
                        className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                      >
                        <SyncIcon spinning={rowBusy} />
                      </button>
                      <ViewPdfButton
                        orgId={batch.organizationId}
                        kind="estimate"
                        docId={batch.zohoEstimateId}
                        title="View this quote's PDF"
                      />
                    </div>
                    <Link
                      href={`/dashboard/subscriptions?ids=${batch.subscriptionIds.join(',')}`}
                      className="text-xs font-medium text-purple-600 hover:text-purple-800 hover:underline whitespace-nowrap"
                    >
                      View Subscriptions ({batch.subscriptionIds.length}) →
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {composeBatch && (
        <SendEmailModal
          title="✉ Send Quote Email"
          sendLabel="✉ Send Quote"
          docLabel="Quote"
          previewFn={(tpl) => getBatchEmailPreviewAction(composeBatch.id, tpl)}
          sendFn={(override) => sendBatchAction(composeBatch.id, override)}
          onClose={() => setComposeBatch(null)}
          onSent={() => { setComposeBatch(null); router.refresh(); }}
        />
      )}
    </>
  );
}
