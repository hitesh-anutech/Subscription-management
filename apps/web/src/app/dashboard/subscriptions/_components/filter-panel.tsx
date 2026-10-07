'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface Props {
  categories: { itemValue: string; itemLabel: string }[];
  orgs?: { id: string; name: string }[];
}

function todayPlusN(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

const SELECT_CLS =
  'w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-700 bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-[#286FAD]/20 focus:border-[#286FAD]/60 ' +
  'transition-colors appearance-none cursor-pointer';

const LABEL_CLS = 'block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5';

function Label({ children }: { children: React.ReactNode }) {
  return <p className={LABEL_CLS}>{children}</p>;
}

export function FilterPanel({ categories, orgs = [] }: Props) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const panelRef     = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const [status,        setStatus]       = useState(searchParams.get('status')         ?? '');
  const [billing,       setBilling]      = useState(searchParams.get('billing')        ?? '');
  const [expiring,      setExpiring]     = useState(searchParams.get('expiring')       ?? '');
  const [expiringOn,    setExpiringOn]   = useState(searchParams.get('expiring_on')    ?? '');
  const [renewalStatus, setRenewalStatus]= useState(searchParams.get('renewal_status') ?? '');
  const [category,      setCategory]     = useState(searchParams.get('category')       ?? '');
  const [orgId,         setOrgId]        = useState(searchParams.get('org_id')         ?? '');

  useEffect(() => {
    setStatus(searchParams.get('status')          ?? '');
    setBilling(searchParams.get('billing')        ?? '');
    setExpiring(searchParams.get('expiring')      ?? '');
    setExpiringOn(searchParams.get('expiring_on') ?? '');
    setRenewalStatus(searchParams.get('renewal_status') ?? '');
    setCategory(searchParams.get('category')      ?? '');
    setOrgId(searchParams.get('org_id')           ?? '');
  }, [searchParams]);

  const activeCount = [status, billing, expiring, expiringOn, renewalStatus, category, orgId].filter(Boolean).length;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleExpiringChange = (val: string) => {
    setExpiring(val);
    if (val) setExpiringOn('');
  };
  const handleExpiringOnChange = (val: string) => {
    setExpiringOn(val);
    if (val) setExpiring('');
  };

  const clearAll = () => {
    setStatus(''); setBilling(''); setExpiring(''); setExpiringOn('');
    setRenewalStatus(''); setCategory(''); setOrgId('');
  };

  const apply = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', '1');
    if (status)        params.set('status', status);                else params.delete('status');
    if (billing)       params.set('billing', billing);              else params.delete('billing');
    if (expiring)      params.set('expiring', expiring);            else params.delete('expiring');
    if (expiringOn)    params.set('expiring_on', expiringOn);       else params.delete('expiring_on');
    if (renewalStatus) params.set('renewal_status', renewalStatus); else params.delete('renewal_status');
    if (category)      params.set('category', category);            else params.delete('category');
    if (orgId)         params.set('org_id', orgId);                 else params.delete('org_id');
    router.push(`/dashboard/subscriptions?${params.toString()}`);
    setOpen(false);
  };

  const hasOrgs = orgs.length > 1;

  return (
    <div className="relative" ref={panelRef}>

      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all shrink-0 ${
          open || activeCount > 0
            ? 'bg-[#286FAD] text-white border-[#286FAD] shadow-sm shadow-[#286FAD]/30'
            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <line x1="4"  y1="6"  x2="20" y2="6"  />
          <line x1="8"  y1="12" x2="16" y2="12" />
          <line x1="11" y1="18" x2="13" y2="18" />
        </svg>
        Filters
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-white/25 text-[10px] font-bold tabular-nums">
            {activeCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          className="absolute left-0 top-full mt-2 z-30 w-[520px] bg-white rounded-2xl shadow-xl border border-slate-200/70 overflow-hidden"
          style={{ animation: 'filterPanelIn 0.15s cubic-bezier(0.16,1,0.3,1)' }}
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/60">
            <div className="flex items-center gap-2">
              <svg width="12" height="12" fill="none" stroke="#94a3b8" strokeWidth={2.5} viewBox="0 0 24 24">
                <line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" />
              </svg>
              <span className="text-xs font-bold text-slate-600 tracking-tight">Filter Subscriptions</span>
              {activeCount > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#286FAD] text-white tabular-nums">
                  {activeCount} active
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-[10px] font-semibold text-slate-400 hover:text-red-500 transition-colors"
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors text-base leading-none"
              >
                ×
              </button>
            </div>
          </div>

          {/* ── Body ── */}
          <div className="p-4 space-y-4">

            {/* Organization */}
            {hasOrgs && (
              <div>
                <Label>Organization</Label>
                <div className="relative">
                  <select
                    value={orgId}
                    onChange={e => setOrgId(e.target.value)}
                    className={SELECT_CLS}
                  >
                    <option value="">All Organizations</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <ChevronIcon />
                </div>
              </div>
            )}

            {/* Status · Billing · Quote Status */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Status</Label>
                <div className="relative">
                  <select value={status} onChange={e => setStatus(e.target.value)} className={SELECT_CLS}>
                    <option value="">All Statuses</option>
                    <option value="Active">Active</option>
                    <option value="Expiring_Soon">Expiring Soon</option>
                    <option value="Expired">Expired</option>
                    <option value="Pending">Pending</option>
                    <option value="Cancelled">Cancelled</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                  <ChevronIcon />
                </div>
              </div>
              <div>
                <Label>Billing Period</Label>
                <div className="relative">
                  <select value={billing} onChange={e => setBilling(e.target.value)} className={SELECT_CLS}>
                    <option value="">All Periods</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="half_yearly">Half-Yearly</option>
                    <option value="annual">Annual</option>
                    <option value="biennial">Biennial</option>
                    <option value="triennial">Triennial</option>
                    <option value="one_time">One-Time</option>
                  </select>
                  <ChevronIcon />
                </div>
              </div>
              <div>
                <Label>Quote Status</Label>
                <div className="relative">
                  <select value={renewalStatus} onChange={e => setRenewalStatus(e.target.value)} className={SELECT_CLS}>
                    <option value="">All Quotes</option>
                    <option value="needs_quote">Needs Quote</option>
                    <option value="quoted">Quote Sent</option>
                    <option value="paid">Renewal Paid</option>
                  </select>
                  <ChevronIcon />
                </div>
              </div>
            </div>

            {/* Expiry row */}
            <div>
              <Label>Expiry</Label>
              <div className="grid grid-cols-2 gap-3">
                {/* Expiring In */}
                <div className="relative">
                  <select value={expiring} onChange={e => handleExpiringChange(e.target.value)} className={SELECT_CLS}>
                    <option value="">Expiring In — Any</option>
                    <option value="7">Within 7 days</option>
                    <option value="15">Within 15 days</option>
                    <option value="30">Within 30 days</option>
                    <option value="60">Within 60 days</option>
                  </select>
                  <ChevronIcon />
                </div>
                {/* Expiring On */}
                <div className="space-y-1.5">
                  {expiring && !expiringOn ? (
                    <button
                      type="button"
                      onClick={() => handleExpiringOnChange(todayPlusN(Number(expiring)))}
                      className="w-full px-3 py-2 rounded-lg border border-[#286FAD]/30 bg-[#286FAD]/5 text-[#286FAD] text-xs font-semibold hover:bg-[#286FAD]/10 transition-colors text-left flex items-center justify-between group"
                    >
                      <span>On {fmtDate(todayPlusN(Number(expiring)))}</span>
                      <span className="text-[10px] font-bold text-[#286FAD]/50 group-hover:text-[#286FAD] transition-colors">use →</span>
                    </button>
                  ) : (
                    <input
                      type="date"
                      value={expiringOn}
                      onChange={e => handleExpiringOnChange(e.target.value)}
                      placeholder="Expiring On exact date"
                      className={SELECT_CLS}
                    />
                  )}
                  {expiringOn && (
                    <button
                      type="button"
                      onClick={() => setExpiringOn('')}
                      className="text-[10px] text-slate-400 hover:text-red-400 transition-colors font-medium"
                    >
                      ✕ Clear date
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Category */}
            {categories.length > 0 && (
              <div>
                <Label>Category</Label>
                <div className="relative">
                  <select value={category} onChange={e => setCategory(e.target.value)} className={SELECT_CLS}>
                    <option value="">All Categories</option>
                    {categories.map(c => (
                      <option key={c.itemValue} value={c.itemValue}>{c.itemLabel}</option>
                    ))}
                  </select>
                  <ChevronIcon />
                </div>
              </div>
            )}
          </div>

          {/* ── Active filter chips (when any selected) ── */}
          {activeCount > 0 && (
            <div className="px-4 pb-3 flex flex-wrap gap-1.5">
              {orgId     && orgs.length > 0 && <Chip label="Org" value={orgs.find(o => o.id === orgId)?.name ?? orgId} onRemove={() => setOrgId('')} />}
              {status        && <Chip label="Status"  value={status.replace('_', ' ')}                      onRemove={() => setStatus('')} />}
              {billing       && <Chip label="Billing" value={billing.replace('_', '-')}                     onRemove={() => setBilling('')} />}
              {renewalStatus && <Chip label="Quote"   value={renewalStatus.replace('_', ' ')}               onRemove={() => setRenewalStatus('')} />}
              {expiring      && <Chip label="In"      value={`${expiring}d`}                                onRemove={() => setExpiring('')} />}
              {expiringOn    && <Chip label="On"      value={fmtDate(expiringOn)}                           onRemove={() => setExpiringOn('')} />}
              {category      && <Chip label="Cat"     value={categories.find(c => c.itemValue === category)?.itemLabel ?? category} onRemove={() => setCategory('')} />}
            </div>
          )}

          {/* ── Footer ── */}
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/40 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              className="px-4 py-1.5 bg-[#286FAD] hover:bg-[#1e5a8f] text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
            >
              Apply Filters {activeCount > 0 && `(${activeCount})`}
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes filterPanelIn {
          from { opacity: 0; transform: translateY(-6px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
      `}</style>
    </div>
  );
}

function ChevronIcon() {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
      <svg width="10" height="10" fill="none" stroke="#94a3b8" strokeWidth={2.5} viewBox="0 0 24 24">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}

function Chip({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-[#286FAD]/8 border border-[#286FAD]/20 text-[10px] font-semibold text-[#286FAD]">
      <span className="text-[#286FAD]/50 font-bold uppercase tracking-wide text-[8px]">{label}</span>
      <span>{value}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center hover:bg-[#286FAD]/20 transition-colors text-[#286FAD]/60 hover:text-[#286FAD] leading-none"
      >
        ×
      </button>
    </span>
  );
}
