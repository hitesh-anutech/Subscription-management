'use client';

import Link from 'next/link';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { api, API_BASE } from '@/lib/api';
import { Eye, Power, Trash2 } from 'lucide-react';
import { deleteMultipleSubscriptionsAction } from '../actions';

interface Subscription {
  id: string;
  subscriptionNumber: string;
  zohoCustomerId: string | null;
  zohoCustomerName: string | null;
  zohoItemName: string | null;
  quantity: string;
  subscriptionPrice: string;
  currency?: string;
  billingCycle: string;
  startDate: string;
  endDate: string;
  lifecycleStatus: string;
  processStatus: string;
  organization: { id: string; name: string };
  domain: { id: string; domainName: string };
  _count: { renewalHistory: number };
}

const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', AUD: 'A$', CAD: 'C$', JPY: '¥',
};
/** Format an amount in its billing currency (falls back to the code for unknown currencies). */
function money(amount: number, currency = 'INR'): string {
  const code = (currency || 'INR').toUpperCase();
  const sym = CURRENCY_SYMBOL[code] ?? `${code} `;
  return `${sym}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const STATUS_STYLES: Record<string, string> = {
  Active:         'bg-green-100 text-green-700',
  Expiring_Soon:  'bg-amber-100 text-amber-700',
  Expired:        'bg-red-100 text-red-700',
  Pending:        'bg-slate-100 text-slate-600',
  Cancelled:      'bg-slate-100 text-slate-500 line-through',
  Inactive:       'bg-slate-100 text-slate-400',
};

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function effectiveStatus(stored: string, endDate: string): string {
  // Compute from endDate so stale DB status doesn't show wrong badge
  const days = daysUntil(endDate);
  if (days < 0) return 'Expired';
  if (days <= 30) return 'Expiring_Soon';
  return stored;
}

function StatusBadge({ status, endDate }: { status: string; endDate: string }) {
  const eff = effectiveStatus(status, endDate);
  const label = eff.replace('_', ' ');
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[eff] ?? 'bg-slate-100 text-slate-600'}`}>
      {label}
    </span>
  );
}

