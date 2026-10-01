'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface Props {
  categories: { itemValue: string; itemLabel: string }[];
}

function todayPlusN(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function FilterPanel({ categories }: Props) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const panelRef     = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // Local state mirrors URL params so panel shows current selections
  const [status,         setStatus]        = useState(searchParams.get('status')         ?? '');
  const [billing,        setBilling]       = useState(searchParams.get('billing')        ?? '');
  const [expiring,       setExpiring]      = useState(searchParams.get('expiring')       ?? '');
  const [expiringOn,     setExpiringOn]    = useState(searchParams.get('expiring_on')    ?? '');
  const [renewalStatus,  setRenewalStatus] = useState(searchParams.get('renewal_status') ?? '');
  const [category,       setCategory]      = useState(searchParams.get('category')       ?? '');

  // Sync when URL changes (e.g. Clear link navigates)
  useEffect(() => {
    setStatus(searchParams.get('status')         ?? '');
    setBilling(searchParams.get('billing')       ?? '');
    setExpiring(searchParams.get('expiring')     ?? '');
    setExpiringOn(searchParams.get('expiring_on') ?? '');
    setRenewalStatus(searchParams.get('renewal_status') ?? '');
    setCategory(searchParams.get('category')     ?? '');
  }, [searchParams]);

  const activeCount = [status, billing, expiring, expiringOn, renewalStatus, category].filter(Boolean).length;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Mutually exclusive: picking one clears the other
  const handleExpiringChange = (val: string) => {
    setExpiring(val);
    if (val) setExpiringOn('');
  };

  const handleExpiringOnChange = (val: string) => {
    setExpiringOn(val);
    if (val) setExpiring('');
  };

  const apply = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', '1');
    if (status)        params.set('status', status);         else params.delete('status');
    if (billing)       params.set('billing', billing);       else params.delete('billing');
    if (expiring)      params.set('expiring', expiring);     else params.delete('expiring');
    if (expiringOn)    params.set('expiring_on', expiringOn); else params.delete('expiring_on');
    if (renewalStatus) params.set('renewal_status', renewalStatus); else params.delete('renewal_status');
    if (category)      params.set('category', category);     else params.delete('category');
    router.push(`/dashboard/subscriptions?${params.toString()}`);
    setOpen(false);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all shrink-0 ${
          open || activeCount > 0
            ? 'bg-[#286FAD] text-white border-[#286FAD] hover:bg-[#1e5a8f]'
            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
        }`}
      >
        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="11" y1="18" x2="13" y2="18" />
        </svg>
        Filters
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/30 text-[10px] font-bold">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-30 bg-white border border-slate-200 rounded-xl shadow-xl p-4 w-[500px] grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#286FAD]/20"
            >
              <option value="">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Expiring_Soon">Expiring Soon</option>
              <option value="Expired">Expired</option>
              <option value="Pending">Pending</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Billing Period</label>
            <select
              value={billing}
              onChange={(e) => setBilling(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#286FAD]/20"
            >
              <option value="">All Periods</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="half_yearly">Half-Yearly</option>
              <option value="annual">Annual</option>
              <option value="biennial">Biennial</option>
              <option value="triennial">Triennial</option>
              <option value="one_time">One-Time</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Expiring In</label>
            <select
              value={expiring}
              onChange={(e) => handleExpiringChange(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#286FAD]/20"
            >
              <option value="">Any Expiry</option>
              <option value="7">7 days</option>
              <option value="15">15 days</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Expiring On</label>
            {expiring && !expiringOn && (
              <>
                <button
                  type="button"
                  onClick={() => handleExpiringOnChange(todayPlusN(Number(expiring)))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[#286FAD]/40 bg-[#286FAD]/5 text-[#286FAD] text-[10px] font-bold hover:bg-[#286FAD]/10 transition-colors text-left"
                >
                  After {expiring} days → {fmtDate(todayPlusN(Number(expiring)))}
                </button>
                <div className="flex items-center gap-1.5 my-1.5">
                  <div className="flex-1 h-px bg-slate-100" />
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">or</span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>
              </>
            )}
            <input
              type="date"
              value={expiringOn}
              onChange={(e) => handleExpiringOnChange(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#286FAD]/20"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Quote Status</label>
            <select
              value={renewalStatus}
              onChange={(e) => setRenewalStatus(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#286FAD]/20"
            >
              <option value="">All Quotes</option>
              <option value="needs_quote">Needs Quote</option>
              <option value="quoted">Quote Sent</option>
              <option value="paid">Renewal Paid</option>
            </select>
          </div>

          {categories.length > 0 && (
            <div className="col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#286FAD]/20"
              >
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c.itemValue} value={c.itemValue}>{c.itemLabel}</option>
                ))}
              </select>
            </div>
          )}

          <div className="col-span-2 flex justify-end gap-2 pt-1 border-t border-slate-100">
            <button
              type="button"
              onClick={apply}
              className="px-4 py-1.5 bg-[#286FAD] hover:bg-[#1e5a8f] text-white text-xs font-bold rounded-lg transition-colors"
            >
              Apply Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
