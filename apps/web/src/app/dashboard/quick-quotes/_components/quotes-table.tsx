'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { deleteMultipleQuotesAction } from '../actions';

interface Quote {
  id: string;
  quoteNumber: string;
  customerType: string;
  status: string;
  totalAmount: string;
  quoteDate: string;
  expiryDate: string;
  lead: { id: string; companyName: string; email: string } | null;
  zohoCustomerName: string | null;
  targetOrganization: { name: string };
  _count: { items: number };
}

const statusColors: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-600',
  Sent: 'bg-blue-100 text-blue-700',
  Viewed: 'bg-purple-100 text-purple-700',
  Accepted: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  Expired: 'bg-orange-100 text-orange-700',
  Pushed_To_Zoho: 'bg-teal-100 text-teal-700',
  Cancelled: 'bg-slate-100 text-slate-400',
};

const STATUS_DISPLAY: Record<string, string> = {
  Pushed_To_Zoho: 'Pushed to Zoho',
};

function formatStatus(s: string) {
  return STATUS_DISPLAY[s] ?? s.replace(/_/g, ' ');
}

export function QuotesTable({ quotes, isAdmin = false }: { quotes: Quote[]; isAdmin?: boolean }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const toggleAll = () => {
    if (selectedIds.length === quotes.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(quotes.map(q => q.id));
    }
  };

  const toggleOne = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`क्या आप सच में इन ${selectedIds.length} quotes को डिलीट करना चाहते हैं? इससे सारा संबंधित डेटा भी डिलीट हो जाएगा।`)) return;
    setLoading(true);
    try {
      await deleteMultipleQuotesAction(selectedIds);
      alert('Quotes deleted successfully');
      setSelectedIds([]);
      router.refresh();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Table Toolbar */}
      <div className="flex items-center justify-between bg-white border border-slate-200/80 p-2.5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
            {selectedIds.length} Selected
          </span>
          {isAdmin && (
            <button
              onClick={handleBulkDelete}
              disabled={selectedIds.length === 0 || loading}
              title={selectedIds.length === 0 ? "डिलीट करने के लिए कम से कम एक quote चुनें" : "चयनित quotes डिलीट करें"}
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
      </div>

      <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 border-b border-slate-200/60">
              <tr>
                <th className="px-5 py-4 text-left w-12">
                  <input
                    type="checkbox"
                    checked={selectedIds.length > 0 && selectedIds.length === quotes.length}
                    ref={el => {
                      if (el) el.indeterminate = selectedIds.length > 0 && selectedIds.length < quotes.length;
                    }}
                    onChange={toggleAll}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="text-left px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Quote #</th>
                <th className="text-left px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Customer</th>
                <th className="text-left px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Org</th>
                <th className="text-left px-5 py-4 text-xs font-bold text-slate-400 tracking-wider">Status</th>
                <th className="text-right px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Amount</th>
                <th className="text-right px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Date</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quotes.map((q) => {
                const customerName = q.customerType === 'lead'
                  ? q.lead?.companyName
                  : q.zohoCustomerName;

                return (
                  <tr key={q.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(q.id)}
                        onChange={() => toggleOne(q.id)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-5 py-4">
                      <span className="font-mono text-[10px] font-bold text-slate-400 bg-slate-100 border border-slate-200/50 px-2 py-0.5 rounded-md">
                        {q.quoteNumber}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-bold text-slate-800 tracking-tight">{customerName ?? '—'}</div>
                      {q.customerType === 'lead' ? (
                        <span className="mt-1 inline-flex px-2 py-0.5 rounded-full bg-blue-50 text-[9px] font-bold text-blue-600 uppercase tracking-wide">Lead</span>
                      ) : (
                        <div className="text-[10px] text-slate-400 font-medium mt-0.5">Existing Customer</div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-slate-600 font-semibold text-xs">{q.targetOrganization.name}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${statusColors[q.status] ?? 'bg-slate-100 text-slate-600'}`}>
                        {formatStatus(q.status)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right font-extrabold text-slate-800 tabular-nums text-xs">
                      ₹{Number(q.totalAmount).toLocaleString('en-IN')}
                    </td>
                    <td className="px-5 py-4 text-right text-xs text-slate-400 font-medium tabular-nums">{new Date(q.quoteDate).toLocaleDateString('en-IN')}</td>
                    <td className="px-5 py-4 text-right">
                      <Link href={`/dashboard/quick-quotes/${q.id}`} 
                        className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 text-xs font-bold tracking-tight transition-colors">
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
