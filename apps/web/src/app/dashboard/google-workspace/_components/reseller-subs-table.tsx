'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition, useCallback, useRef, useEffect } from 'react';
import type { ResellerSubRow } from '../page';
import type { ResellerJob } from '../actions';
import {
  fetchResellerSubscriptionsAction,
  fetchResellerCustomersAction,
  getResellerJobStatusAction,
  reconcileAllAction,
  reconcileOneAction,
  refreshSubscriptionAction,
  refreshCustomerAction,
  updateAdditionalDomainsAction,
  setExcludedAction,
  importCustomerUidsAction,
  updateCustomerUidAction,
} from '../actions';

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------
const ALL_COLUMNS = [
  { id: 'customerDomain',        label: 'Domain',              defaultOn: true,  defaultW: 180, sortable: true },
  { id: 'orgName',               label: 'Organization',        defaultOn: true,  defaultW: 210, sortable: true },
  { id: 'skuName',               label: 'Plan (SKU)',          defaultOn: true,  defaultW: 220, sortable: true },
  { id: 'seatsLicensed',         label: 'Seats',               defaultOn: true,  defaultW: 72,  sortable: true },
  { id: 'googleStatus',          label: 'Google Status',       defaultOn: true,  defaultW: 110, sortable: true },
  { id: 'resellerSlot',          label: 'Reseller',            defaultOn: true,  defaultW: 90,  sortable: true },
  { id: 'reconciliationStatus',  label: 'Match',               defaultOn: true,  defaultW: 190, sortable: true },
  { id: 'subscriptionFetchedAt', label: 'Last Fetch',          defaultOn: true,  defaultW: 140, sortable: true },
  { id: 'customerId',            label: 'Customer ID',         defaultOn: false, defaultW: 120, sortable: true },
  { id: 'skuId',                 label: 'SKU ID',              defaultOn: false, defaultW: 140, sortable: false },
  { id: 'planName',              label: 'Plan Type',           defaultOn: false, defaultW: 130, sortable: true },
  { id: 'isInTrial',             label: 'In Trial',            defaultOn: false, defaultW: 76,  sortable: false },
  { id: 'trialEndTime',          label: 'Trial End',           defaultOn: false, defaultW: 110, sortable: false },
  { id: 'renewalType',           label: 'Renewal',             defaultOn: false, defaultW: 130, sortable: false },
  { id: 'contactName',           label: 'Contact',             defaultOn: false, defaultW: 150, sortable: true },
  { id: 'alternateEmail',        label: 'Alt Email',           defaultOn: false, defaultW: 170, sortable: false },
  { id: 'countryCode',           label: 'Country',             defaultOn: false, defaultW: 76,  sortable: true },
  { id: 'resellerEmail',         label: 'Reseller Email',      defaultOn: false, defaultW: 170, sortable: false },
  { id: 'googleCreationTime',    label: 'G. Created',          defaultOn: false, defaultW: 120, sortable: true },
  { id: 'customerFetchedAt',     label: 'Cust. Fetched',       defaultOn: false, defaultW: 140, sortable: true },
  { id: 'additionalDomains',     label: 'Additional Domains',  defaultOn: false, defaultW: 190, sortable: false },
  { id: 'matchedSubscription',   label: 'Matched Sub',         defaultOn: false, defaultW: 130, sortable: false },
  { id: 'appSeats',              label: 'App Seats',           defaultOn: false, defaultW: 76,  sortable: true },
  { id: 'customerUid',           label: 'Customer UID',        defaultOn: false, defaultW: 130, sortable: false },
  { id: 'partnerSalesConsole',   label: 'Partner Console',     defaultOn: false, defaultW: 120, sortable: false },
] as const;

type ColumnId = typeof ALL_COLUMNS[number]['id'];
type ColDef = typeof ALL_COLUMNS[number];

// ---------------------------------------------------------------------------
// LocalStorage helpers
// ---------------------------------------------------------------------------
const SK_VISIBLE = 'gws_recon_columns_v2';
const SK_ORDER   = 'gws_recon_col_order_v2';
const SK_WIDTHS  = 'gws_recon_col_widths_v2';

function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
}
function lsSet(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

function loadVisible(): Set<ColumnId> {
  return new Set(lsGet<ColumnId[]>(SK_VISIBLE, ALL_COLUMNS.filter(c => c.defaultOn).map(c => c.id)));
}
function loadOrder(): ColumnId[] {
  const saved = lsGet<ColumnId[]>(SK_ORDER, []);
  const allIds = ALL_COLUMNS.map(c => c.id);
  if (!saved.length) return [...allIds];
  const savedSet = new Set(saved);
  return [...saved.filter((id): id is ColumnId => allIds.includes(id as ColumnId)), ...allIds.filter(id => !savedSet.has(id))];
}
function loadWidths(): Partial<Record<ColumnId, number>> {
  return lsGet<Partial<Record<ColumnId, number>>>(SK_WIDTHS, {});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Add IST offset (+5:30) and use UTC getters — guarantees identical output on the Node.js server
// (which runs in UTC) and the browser (which uses the user's local timezone). Using getDate/getHours
// directly would produce different strings when the server TZ ≠ browser TZ → hydration mismatch.
function toIST(iso: string): Date {
  return new Date(new Date(iso).getTime() + 330 * 60 * 1000); // +5:30 in ms
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = toIST(iso);
  return `${d.getUTCDate().toString().padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear().toString().slice(2)}`;
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = toIST(iso);
  const h = d.getUTCHours() % 12 || 12;
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  const ampm = d.getUTCHours() >= 12 ? 'pm' : 'am';
  return `${d.getUTCDate().toString().padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}, ${h}:${m} ${ampm}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function GoogleStatusBadge({ status }: { status: string }) {
  const cls =
    status === 'ACTIVE'    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
    status === 'SUSPENDED' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                             'bg-gray-100 text-gray-500 border border-gray-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium ${cls}`}>
      {status}
    </span>
  );
}

