'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FilePlus, Trash2 } from 'lucide-react';
import { LeadStatusBadge } from './lead-status-badge';
import { deleteMultipleLeadsAction } from '../actions';

interface Lead {
  id: string;
  leadNumber: string;
  companyName: string;
  contactName: string | null;
  email: string;
  phone: string | null;
  status: string;
  primaryDomain: string | null;
  estimatedValue: string | null;
  createdAt: string;
  _count: { quickQuotes: number };
}

export function LeadsTable({ leads, isAdmin = false }: { leads: Lead[]; isAdmin?: boolean }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const toggleAll = () => {
    if (selectedIds.length === leads.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(leads.map(l => l.id));
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
    if (!confirm(`क्या आप सच में इन ${selectedIds.length} leads को डिलीट करना चाहते हैं? इससे सारा संबंधित डेटा भी डिलीट हो जाएगा।`)) return;
    setLoading(true);
    try {
      await deleteMultipleLeadsAction(selectedIds);
      alert('Leads deleted successfully');
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
              title={selectedIds.length === 0 ? "डिलीट करने के लिए कम से कम एक lead चुनें" : "चयनित leads डिलीट करें"}
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
            <thead className="bg-slate-50/50 backdrop-blur-md border-b border-slate-200/60">
              <tr>
                <th className="px-5 py-4 text-left w-12">
                  <input
                    type="checkbox"
                    checked={selectedIds.length > 0 && selectedIds.length === leads.length}
                    ref={el => {
                      if (el) el.indeterminate = selectedIds.length > 0 && selectedIds.length < leads.length;
                    }}
                    onChange={toggleAll}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="text-left px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Lead #</th>
                <th className="text-left px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Company</th>
                <th className="text-left px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Contact</th>
                <th className="text-left px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="text-center px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Quotes</th>
                <th className="text-left px-5 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Value</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-5 py-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(lead.id)}
                      onChange={() => toggleOne(lead.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-5 py-4">
                    <Link href={`/dashboard/leads/${lead.id}`}
                      title="View Details"
                      className="font-mono text-[11px] font-bold text-blue-600 hover:text-blue-700 bg-blue-50/40 hover:bg-blue-100/70 border border-blue-100/60 px-2.5 py-1 rounded-lg transition-all inline-block hover:no-underline shadow-sm"
                    >
                      {lead.leadNumber}
                    </Link>
                  </td>
                  <td className="px-5 py-4">
                    <div className="font-bold text-slate-800 tracking-tight">{lead.companyName}</div>
                    {lead.primaryDomain && (
                      <div className="text-[11px] font-medium text-slate-400 mt-0.5 flex items-center gap-1">
                        🌐 {lead.primaryDomain}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <div className="text-slate-700 font-semibold text-xs">{lead.contactName ?? '—'}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{lead.email}</div>
                  </td>
                  <td className="px-5 py-4">
                    <LeadStatusBadge status={lead.status} />
                  </td>
                  <td className="px-5 py-4 text-center text-slate-700 font-bold text-xs">
                    <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-lg">
                      {lead._count.quickQuotes}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-800 font-extrabold text-xs">
                    {lead.estimatedValue ? `₹${Number(lead.estimatedValue).toLocaleString('en-IN')}` : '—'}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link href={`/dashboard/quick-quotes/new?lead_id=${lead.id}`} 
                      title="Create Quote"
                      className="inline-flex items-center justify-center p-1.5 rounded-xl border border-indigo-100 bg-indigo-50/50 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 transition-all active:scale-95">
                      <FilePlus className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
