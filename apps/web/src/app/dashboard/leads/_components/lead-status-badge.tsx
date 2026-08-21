'use client';

const colors: Record<string, string> = {
  New: 'bg-blue-100 text-blue-700',
  Contacted: 'bg-purple-100 text-purple-700',
  Quoted: 'bg-yellow-100 text-yellow-700',
  Negotiating: 'bg-orange-100 text-orange-700',
  Won: 'bg-green-100 text-green-700',
  Converted: 'bg-green-100 text-green-700',
  Lost: 'bg-red-100 text-red-700',
  Archived: 'bg-slate-100 text-slate-500',
};

export function LeadStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}