function ReconStatusBadge({ status, flags, googleSeats, appSeats }: {
  status: string; flags: string[]; googleSeats: number | null; appSeats: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {status === 'matched'     && <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">✓ Matched</span>}
      {status === 'not_matched' && <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium bg-red-50 text-red-700 border border-red-200">✗ Not Matched</span>}
      {status === 'excluded'    && <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium bg-gray-100 text-gray-500 border border-gray-200">⊘ Excluded</span>}
      {flags.includes('seats_mismatch') && googleSeats !== null && appSeats !== null && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-orange-50 text-orange-700 border border-orange-200" title={`Google: ${googleSeats}, App: ${appSeats}`}>
          ⚠ {googleSeats}≠{appSeats}
        </span>
      )}
      {flags.includes('domain_alias_match') && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200" title="Matched via additional domain">
          ~ alias
        </span>
      )}
      {flags.includes('plan_mismatch') && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200" title="Matched on domain only — plan names differ between Google and local subscription">
          ⚠ Plan Mismatch
        </span>
      )}
    </div>
  );
}

function SlotBadge({ slot, email, name }: { slot: number; email: string | null; name?: string }) {
  const cls = slot === 1
    ? 'bg-violet-50 text-violet-700 border border-violet-200'
    : 'bg-indigo-50 text-indigo-700 border border-indigo-200';
  const label = name || `Slot ${slot}`;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium ${cls}`} title={email ?? `Slot ${slot}`}>
      {label}
    </span>
  );
}

function AdditionalDomainsEditor({ id, initial, onSaved }: { id: string; initial: string[]; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial.join(', '));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const save = () => {
    const domains = value.split(',').map(d => d.trim()).filter(Boolean);
    startTransition(async () => {
      const res = await updateAdditionalDomainsAction(id, domains);
      if (res.error) { setError(res.error); return; }
      setEditing(false); onSaved();
    });
  };
  if (!editing) return (
    <button onClick={() => setEditing(true)} className="text-[13px] text-gray-400 hover:text-gray-700 text-left w-full truncate" title="Edit additional domains">
      {initial.length > 0 ? initial.join(', ') : <span className="text-blue-500">+ Add domains</span>}
    </button>
  );
  return (
    <div className="flex flex-col gap-1 min-w-48">
      <input
        className="border border-gray-300 rounded px-2 py-1 text-[13px] w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
        value={value} onChange={e => setValue(e.target.value)} placeholder="domain1.com, domain2.com"
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} autoFocus
      />
      {error && <span className="text-red-500 text-xs">{error}</span>}
      <div className="flex gap-1">
        <button onClick={save} disabled={isPending}
          className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded hover:bg-blue-700 disabled:opacity-50">
          {isPending ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => setEditing(false)} className="text-xs text-gray-500 px-2 py-0.5 rounded hover:bg-gray-100">Cancel</button>
      </div>
    </div>
  );
}

function CustomerUidEditor({ id, initial, onSaved }: { id: string; initial: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial ?? '');
  const [isPending, startTransition] = useTransition();
  const save = () => startTransition(async () => { await updateCustomerUidAction(id, value); setEditing(false); onSaved(); });
  if (!editing) return (
    <button onClick={() => setEditing(true)} className="font-mono text-[13px] text-gray-600 hover:text-blue-600 text-left w-full truncate" title="Click to edit">
      {initial ?? <span className="text-gray-300 font-sans">+ Set UID</span>}
    </button>
  );
  return (
    <div className="flex items-center gap-1 min-w-36">
      <input
        className="border border-gray-300 rounded px-2 py-0.5 text-[13px] w-32 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
        value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} autoFocus
      />
      <button onClick={save} disabled={isPending} className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded hover:bg-blue-700 disabled:opacity-50">✓</button>
      <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
    </div>
  );
}

function ImportUidModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<Array<{ customerId: string; customerUid: string }>>([]);
  const [parseError, setParseError] = useState('');
  const [isParsed, setIsParsed] = useState(false);
  const [result, setResult] = useState<{ updated: number; notFound: number; total: number; notFoundIds: string[] } | null>(null);
  const [isPending, startTransition] = useTransition();

  const parseCsv = () => {
    setParseError('');
    const lines = csvText.trim().split('\n').filter(l => l.trim());
    if (!lines.length) { setParseError('कोई data नहीं मिला'); return; }
    const firstLine = lines[0].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    let cidIdx = -1, uidIdx = -1;
    firstLine.forEach((h, i) => {
      const lower = h.toLowerCase();
      if (['customerid','customer id','customer_id','cid'].some(v => lower.includes(v))) cidIdx = i;
      if (['customeruid','customer uid','customer_uid','uid'].some(v => lower.includes(v))) uidIdx = i;
    });
    const hasHeader = cidIdx >= 0 || uidIdx >= 0;
    const dataLines = hasHeader ? lines.slice(1) : lines;
    if (cidIdx < 0) cidIdx = 0;
    if (uidIdx < 0) uidIdx = 1;
    const parsed: Array<{ customerId: string; customerUid: string }> = [];
    const errors: string[] = [];
    dataLines.forEach((line, i) => {
      const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      const cid = cols[cidIdx] ?? '', uid = cols[uidIdx] ?? '';
      if (!cid && !uid) return;
      if (!cid) { errors.push(`Row ${i + 1}: Customer ID missing`); return; }
      if (!uid) { errors.push(`Row ${i + 1}: Customer UID missing`); return; }
      parsed.push({ customerId: cid, customerUid: uid });
    });
    if (errors.length) setParseError(errors.slice(0, 5).join('\n'));
    if (!parsed.length) { setParseError((parseError ? parseError + '\n' : '') + 'कोई valid row नहीं मिली'); return; }
    setPreview(parsed); setIsParsed(true);
  };

  const doImport = () => startTransition(async () => {
    const res = await importCustomerUidsAction(preview);
    if (res.error) { setParseError(res.error); return; }
    setResult(res.data ?? null); onDone();
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Import Customer UIDs</h2>
            <p className="text-[13px] text-gray-500 mt-0.5">Google Console CSV से Customer UID import करें</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-4 flex-1 overflow-y-auto">
          {!result ? (!isParsed ? (
            <>
              <div className="mb-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-[13px] text-blue-800">
                <p className="font-medium mb-1">Expected CSV format:</p>
                <code className="block font-mono text-xs">Customer ID,Customer UID</code>
                <code className="block font-mono text-xs">C01abc123,123456789</code>
              </div>
              <textarea
                className="w-full h-48 border border-gray-300 rounded-lg p-3 text-[13px] font-mono resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="CSV data यहाँ paste करें…" value={csvText}
                onChange={e => { setCsvText(e.target.value); setParseError(''); }}
              />
              {parseError && <pre className="mt-2 text-xs text-red-600 whitespace-pre-wrap">{parseError}</pre>}
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] text-gray-700">{preview.length} rows parsed — import confirm करें?</span>
                <button onClick={() => { setIsParsed(false); setParseError(''); }} className="text-[13px] text-blue-600 hover:underline">← Edit</button>
              </div>
              <div className="overflow-y-auto max-h-64 rounded-lg border border-gray-200">
                <table className="w-full text-[13px]">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer ID</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer UID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.slice(0, 200).map((row, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 font-mono text-gray-700">{row.customerId}</td>
                        <td className="px-3 py-1.5 font-mono text-gray-700">{row.customerUid}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.length > 200 && <p className="text-xs text-gray-400 mt-1">+ {preview.length - 200} more rows</p>}
            </>
          )) : (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="text-4xl">✅</div>
              <div>
                <p className="text-lg font-semibold text-gray-900">{result.updated} records updated</p>
                <p className="text-[13px] text-gray-500 mt-1">Total: {result.total} | Updated: {result.updated} | Not found: {result.notFound}</p>
                {result.notFoundIds.length > 0 && (
                  <p className="text-xs text-red-600 mt-2">
                    Not found: {result.notFoundIds.slice(0, 5).join(', ')}{result.notFoundIds.length > 5 ? ` +${result.notFoundIds.length - 5} more` : ''}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 hover:bg-gray-100 rounded-lg">{result ? 'Close' : 'Cancel'}</button>
          {!result && !isParsed && (
            <button onClick={parseCsv} disabled={!csvText.trim()} className="px-4 py-2 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              Parse CSV →
            </button>
          )}
          {!result && isParsed && (
            <button onClick={doImport} disabled={isPending} className="px-4 py-2 text-[13px] bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
              {isPending ? 'Importing…' : `Import ${preview.length} records`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RowActions({ row, onRefresh }: { row: ResellerSubRow; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState('');
  const act = (fn: () => Promise<unknown>, label: string) => {
    setOpen(false);
    startTransition(async () => { await fn(); setMsg(label); setTimeout(() => setMsg(''), 2000); onRefresh(); });
  };
  return (
    <div className="relative">
      {msg && <span className="absolute -top-5 right-0 text-xs text-green-600 whitespace-nowrap">{msg}</span>}
      <button
        onClick={() => setOpen(o => !o)} disabled={isPending}
        className="text-gray-400 hover:text-gray-700 disabled:opacity-40 w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-base"
      >
        {isPending ? '⋯' : '⋮'}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-52 rounded-md bg-white shadow-lg ring-1 ring-black/5 text-[13px] py-1">
          <button className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-2" onClick={() => act(() => refreshSubscriptionAction(row.id), '🔄 Sub refreshed')}>🔄 Refresh Subscription</button>
          <button className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-2" onClick={() => act(() => refreshCustomerAction(row.id), '👤 Customer refreshed')}>👤 Refresh Customer</button>
          <button className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-2" onClick={() => act(() => reconcileOneAction(row.id), '✓ Reconciled')}>✓ Re-Reconcile</button>
          <div className="border-t border-gray-100 my-1" />
          {row.reconciliationStatus !== 'excluded'
            ? <button className="w-full text-left px-4 py-2 hover:bg-gray-50 text-gray-500" onClick={() => act(() => setExcludedAction(row.id, true), '⊘ Excluded')}>⊘ Mark Excluded</button>
            : <button className="w-full text-left px-4 py-2 hover:bg-gray-50 text-blue-600" onClick={() => act(() => setExcludedAction(row.id, false), '↩ Un-excluded')}>↩ Un-exclude</button>
          }
        </div>
      )}
    </div>
  );
}

function ColumnModal({ visible, order, onChange, onClose }: {
  visible: Set<ColumnId>; order: ColumnId[];
  onChange: (v: Set<ColumnId>, o: ColumnId[]) => void; onClose: () => void;
}) {
  const toggle = (id: ColumnId) => {
    const next = new Set(visible);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next, order);
  };
  const reset = () => {
    onChange(new Set(ALL_COLUMNS.filter(c => c.defaultOn).map(c => c.id)), ALL_COLUMNS.map(c => c.id));
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end pt-16 pr-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl ring-1 ring-black/10 w-64 p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-[13px] text-gray-900">Columns</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="space-y-0.5 max-h-80 overflow-y-auto">
          {ALL_COLUMNS.map(col => (
            <label key={col.id} className="flex items-center gap-2.5 cursor-pointer py-1.5 hover:bg-gray-50 rounded px-2">
              <input type="checkbox" checked={visible.has(col.id)} onChange={() => toggle(col.id)}
                className="rounded border-gray-300 text-blue-600 w-3.5 h-3.5" />
              <span className="text-[13px] text-gray-700">{col.label}</span>
            </label>
          ))}
        </div>
        <button onClick={reset} className="mt-3 text-xs text-gray-400 hover:text-gray-600 underline">Reset to default</button>
      </div>
    </div>
  );
}

function SummaryChips({ summary, activeFilter, onFilter }: {
  summary: { matched: number; notMatched: number; excluded: number; all: number };
  activeFilter: string | undefined; onFilter: (v: string | undefined) => void;
}) {
  const chips = [
    { label: `All`,          count: summary.all,        value: undefined,      activeCls: 'bg-gray-900 text-white border-gray-900', baseCls: 'bg-white text-gray-700 border-gray-300 hover:border-gray-400' },
    { label: `✓ Matched`,    count: summary.matched,    value: 'matched',      activeCls: 'bg-emerald-600 text-white border-emerald-600', baseCls: 'bg-white text-emerald-700 border-emerald-300 hover:border-emerald-400' },
    { label: `✗ Not Matched`, count: summary.notMatched, value: 'not_matched', activeCls: 'bg-red-600 text-white border-red-600', baseCls: 'bg-white text-red-700 border-red-300 hover:border-red-400' },
    { label: `⊘ Excluded`,   count: summary.excluded,   value: 'excluded',     activeCls: 'bg-gray-600 text-white border-gray-600', baseCls: 'bg-white text-gray-500 border-gray-300 hover:border-gray-400' },
  ];
  return (
    <div className="flex flex-wrap gap-2 flex-shrink-0">
      {chips.map(c => (
        <button
          key={String(c.value)} onClick={() => onFilter(c.value)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[13px] font-medium border transition-all ${activeFilter === c.value ? c.activeCls : c.baseCls}`}
        >
          {c.label}
          <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold ${activeFilter === c.value ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {c.count}
          </span>
        </button>
      ))}
    </div>
  );
}

