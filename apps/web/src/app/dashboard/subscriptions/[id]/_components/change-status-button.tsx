'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const STATUSES = [
  { value: 'Active',        label: 'Active',        cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  { value: 'Expiring_Soon', label: 'Expiring Soon',  cls: 'bg-amber-50 border-amber-200 text-amber-700' },
  { value: 'Expired',       label: 'Expired',        cls: 'bg-red-50 border-red-200 text-red-700' },
  { value: 'Pending',       label: 'Pending',        cls: 'bg-slate-50 border-slate-200 text-slate-600' },
  { value: 'Inactive',      label: 'Inactive',       cls: 'bg-slate-100 border-slate-300 text-slate-500' },
  { value: 'Cancelled',     label: 'Cancelled',      cls: 'bg-red-100 border-red-300 text-red-800' },
] as const;

export function ChangeStatusButton({
  subscriptionId,
  currentStatus,
}: {
  subscriptionId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = STATUSES.find(s => s.value === currentStatus);
  const badgeCls = current?.cls ?? 'bg-slate-50 border-slate-200 text-slate-600';

  // Close on outside click or ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);

  const changeStatus = async (newStatus: string) => {
    if (newStatus === currentStatus || loading) return;
    setLoading(true);
    setOpen(false);
    try {
      const res = await fetch(`/api/subscriptions/${subscriptionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lifecycleStatus: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      alert(`Status change failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={loading}
        title="Click to change status"
        className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition-all shadow-sm cursor-pointer hover:brightness-95 disabled:opacity-60 flex items-center gap-1 ${badgeCls}`}
      >
        {loading ? (
          <span className="animate-spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full" />
        ) : (
          <span className="inline-block w-2 h-2 rounded-full bg-current opacity-60" />
        )}
        {current?.label ?? currentStatus.replace('_', ' ')}
        {!loading && <span className="opacity-40 ml-0.5">▾</span>}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden min-w-[160px]">
          <p className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">
            Change Status
          </p>
          {STATUSES.map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => void changeStatus(s.value)}
              className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors hover:bg-slate-50 flex items-center gap-2 ${
                s.value === currentStatus ? 'opacity-40 cursor-default' : 'cursor-pointer'
              }`}
            >
              <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] font-semibold ${s.cls}`}>
                {s.label}
              </span>
              {s.value === currentStatus && <span className="text-slate-400 text-[10px]">current</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
