'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, GitCompareArrows } from 'lucide-react';
import { LineItemCompareCard, type LineItem, type SubscriptionMatch } from './line-item-compare-card';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

interface BillingHistoryItem {
  id: string;
  businessType: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  zohoCustomerId: string | null;
  organization: { id: string; zohoOrgId: string; dataCenter: string };
}

interface Props {
  open: boolean;
  onClose: () => void;
  item: BillingHistoryItem;
}

interface BatchCheckResult {
  [key: string]: SubscriptionMatch | null;
}

type LoadState = 'idle' | 'loading' | 'error';

export function CompareModal({ open, onClose, item }: Props) {
  const [lineItems, setLineItems]   = useState<LineItem[]>([]);
  const [matches, setMatches]       = useState<BatchCheckResult>({});
  const [loadState, setLoadState]   = useState<LoadState>('idle');
  const [errorMsg, setErrorMsg]     = useState('');

  const orgId     = item.organization.id;
  const docId     = item.invoiceId ?? item.quoteId ?? '';
  const docKind   = item.invoiceId ? 'invoice' : 'estimate';
  const docNumber = item.invoiceNumber ?? item.quoteNumber ?? '';

  const load = useCallback(async () => {
    if (!docId) return;
    setLoadState('loading');
    setErrorMsg('');
    try {
      // 1. Fetch line items
      const liRes = await fetch(
        `${API_BASE}/organizations/${orgId}/zoho-doc-line-items?kind=${docKind}&doc_id=${docId}`,
        { credentials: 'include' },
      );
      if (!liRes.ok) throw new Error(`Line items fetch failed (${liRes.status})`);
      const liData = await liRes.json() as { lineItems: LineItem[] };
      const items  = liData.lineItems ?? [];
      setLineItems(items);

      if (items.length === 0) { setLoadState('idle'); return; }

      // 2. Batch-check each line item against subscriptions
      const candidates = items.map((li, idx) => ({
        key:             `${idx}:${li.domain}:${li.name}`,
        organizationId:  orgId,
        zohoCustomerId:  item.zohoCustomerId ?? '',
        zohoItemId:      li.itemId,
        domainName:      li.domain,
        zohoItemName:    li.name,
      }));

      const bcRes = await fetch(`${API_BASE}/subscriptions/batch-check`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: candidates }),
      });
      if (!bcRes.ok) throw new Error(`Batch-check failed (${bcRes.status})`);
      const bcData = await bcRes.json() as BatchCheckResult;
      setMatches(bcData);
      setLoadState('idle');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
      setLoadState('error');
    }
  }, [docId, docKind, orgId, item.zohoCustomerId]);

  useEffect(() => {
    if (open && docId) void load();
    if (!open) { setLineItems([]); setMatches({}); setLoadState('idle'); setErrorMsg(''); }
  }, [open, load, docId]);

  const keys        = lineItems.map((li, idx) => `${idx}:${li.domain}:${li.name}`);
  const totalItems  = lineItems.length;
  const inSyncCount = keys.filter(k => {
    const m = matches[k];
    if (!m) return false;
    // trivially in-sync if match exists (user may have just synced)
    return true;
  }).length;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50 rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <GitCompareArrows size={18} className="text-blue-600" />
            <div>
              <h2 className="font-bold text-slate-800 text-sm leading-tight">
                Compare with Subscriptions
              </h2>
              {docNumber && (
                <p className="text-[11px] text-slate-500 font-mono">{docNumber}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {loadState === 'idle' && totalItems > 0 && (
              <span className="text-[11px] text-slate-500">
                {totalItems} line item{totalItems !== 1 ? 's' : ''}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">

          {/* Loading */}
          {loadState === 'loading' && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
              <RefreshCw size={24} className="animate-spin" />
              <p className="text-sm">Fetching invoice data and matching subscriptions…</p>
            </div>
          )}

          {/* Error */}
          {loadState === 'error' && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">{errorMsg}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="text-sm text-blue-600 hover:underline"
              >
                Retry
              </button>
            </div>
          )}

          {/* Empty */}
          {loadState === 'idle' && totalItems === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
              <p className="text-sm">No line items found for this document.</p>
            </div>
          )}

          {/* Cards */}
          {loadState === 'idle' && lineItems.map((li, idx) => {
            const key = keys[idx];
            return (
              <LineItemCompareCard
                key={key}
                lineItem={li}
                match={matches[key] ?? null}
                businessType={item.businessType}
                onSynced={() => void load()}
              />
            );
          })}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-4 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