// Sort icon — Zoho-style up/down arrows
function SortIcon({ active, dir }: { active: boolean; dir?: 'asc' | 'desc' }) {
  if (!active) {
    return (
      <svg className="w-3 h-3 text-gray-300 flex-shrink-0" viewBox="0 0 12 12" fill="currentColor">
        <path d="M6 2L9 6H3L6 2Z" /><path d="M6 10L3 6H9L6 10Z" />
      </svg>
    );
  }
  return dir === 'desc'
    ? <svg className="w-3 h-3 text-blue-500 flex-shrink-0" viewBox="0 0 12 12" fill="currentColor"><path d="M6 10L3 4H9L6 10Z" /></svg>
    : <svg className="w-3 h-3 text-blue-500 flex-shrink-0" viewBox="0 0 12 12" fill="currentColor"><path d="M6 2L9 8H3L6 2Z" /></svg>;
}

// Drag grip icon (6-dot)
function GripIcon() {
  return (
    <svg className="w-3 h-3 text-gray-400 flex-shrink-0" viewBox="0 0 8 12" fill="currentColor">
      <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
      <circle cx="2" cy="6" r="1.2" /><circle cx="6" cy="6" r="1.2" />
      <circle cx="2" cy="10" r="1.2" /><circle cx="6" cy="10" r="1.2" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface Props {
  rows: ResellerSubRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: { matched: number; notMatched: number; excluded: number; all: number };
  skuNames: string[];
  resellerNames: { 1: string; 2: string };
  filters: {
    reconciliationStatus?: string;
    googleStatus?: string;
    resellerSlot?: string;
    skuName?: string;
    hasFlag?: string;
    search?: string;
    sortBy?: string;
    sortDir?: string;
  };
}

// ---------------------------------------------------------------------------
// Cell renderer
// ---------------------------------------------------------------------------
function renderCell(colId: ColumnId, row: ResellerSubRow, onRefresh: () => void, resellerNames?: { 1: string; 2: string }): React.ReactNode {
  switch (colId) {
    case 'customerDomain':
      return <span className="font-mono text-[13px] font-medium text-blue-700">{row.customerDomain}</span>;
    case 'orgName':
      return <span className="text-[13px] text-gray-800">{row.orgName ?? <span className="text-gray-300">—</span>}</span>;
    case 'skuName':
      return <span className="text-[13px] text-gray-700">{row.skuName ?? <span className="text-gray-300">—</span>}</span>;
    case 'seatsLicensed':
      return <span className="text-[13px] text-gray-900 font-medium text-center block">{row.seatsLicensed ?? <span className="text-gray-300">—</span>}</span>;
    case 'googleStatus':
      return <GoogleStatusBadge status={row.googleStatus} />;
    case 'resellerSlot':
      return <SlotBadge slot={row.resellerSlot} email={row.resellerEmail} name={resellerNames?.[row.resellerSlot as 1 | 2]} />;
    case 'reconciliationStatus':
      return <ReconStatusBadge status={row.reconciliationStatus} flags={row.reconciliationFlags} googleSeats={row.seatsLicensed} appSeats={row.appSeats} />;
    case 'subscriptionFetchedAt':
      return <span className="text-[13px] text-gray-500 whitespace-nowrap">{fmtDateTime(row.subscriptionFetchedAt)}</span>;
    case 'customerId':
      return <span className="font-mono text-[13px] text-gray-500">{row.customerId}</span>;
    case 'skuId':
      return <span className="font-mono text-[12px] text-gray-400">{row.skuId}</span>;
    case 'planName':
      return <span className="text-[13px] text-gray-600">{row.planName ?? '—'}</span>;
    case 'isInTrial':
      return <span className="text-[13px] text-center block">{row.isInTrial ? <span className="text-amber-700 font-medium">Trial</span> : '—'}</span>;
    case 'trialEndTime':
      return <span className="text-[13px] text-gray-500">{fmtDate(row.trialEndTime)}</span>;
    case 'renewalType':
      return <span className="text-[13px] text-gray-600">{row.renewalType ?? '—'}</span>;
    case 'contactName':
      return <span className="text-[13px] text-gray-700">{row.contactName ?? '—'}</span>;
    case 'alternateEmail':
      return <span className="text-[13px] text-gray-500 truncate block">{row.alternateEmail ?? '—'}</span>;
    case 'countryCode':
      return <span className="text-[13px] text-center block">{row.countryCode ?? '—'}</span>;
    case 'resellerEmail':
      return <span className="text-[13px] text-gray-500 truncate block">{row.resellerEmail ?? '—'}</span>;
    case 'googleCreationTime':
      return <span className="text-[13px] text-gray-500">{fmtDate(row.googleCreationTime)}</span>;
    case 'customerFetchedAt':
      return <span className="text-[13px] text-gray-500">{fmtDateTime(row.customerFetchedAt)}</span>;
    case 'additionalDomains':
      return <AdditionalDomainsEditor id={row.id} initial={row.additionalDomains} onSaved={onRefresh} />;
    case 'matchedSubscription':
      return row.matchedSubscription
        ? <a href={`/dashboard/subscriptions/${row.matchedSubscription.id}`} className="text-blue-600 hover:underline font-mono text-[13px]">{row.matchedSubscription.subscriptionNumber}</a>
        : <span className="text-gray-300">—</span>;
    case 'appSeats':
      return <span className="text-[13px] text-center block font-medium">{row.appSeats ?? <span className="text-gray-300">—</span>}</span>;
    case 'customerUid':
      return <CustomerUidEditor id={row.id} initial={row.customerUid} onSaved={onRefresh} />;
    case 'partnerSalesConsole':
      return row.customerUid
        ? <a href={`https://channelservices.cloud.google.com/customers/${row.customerUid}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-[13px]">Open ↗</a>
        : <span className="text-gray-300 text-[13px]">UID required</span>;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function ResellerSubsTable({ rows, total, page, limit, totalPages, summary, skuNames, resellerNames, filters }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize with deterministic defaults — localStorage is loaded in useEffect AFTER hydration.
  // If we read localStorage here, server (no localStorage) and client produce different initial
  // states → React hydration mismatch. After useEffect the columns snap to saved preferences.
  const [visibleCols, setVisibleCols]   = useState<Set<ColumnId>>(() => new Set(ALL_COLUMNS.filter(c => c.defaultOn).map(c => c.id)));
  const [colOrder, setColOrder]         = useState<ColumnId[]>(() => ALL_COLUMNS.map(c => c.id));
  const [colWidths, setColWidths]       = useState<Partial<Record<ColumnId, number>>>({});
  const [showColModal, setShowColModal] = useState(false);
  const [showFilters, setShowFilters]   = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showFetchDropdown, setShowFetchDropdown]       = useState(false);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<'both' | 1 | 2>('both');
  const [actionMsg, setActionMsg]   = useState('');
  const [loadingMsg, setLoadingMsg] = useState('');
  const [activeJob, setActiveJob]   = useState<ResellerJob | null>(null);
  const [dragOverCol, setDragOverCol] = useState<ColumnId | null>(null);
  const [isPending, startTransition] = useTransition();

  const dragColRef  = useRef<ColumnId | null>(null);
  const resizingRef = useRef<{ id: ColumnId; startX: number; startW: number } | null>(null);

  // ---- Sync localStorage → state after hydration (must NOT run on server) ----
  useEffect(() => {
    setVisibleCols(loadVisible());
    setColOrder(loadOrder());
    setColWidths(loadWidths());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Background job polling (every 2 seconds while a job is running) ----
  useEffect(() => {
    if (!activeJob?.jobId || activeJob.status !== 'running') return;

    const interval = setInterval(async () => {
      const job = await getResellerJobStatusAction(activeJob.jobId);

      if (job.status === 'done') {
        clearInterval(interval);
        setActiveJob(null);
        setLoadingMsg('');
        const isSub = job.type === 'fetch_subscriptions';
        showMsg(
          isSub
            ? `✓ ${(job.inserted + job.updated).toLocaleString()} subscriptions synced — ${job.inserted.toLocaleString()} new, ${job.updated.toLocaleString()} updated`
            : `✓ ${job.updated.toLocaleString()} customers updated, ${job.skipped.toLocaleString()} skipped`,
        );
        router.refresh();
      } else if (job.status === 'error') {
        clearInterval(interval);
        setActiveJob(null);
        setLoadingMsg('');
        showMsg(`❌ ${job.error ?? 'Unknown error'}`);
      } else {
        // Still running — update progress message
        setActiveJob(job);
        const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;
        const noun = job.type === 'fetch_subscriptions' ? 'subscriptions' : 'customers';
        setLoadingMsg(
          `⏳ Fetching ${noun}: ${job.processed.toLocaleString()} / ${job.total.toLocaleString()} (${pct}%)`,
        );
      }
    }, 2000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.jobId, activeJob?.status]);

  // Ordered visible columns
  const orderedVisible: ColDef[] = colOrder
    .filter(id => visibleCols.has(id))
    .map(id => ALL_COLUMNS.find(c => c.id === id)!)
    .filter(Boolean) as ColDef[];

  const getW = (id: ColumnId) => colWidths[id] ?? ALL_COLUMNS.find(c => c.id === id)?.defaultW ?? 130;

  // ---- URL / filter helpers ----
  const updateFilter = useCallback((key: string, value: string | undefined) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    params.delete('page');
    router.push(`/dashboard/google-workspace?${params.toString()}`);
  }, [searchParams, router]);

  const setPage = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(p));
    router.push(`/dashboard/google-workspace?${params.toString()}`);
  };

  const showMsg = (msg: string) => { setActionMsg(msg); setTimeout(() => setActionMsg(''), 5000); };

  const bulkAction = (
    fn: () => Promise<{ data?: unknown; error?: string }>,
    successFmt: (d: unknown) => string,
    startMsg?: string,
  ) => {
    if (startMsg) setLoadingMsg(startMsg);
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        setLoadingMsg('');
        showMsg(`❌ ${res.error}`);
        return;
      }
      // Check if the API returned a background jobId
      const data = res.data as Record<string, unknown> | undefined;
      if (data?.jobId && typeof data.jobId === 'string') {
        // Start polling — useEffect picks up the new activeJob
        const job: ResellerJob = {
          jobId: data.jobId as string,
          type: (data.type as ResellerJob['type']) ?? 'fetch_subscriptions',
          status: 'running',
          total: (data.total as number) ?? 0,
          processed: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          startedAt: Date.now(),
        };
        setActiveJob(job);
        const noun = job.type === 'fetch_subscriptions' ? 'subscriptions' : 'customers';
        setLoadingMsg(`⏳ Fetching ${noun}…`);
      } else {
        setLoadingMsg('');
        showMsg(successFmt(res.data));
        router.refresh();
      }
    });
  };

  // ---- Sort ----
  const handleSort = (colId: ColumnId) => {
    const col = ALL_COLUMNS.find(c => c.id === colId);
    if (!col?.sortable) return;
    const curDir = filters.sortBy === colId ? filters.sortDir : undefined;
    const newDir = curDir === 'asc' ? 'desc' : 'asc';
    const params = new URLSearchParams(searchParams.toString());
    params.set('sortBy', colId);
    params.set('sortDir', newDir);
    params.delete('page');
    router.push(`/dashboard/google-workspace?${params.toString()}`);
  };

  // ---- Column reorder ----
  const reorderCol = (fromId: ColumnId, toId: ColumnId) => {
    if (fromId === toId) return;
    const next = [...colOrder];
    const fi = next.indexOf(fromId), ti = next.indexOf(toId);
    next.splice(fi, 1);
    next.splice(ti, 0, fromId);
    setColOrder(next);
    lsSet(SK_ORDER, next);
  };

  // ---- Column resize (Zoho-style: drag right edge) ----
  const startResize = (e: React.MouseEvent, id: ColumnId) => {
    e.preventDefault(); e.stopPropagation();
    resizingRef.current = { id, startX: e.clientX, startW: getW(id) };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const newW = Math.max(60, resizingRef.current.startW + delta);
      setColWidths(prev => ({ ...prev, [resizingRef.current!.id]: newW }));
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setColWidths(prev => { lsSet(SK_WIDTHS, prev); return prev; });
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ---- Column visibility / order ----
  const updateCols = (vis: Set<ColumnId>, ord: ColumnId[]) => {
    setVisibleCols(vis); lsSet(SK_VISIBLE, [...vis]);
    setColOrder(ord);    lsSet(SK_ORDER, ord);
  };

  const tableMinWidth = orderedVisible.reduce((s, c) => s + getW(c.id), 0) + 44;

  return (
    <div className="flex flex-col gap-2" style={{ height: 'calc(100vh - 168px)' }}>

      {/* ── Action bar ── */}
      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
        {/* Fetch Subscriptions */}
        <div className="relative">
          <div className="flex items-stretch rounded overflow-hidden shadow-sm">
            <button
              disabled={isPending}
              onClick={() => {
                const slot = selectedSlot === 'both' ? undefined : selectedSlot;
                const label = selectedSlot === 'both' ? 'both slots' : `Slot ${selectedSlot}`;
                bulkAction(
                  () => fetchResellerSubscriptionsAction(slot),
                  () => '', // result handled by polling
                  `⏳ Starting subscription fetch from ${label}…`,
                );
              }}
              className="flex items-center gap-2 px-3.5 py-2 bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              {isPending && loadingMsg.includes('subscription') ? (
                <><svg className="animate-spin h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Fetching…</>
              ) : (
                <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M8 12l4 4m0 0l4-4m-4 4V4"/></svg>
                Fetch Subscriptions{selectedSlot !== 'both' && <span className="bg-white/20 text-white text-xs px-1.5 py-0.5 rounded-full font-bold ml-0.5">S{selectedSlot}</span>}</>
              )}
            </button>
            <button
              disabled={isPending}
              onClick={() => { setShowCustomerDropdown(false); setShowFetchDropdown(o => !o); }}
              className="px-2.5 py-2 bg-blue-700 text-white text-sm hover:bg-blue-800 disabled:opacity-50 border-l border-blue-500"
            >▾</button>
          </div>
          {showFetchDropdown && (
            <div className="absolute left-0 top-full mt-1 z-20 bg-white rounded-md shadow-lg ring-1 ring-black/10 w-52 text-[13px] py-1">
              {(['both', 1, 2] as const).map(s => (
                <button
                  key={String(s)}
                  className={`w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 ${selectedSlot === s ? 'text-blue-600 font-medium bg-blue-50' : 'text-gray-700'}`}
                  onClick={() => { setSelectedSlot(s); setShowFetchDropdown(false); }}
                >
                  {s === 'both' ? 'Both Slots' : `Slot ${s} Only`}
                  {selectedSlot === s && <span className="text-blue-500 text-xs font-bold">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Fetch Customer Data */}
        <div className="relative">
          <div className="flex items-stretch rounded overflow-hidden shadow-sm">
            <button
              disabled={isPending}
              onClick={() => bulkAction(
                () => fetchResellerCustomersAction(false),
                () => '',
                '⏳ Starting customer fetch…',
              )}
              className="flex items-center gap-2 px-3.5 py-2 bg-gray-700 text-white text-[13px] font-medium hover:bg-gray-800 disabled:opacity-50 whitespace-nowrap"
            >
              {isPending && loadingMsg.includes('customer') ? (
                <><svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Fetching…</>
              ) : (
                <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>Fetch Customer Data</>
              )}
            </button>
            <button
              disabled={isPending}
              onClick={() => { setShowFetchDropdown(false); setShowCustomerDropdown(o => !o); }}
              className="px-2.5 py-2 bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50 border-l border-gray-600"
            >▾</button>
          </div>
          {showCustomerDropdown && (
            <div className="absolute left-0 top-full mt-1 z-20 bg-white rounded-md shadow-lg ring-1 ring-black/10 w-48 text-[13px] py-1">
              <button className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-gray-700"
                onClick={() => { setShowCustomerDropdown(false); bulkAction(() => fetchResellerCustomersAction(false), () => '', '⏳ Starting customer fetch (missing only)…'); }}>
                Fetch Missing Only
              </button>
              <button className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-gray-700"
                onClick={() => { setShowCustomerDropdown(false); bulkAction(() => fetchResellerCustomersAction(true), () => '', '⏳ Starting customer refresh (all)…'); }}>
                Refresh All
              </button>
            </div>
          )}
        </div>

        {/* Reconcile */}
        <button
          disabled={isPending}
          onClick={() => bulkAction(
            () => reconcileAllAction(),
            (d: unknown) => { const r = d as { matched: number; notMatched: number; total: number }; return `✓ Reconciled: ${r.matched} matched, ${r.notMatched} not matched`; },
            '⏳ Reconciling all subscriptions…',
          )}
          className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 text-white text-[13px] font-medium rounded shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {isPending && loadingMsg.includes('Reconcil') ? (
            <><svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Reconciling…</>
          ) : (
            <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>Reconcile All</>
          )}
        </button>

        <button
          onClick={() => setShowImportModal(true)}
          className="flex items-center gap-2 px-3.5 py-2 bg-amber-500 text-white text-[13px] font-medium rounded shadow-sm hover:bg-amber-600"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M16 12l-4-4m0 0l-4 4m4-4v12"/></svg>
          Import UIDs
        </button>

        <div className="flex-1" />

        <button
          onClick={() => setShowFilters(f => !f)}
          className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded border shadow-sm transition-colors ${showFilters ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300 text-gray-600 bg-white hover:bg-gray-50'}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"/></svg>
          Filters{Object.values(filters).some(Boolean) ? ' ●' : ''}
        </button>
        <button
          onClick={() => setShowColModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 shadow-sm"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/></svg>
          Columns
        </button>
      </div>

      {/* ── Loading / result feedback ── */}
      {loadingMsg && (
        <div className="rounded-md text-[13px] bg-amber-50 text-amber-800 border border-amber-200 flex-shrink-0 overflow-hidden">
          <div className="px-4 py-2.5 flex items-center gap-2.5">
            <svg className="animate-spin h-4 w-4 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
            <span className="flex-1">{loadingMsg}</span>
            {activeJob && activeJob.total > 0 && (
              <span className="text-amber-700 font-medium tabular-nums">
                {Math.round((activeJob.processed / activeJob.total) * 100)}%
              </span>
            )}
          </div>
          {/* Progress bar — only when we have total count */}
          {activeJob && activeJob.total > 0 && (
            <div className="h-1 bg-amber-200">
              <div
                className="h-1 bg-amber-500 transition-all duration-500"
                style={{ width: `${Math.min(100, Math.round((activeJob.processed / activeJob.total) * 100))}%` }}
              />
            </div>
          )}
        </div>
      )}
      {!loadingMsg && actionMsg && (
        <div className="px-4 py-2.5 rounded-md text-[13px] bg-blue-50 text-blue-800 border border-blue-200 flex-shrink-0">{actionMsg}</div>
      )}

      {/* ── Filter panel ── */}
      {showFilters && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex flex-wrap gap-4 flex-shrink-0">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Google Status</label>
            <select value={filters.googleStatus ?? ''} onChange={e => updateFilter('googleStatus', e.target.value || undefined)}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[130px]">
              <option value="">All</option><option value="ACTIVE">ACTIVE</option><option value="SUSPENDED">SUSPENDED</option><option value="CANCELLED">CANCELLED</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Reseller Slot</label>
            <select value={filters.resellerSlot ?? ''} onChange={e => updateFilter('resellerSlot', e.target.value || undefined)}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[110px]">
              <option value="">All</option><option value="1">Slot 1</option><option value="2">Slot 2</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Plan</label>
            <select value={filters.skuName ?? ''} onChange={e => updateFilter('skuName', e.target.value || undefined)}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[150px]">
              <option value="">All Plans</option>
              {skuNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Flag</label>
            <select value={filters.hasFlag ?? ''} onChange={e => updateFilter('hasFlag', e.target.value || undefined)}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[150px]">
              <option value="">All</option><option value="seats_mismatch">⚠ Seats Mismatch</option><option value="plan_mismatch">⚠ Plan Mismatch</option><option value="domain_alias_match">~ Alias Match</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Search</label>
            <input
              type="text" placeholder="Domain, org, customer ID…" defaultValue={filters.search ?? ''}
              onKeyDown={e => { if (e.key === 'Enter') updateFilter('search', (e.target as HTMLInputElement).value || undefined); }}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 w-48"
            />
          </div>
          <div className="flex items-end">
            <button onClick={() => router.push('/dashboard/google-workspace')}
              className="px-3 py-1.5 text-[13px] text-gray-500 hover:text-gray-700 border border-transparent hover:border-gray-300 rounded-md">
              Clear all
            </button>
          </div>
        </div>
      )}

      {/* ── Summary chips ── */}
      <SummaryChips summary={summary} activeFilter={filters.reconciliationStatus} onFilter={v => updateFilter('reconciliationStatus', v)} />

      {/* ── Table container ── */}
      <div className="flex-1 flex flex-col min-h-0 border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">

        {/* Scrollable table area */}
        <div className="flex-1 overflow-auto">
          <table style={{ tableLayout: 'fixed', minWidth: tableMinWidth }}>
            <colgroup>
              {orderedVisible.map(col => <col key={col.id} style={{ width: getW(col.id) }} />)}
              <col style={{ width: 44 }} />
            </colgroup>

            {/* ── Sticky header ── */}
            <thead className="sticky top-0 z-10">
              <tr>
                {orderedVisible.map(col => (
                  <th
                    key={col.id}
                    style={{ position: 'relative', userSelect: 'none', width: getW(col.id) }}
                    draggable
                    onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; dragColRef.current = col.id; }}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCol(col.id); }}
                    onDrop={e => { e.preventDefault(); if (dragColRef.current) reorderCol(dragColRef.current, col.id); setDragOverCol(null); dragColRef.current = null; }}
                    onDragEnd={() => { setDragOverCol(null); dragColRef.current = null; }}
                    className={`
                      px-3 py-2.5 text-left bg-gray-50 border-b border-gray-200 whitespace-nowrap
                      ${dragOverCol === col.id ? 'border-l-2 border-l-blue-500 bg-blue-50' : ''}
                    `}
                  >
                    <div
                      className={`flex items-center gap-1.5 pr-2 group/hdr ${col.sortable ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}`}
                      onClick={() => col.sortable && handleSort(col.id)}
                    >
                      {/* Drag grip — visible on hover */}
                      <span className="opacity-0 group-hover/hdr:opacity-100 transition-opacity flex-shrink-0" title="Drag to reorder">
                        <GripIcon />
                      </span>
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide truncate select-none">
                        {col.label}
                      </span>
                      {col.sortable && (
                        <SortIcon active={filters.sortBy === col.id} dir={filters.sortDir as 'asc' | 'desc' | undefined} />
                      )}
                    </div>

                    {/* ── Resize handle (Zoho-style: right edge) ── */}
                    <div
                      className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10 group/resize"
                      onMouseDown={e => startResize(e, col.id)}
                      onClick={e => e.stopPropagation()}
                    >
                      {/* Visual 1px line — inset 8px top/bottom, turns blue on hover */}
                      <div className="absolute inset-y-2 left-[2px] w-px bg-gray-200 group-hover/resize:bg-blue-400 transition-colors" />
                    </div>
                  </th>
                ))}
                {/* Actions column header */}
                <th className="w-11 bg-gray-50 border-b border-gray-200 sticky right-0" />
              </tr>
            </thead>

            {/* ── Body ── */}
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={orderedVisible.length + 1} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <svg className="w-10 h-10 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>
                      <p className="text-[13px] text-gray-500">कोई data नहीं मिला</p>
                      <p className="text-[12px] text-gray-400">"Fetch Subscriptions" से Google API का data load करें</p>
                    </div>
                  </td>
                </tr>
              )}
              {rows.map((row, ri) => (
                <tr
                  key={row.id}
                  className={`border-b border-gray-100 hover:bg-blue-50/50 transition-colors ${row.reconciliationStatus === 'excluded' ? 'opacity-50' : ''} ${ri % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'}`}
                >
                  {orderedVisible.map(col => (
                    <td
                      key={col.id}
                      className="px-3 py-2 overflow-hidden"
                      style={{ width: getW(col.id), maxWidth: getW(col.id) }}
                    >
                      <div className="truncate">
                        {renderCell(col.id, row, () => router.refresh(), resellerNames)}
                      </div>
                    </td>
                  ))}
                  <td className="px-2 py-2 sticky right-0 bg-white border-l border-gray-100 w-11">
                    <RowActions row={row} onRefresh={() => router.refresh()} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {total > 0 && (
          <div className="flex-shrink-0 border-t border-gray-200 bg-white px-4 py-2.5 flex items-center justify-between">
            <span className="text-[13px] text-gray-500">
              Showing <span className="font-medium text-gray-800">{(page - 1) * limit + 1}–{Math.min(page * limit, total)}</span> of <span className="font-medium text-gray-800">{total}</span>
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1} onClick={() => setPage(page - 1)}
                className="flex items-center gap-1 px-3 py-1.5 rounded border border-gray-300 text-[13px] text-gray-600 disabled:opacity-40 hover:bg-gray-50 disabled:hover:bg-white"
              >
                ← Prev
              </button>
              <span className="px-3 py-1.5 text-[13px] text-gray-500">Page {page} / {totalPages}</span>
              <button
                disabled={page >= totalPages} onClick={() => setPage(page + 1)}
                className="flex items-center gap-1 px-3 py-1.5 rounded border border-gray-300 text-[13px] text-gray-600 disabled:opacity-40 hover:bg-gray-50 disabled:hover:bg-white"
              >
                Next →
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] text-gray-500">Per page:</span>
              {[25, 50, 100, 200].map(n => (
                <button
                  key={n} onClick={() => updateFilter('limit', String(n))}
                  className={`px-2.5 py-1 rounded border text-[13px] font-medium transition-colors ${limit === n ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {showColModal && <ColumnModal visible={visibleCols} order={colOrder} onChange={updateCols} onClose={() => setShowColModal(false)} />}
      {showImportModal && <ImportUidModal onClose={() => setShowImportModal(false)} onDone={() => { router.refresh(); }} />}
    </div>
  );
}