export function SubscriptionsTable({
  subscriptions,
  initialSelectedIds,
  isAdmin = false,
}: {
  subscriptions: Subscription[];
  initialSelectedIds?: string[];
  isAdmin?: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds ?? []);
  const [isUpdatingPrice, setIsUpdatingPrice] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [importResult, setImportResult] = useState<{
    importLogId?: string;
    totalRows: number;
    updatedCount: number;
    skippedCount?: number;
    errorCount?: number;
    skipped?: string[];
    errors?: string[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  if (subscriptions.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="text-center py-16 text-slate-400">
          <p className="font-medium">कोई subscription नहीं मिली</p>
          <p className="text-sm mt-1">Filter change करो या नई subscription create करो।</p>
        </div>
      </div>
    );
  }

  const toggleAll = () => {
    if (selectedIds.length === subscriptions.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(subscriptions.map(s => s.id));
    }
  };

  const toggleOne = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleBulkUpdatePrice = async () => {
    const priceStr = prompt(`Update price for ${selectedIds.length} subscriptions:\nEnter new unit price:`);
    if (!priceStr) return;
    const newPrice = Number(priceStr);
    if (isNaN(newPrice) || newPrice <= 0) return alert('Invalid price');

    setIsUpdatingPrice(true);
    try {
      await api.post('/subscriptions/bulk-update-price', {
        subscriptionIds: selectedIds,
        newPrice
      });
      alert('Price updated successfully');
      setSelectedIds([]);
      router.refresh();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsUpdatingPrice(false);
    }
  };

  const handleBulkQuote = async () => {
    if (!confirm(`Are you sure you want to generate Zoho Renewal Quotes for ${selectedIds.length} subscriptions?`)) return;
    
    setIsQuoting(true);
    try {
      const res = await api.post<{
        totalGroups: number;
        createdCount: number;
        failedCount: number;
        estimateNumbers: string[];
        batchIds: string[];
        errors: string[];
      }>('/subscriptions/bulk-renewal-quote', {
        subscriptionIds: selectedIds,
      });

      // Surface any group-level failures, but still proceed to review the ones that succeeded.
      if (res.failedCount > 0) {
        alert(
          `${res.createdCount} of ${res.totalGroups} quote group(s) created.\n\n` +
          `${res.failedCount} failed:\n- ${res.errors.join('\n- ')}`,
        );
      }
      setSelectedIds([]);

      // Next step: land on the batch review screen for the just-created quotes
      // (review → bulk-send → track status). Fall back to a refresh if nothing was created.
      if (res.batchIds?.length) {
        router.push(`/dashboard/subscriptions/renewal-batches?ids=${res.batchIds.join(',')}`);
      } else {
        router.refresh();
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsQuoting(false);
    }
  };

  const handleExportCsv = () => {
    window.open('/api/subscriptions/export-csv' + window.location.search);
  };

  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('Please select a valid CSV file.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    setIsImportingCsv(true);
    setImportResult(null);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/import-csv`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Import failed');
      // Full skipped/error detail is shown inline below (and persisted server-side
      // in csv_import_logs) rather than truncated in an alert().
      setImportResult(data);
      router.refresh();
    } catch (err: any) {
      setImportResult({ totalRows: 0, updatedCount: 0, errors: [err.message] });
    } finally {
      setIsImportingCsv(false);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleBulkCancel = async () => {
    if (!confirm(`Are you sure you want to cancel ${selectedIds.length} subscriptions?`)) return;
    
    setIsUpdatingStatus(true);
    try {
      await api.post('/subscriptions/bulk-update-status', {
        subscriptionIds: selectedIds,
        status: 'Cancelled',
      });
      alert('Subscriptions cancelled successfully');
      setSelectedIds([]);
      router.refresh();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleBulkActivate = async () => {
    if (!confirm(`Are you sure you want to activate ${selectedIds.length} subscriptions?`)) return;
    
    setIsUpdatingStatus(true);
    try {
      await api.post('/subscriptions/bulk-update-status', {
        subscriptionIds: selectedIds,
        status: 'Active',
      });
      alert('Subscriptions activated successfully');
      setSelectedIds([]);
      router.refresh();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`क्या आप सच में इन ${selectedIds.length} subscriptions को डिलीट करना चाहते हैं? इससे सारा संबंधित डेटा भी डिलीट हो जाएगा।`)) return;
    
    setIsUpdatingStatus(true);
    try {
      await deleteMultipleSubscriptionsAction(selectedIds);
      alert('Subscriptions deleted successfully');
      setSelectedIds([]);
      router.refresh();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
    if (!confirm(`Are you sure you want to change the status to ${newStatus}?`)) return;

    try {
      await api.post('/subscriptions/bulk-update-status', {
        subscriptionIds: [id],
        status: newStatus,
      });
      router.refresh();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handlePasteSelect = () => {
    const domainsToSelect = pasteText.split(/[\n,]+/).map(d => d.trim().toLowerCase()).filter(Boolean);
    const idsToSelect = subscriptions
      .filter(s => domainsToSelect.includes(s.domain.domainName.toLowerCase()))
      .map(s => s.id);
    
    if (idsToSelect.length === 0) {
      alert('No matching domains found in the current view.');
      return;
    }
    
    const newSelected = new Set([...selectedIds, ...idsToSelect]);
    setSelectedIds(Array.from(newSelected));
    setIsPasteModalOpen(false);
    setPasteText('');
    alert(`Selected ${idsToSelect.length} matching subscriptions.`);
  };

  return (
    <div className="space-y-4">
      {selectedIds.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
          <div className="text-blue-800 text-sm font-medium">
            {selectedIds.length} subscriptions selected
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleBulkCancel}
              disabled={isUpdatingPrice || isQuoting || isUpdatingStatus}
              className="px-3 py-1.5 bg-red-100 border border-red-200 text-red-700 text-xs font-semibold rounded hover:bg-red-200 disabled:opacity-50"
            >
              {isUpdatingStatus ? 'Updating...' : 'Cancel Subscriptions'}
            </button>
            <button
              onClick={handleBulkActivate}
              disabled={isUpdatingPrice || isQuoting || isUpdatingStatus}
              className="px-3 py-1.5 bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-semibold rounded hover:bg-emerald-200 disabled:opacity-50"
            >
              {isUpdatingStatus ? 'Updating...' : 'Activate Subscriptions'}
            </button>
            <button
              onClick={handleBulkUpdatePrice}
              disabled={isUpdatingPrice || isQuoting || isUpdatingStatus}
              className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded hover:bg-slate-50 disabled:opacity-50"
            >
              {isUpdatingPrice ? 'Updating...' : 'Bulk Update Price'}
            </button>
            <button
              onClick={handleBulkQuote}
              disabled={isUpdatingPrice || isQuoting || isUpdatingStatus}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {isQuoting ? 'Generating...' : 'Generate Bulk Quotes'}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPasteModalOpen(true)}
            className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50"
          >
            Bulk Select by Domains
          </button>
          {isAdmin && (
            <button
              onClick={handleBulkDelete}
              disabled={selectedIds.length === 0 || isUpdatingStatus}
              title={selectedIds.length === 0 ? "डिलीट करने के लिए कम से कम एक subscription चुनें" : "चयनित subscriptions डिलीट करें"}
              className={`p-2 border rounded-xl transition-all active:scale-95 flex items-center justify-center ${
                selectedIds.length > 0
                  ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
                  : 'border-slate-100 bg-slate-50/50 text-slate-300 cursor-not-allowed'
              }`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              className="px-3.5 py-2 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl bg-white hover:bg-slate-50 transition-all shadow-sm inline-flex items-center gap-1.5"
            >
              📤 Export CSV
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImportingCsv}
              className="px-3.5 py-2 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl bg-white hover:bg-slate-50 transition-all shadow-sm inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              📥 {isImportingCsv ? 'Importing…' : 'Import CSV'}
            </button>
            <input
              type="file"
              className="hidden"
              ref={fileInputRef}
              onChange={handleImportCsv}
            />
          </div>
        )}
      </div>

      {importResult && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          (importResult.errorCount ?? importResult.errors?.length ?? 0) > 0
            ? 'bg-amber-50 border-amber-200'
            : 'bg-green-50 border-green-200'
        }`}>
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium text-slate-800">
              {importResult.updatedCount} updated
              {typeof importResult.skippedCount === 'number' && `, ${importResult.skippedCount} skipped`}
              {typeof importResult.errorCount === 'number' && `, ${importResult.errorCount} errors`}
              {' '}out of {importResult.totalRows} row{importResult.totalRows === 1 ? '' : 's'}.
            </p>
            <div className="flex items-center gap-3 shrink-0">
              {importResult.importLogId && (
                <a
                  href={`/api/subscriptions/import-logs/${importResult.importLogId}/errors-csv`}
                  className="text-blue-600 text-xs font-medium hover:underline"
                >
                  Download report
                </a>
              )}
              <button onClick={() => setImportResult(null)} className="text-slate-400 hover:text-slate-600 text-xs">
                Dismiss
              </button>
            </div>
          </div>
          {(importResult.skipped?.length || importResult.errors?.length) ? (
            <div className="mt-2 max-h-40 overflow-y-auto space-y-0.5">
              {importResult.errors?.map((msg, i) => (
                <p key={`err-${i}`} className="text-xs text-red-600">❌ {msg}</p>
              ))}
              {importResult.skipped?.map((msg, i) => (
                <p key={`skip-${i}`} className="text-xs text-slate-500">⏭ {msg}</p>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left w-10">
                <input
                  type="checkbox"
                  checked={selectedIds.length > 0 && selectedIds.length === subscriptions.length}
                  ref={el => {
                    if (el) el.indeterminate = selectedIds.length > 0 && selectedIds.length < subscriptions.length;
                  }}
                  onChange={toggleAll}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Customer / Domain</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Item</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600">Qty</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600">Price</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600">Subs. Period</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {subscriptions.map((sub) => {
              const days = daysUntil(sub.endDate);
              const isUrgent = days <= 30 && days >= 0;
              return (
                <tr key={sub.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(sub.id)}
                      onChange={() => toggleOne(sub.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-4 py-3">
                    {sub.zohoCustomerId ? (
                      <Link
                        href={`/dashboard/customers/${sub.zohoCustomerId}?org_id=${sub.organization.id}`}
                        className="font-medium text-blue-700 hover:underline truncate max-w-48 block"
                        title="Customer page par jaao"
                      >
                        {sub.zohoCustomerName ?? '—'}
                      </Link>
                    ) : (
                      <p className="font-medium text-slate-800 truncate max-w-48">
                        {sub.zohoCustomerName ?? '—'}
                      </p>
                    )}
                    <p className="text-xs text-slate-400 mt-0.5">
                      {sub.domain.domainName} · {sub.organization.name}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-slate-700 truncate max-w-48">{sub.zohoItemName ?? '—'}</p>
                    <p className="text-xs text-slate-400">{sub.billingCycle}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">{sub.quantity}</td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {money(Number(sub.subscriptionPrice), sub.currency)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <p className={`text-sm ${isUrgent ? 'text-red-600 font-semibold' : 'text-slate-700'}`}>
                      {fmt(sub.startDate)} <span className="text-slate-400">→</span> {fmt(sub.endDate)}
                    </p>
                    {days >= 0 && (
                      <p className={`text-xs mt-0.5 ${isUrgent ? 'text-red-500' : 'text-slate-400'}`}>
                        {days === 0 ? 'Today' : `${days} days`}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={sub.lifecycleStatus} endDate={sub.endDate} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2.5">
                      <button
                        onClick={() => handleToggleStatus(sub.id, sub.lifecycleStatus)}
                        title={sub.lifecycleStatus === 'Active' ? 'Deactivate' : 'Activate'}
                        className={`p-1.5 rounded-xl border transition-all active:scale-95 ${
                          sub.lifecycleStatus === 'Active'
                            ? 'border-red-100 bg-red-50/50 text-red-600 hover:bg-red-50 hover:text-red-700'
                            : 'border-emerald-100 bg-emerald-50/50 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700'
                        }`}
                      >
                        <Power className="w-4 h-4" />
                      </button>
                      <Link
                        href={`/dashboard/subscriptions/${sub.id}`}
                        title="View Details"
                        className="p-1.5 rounded-xl border border-blue-100 bg-blue-50/50 text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition-all active:scale-95"
                      >
                        <Eye className="w-4 h-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isPasteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-[500px] max-w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Bulk Select Domains</h3>
              <p className="text-sm text-slate-500 mt-1">Paste a list of domains (comma separated or one per line) to select them from the current view.</p>
            </div>
            <div className="p-5">
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                rows={8}
                className="w-full border-slate-300 rounded-lg shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                placeholder="example1.com, example2.com&#10;example3.com"
              />
            </div>
            <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button
                onClick={() => setIsPasteModalOpen(false)}
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handlePasteSelect}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700"
              >
                Select Domains
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
