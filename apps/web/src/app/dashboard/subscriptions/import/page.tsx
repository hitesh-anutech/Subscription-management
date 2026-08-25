'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { importSubscriptionsAction, type ImportSubscription, type ImportResult } from './actions';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

interface Org { id: string; name: string }

interface CustomField { api_name: string; label: string; value: string | number }

interface ZohoInvoice {
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  date: string;
  total: number;
  status: string;
  // Originating quote, resolved server-side from invoice.estimate_id (Track B.2).
  quote_id?: string;
  quote_number?: string;
  quote_date?: string;
  quote_status?: string;
  // Source doc type + billing currency (Track C / multi-currency).
  doc_type?: 'invoice' | 'estimate';
  currency_code?: string;
  exchange_rate?: number;
  custom_fields?: CustomField[];   // header-level (Business Type, Domain, etc.)
  line_items: Array<{
    item_id?: string;
    name: string;
    quantity: number;
    rate: number;
    item_total: number;
    item_custom_fields?: CustomField[];
    custom_fields?: CustomField[];
  }>;
}

// ── Helpers ──────────────────────────────────────────────────────────
function detectBillingCycle(start: string, end: string): string {
  if (!start || !end) return 'annual';
  const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000);
  if (days <= 35)  return 'monthly';
  if (days <= 95)  return 'quarterly';
  if (days <= 190) return 'half_yearly';
  if (days <= 370) return 'annual';
  if (days <= 740) return 'biennial';
  return 'triennial';
}

function parseZohoDate(val: string): string {
  if (!val) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const parts = val.split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  return val;
}

function cfVal(cfs: CustomField[] | undefined, apiName: string): string {
  if (!apiName) return '';
  const f = cfs?.find((c) => c.api_name === apiName);
  return f?.value != null ? String(f.value) : '';
}

// Find Business Type from header custom fields (label contains "business")
function findBusinessType(headerCfs: CustomField[] | undefined): string {
  const f = headerCfs?.find(
    (c) => c.api_name === 'cf_new_business' || c.label?.toLowerCase().includes('business'),
  );
  return f?.value != null ? String(f.value) : '';
}

const BUSINESS_BADGE: Record<string, string> = {
  Fresh:      'bg-blue-100 text-blue-700',
  Renewal:    'bg-green-100 text-green-700',
  'Pro-rata': 'bg-purple-100 text-purple-700',
  Transfer:   'bg-amber-100 text-amber-700',
};

interface BillingEvent {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerId: string;
  customerName: string;
  itemId: string;
  itemName: string;
  domain: string;
  businessType: string;
  start: string;
  end: string;
  qty: number;
  rate: number;
  cost: number;
  quoteId?: string;
  quoteNumber?: string;
  quoteDate?: string;
  quoteStatus?: string;
  docType: 'invoice' | 'estimate';
  currency: string;
  exchangeRate: number;
}

interface Candidate {
  key: string;            // customer :: domain :: item
  dupKey: string;         // customer :: domain  (for duplicate detection)
  isDuplicate: boolean;   // shares dupKey with another candidate
  customerId: string;
  customerName: string;
  itemId: string;
  itemName: string;
  domain: string;
  // current term (from latest Fresh/Renewal)
  start: string;
  end: string;
  qty: number;
  rate: number;
  cost: number;
  billingCycle: string;
  events: BillingEvent[]; // all invoices in this group
  selected: boolean;
  docType: 'invoice' | 'estimate';
  currency: string;
  exchangeRate: number;
  sourceQuoteStatus?: string; // for estimate-sourced candidates (drives create gating)
}

function ImportSubscriptionsInner() {
  const searchParams = useSearchParams();
  const preOrgId    = searchParams.get('org_id') ?? '';
  const preRefNum   = searchParams.get('ref_number') ?? '';
  const preDocSrc   = (searchParams.get('doc_source') as 'invoices' | 'estimates' | null) ?? 'invoices';

  const [orgs,        setOrgs]        = useState<Org[]>([]);
  const [selectedOrg, setSelectedOrg] = useState(preOrgId);
  const [mappings,    setMappings]    = useState<Record<string, string>>({});
  const [dateStart,   setDateStart]   = useState('');
  const [dateEnd,     setDateEnd]     = useState('');
  const [status,      setStatus]      = useState(preDocSrc === 'estimates' ? 'accepted' : 'paid');
  const [refNumber,   setRefNumber]   = useState(preRefNum);
  const [docSource,   setDocSource]   = useState<'invoices' | 'estimates'>(preDocSrc);
  const [businessType, setBusinessType] = useState('');
  const [expiryFrom,  setExpiryFrom]  = useState('');
  const [expiryTo,    setExpiryTo]    = useState('');
  const [loading,     setLoading]     = useState(false);
  const [candidates,  setCandidates]  = useState<Candidate[]>([]);
  const [importing,   setImporting]   = useState(false);
  const [result,      setResult]      = useState<ImportResult | null>(null);
  const [fetchMsg,    setFetchMsg]    = useState<string | null>(null);

  // Client-side "refine" filters over already-fetched candidates.
  const [fCycle,    setFCycle]    = useState('');
  const [fDomain,   setFDomain]   = useState('');
  const [fItem,     setFItem]     = useState('');
  const [fMin,      setFMin]      = useState('');
  const [fMax,      setFMax]      = useState('');

  // Auto-fetch when opened with pre-filled params (org + ref_number).
  const autoFetched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/organizations`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d: { organizations: Array<Org & { isActive?: boolean }> }) => {
        if (cancelled) return;
        const active = d.organizations?.filter((o) => o.isActive !== false) ?? [];
        setOrgs(active);
        // If org pre-selected via URL, use it; otherwise default to first active org.
        const orgToUse = preOrgId && active.find((o) => o.id === preOrgId) ? preOrgId : active[0]?.id ?? '';
        if (orgToUse) { setSelectedOrg(orgToUse); void loadMappings(orgToUse); }
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once orgs are loaded + org is set, auto-fetch if ref_number was pre-filled.
  useEffect(() => {
    if (autoFetched.current || !selectedOrg || !preRefNum || orgs.length === 0) return;
    autoFetched.current = true;
    void fetchInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrg, orgs]);

  const loadMappings = async (orgId: string) => {
    try {
      const res = await fetch(`${API_BASE}/org-settings/${orgId}`, { credentials: 'include' });
      const data = await res.json() as { settings?: { metadata?: Record<string, unknown> } };
      const m = (data.settings?.metadata as Record<string, unknown> | undefined)?.item_field_mappings as Record<string, string> | undefined;
      setMappings(m ?? {});
    } catch { /* ignore */ }
  };

  const handleOrgChange = (orgId: string) => {
    setSelectedOrg(orgId);
    setCandidates([]);
    void loadMappings(orgId);
  };

  const fetchInvoices = async () => {
    if (!selectedOrg) return;
    setLoading(true);
    setFetchMsg('⏳ Zoho से invoices fetch हो रही हैं…');
    setCandidates([]);
    setResult(null);

    const params = new URLSearchParams();
    if (status)    params.set('status', status);
    if (dateStart) params.set('date_start', dateStart);
    if (dateEnd)   params.set('date_end', dateEnd);
    if (refNumber.trim()) params.set('reference_number', refNumber.trim());
    if (businessType) params.set('business_type', businessType);
    if (expiryFrom)   params.set('service_expiry_from', expiryFrom);
    if (expiryTo)     params.set('service_expiry_to', expiryTo);

    const endpoint = docSource === 'estimates' ? 'estimates-preview' : 'invoices-preview';
    try {
      const res = await fetch(`${API_BASE}/organizations/${selectedOrg}/${endpoint}?${params}`, { credentials: 'include' });
      if (!res.ok) { setFetchMsg('❌ Fetch failed — Zoho connected है?'); return; }
      const data = await res.json() as { invoices: ZohoInvoice[] };
      const invoices = data.invoices ?? [];

      // 1. Flatten to billing events
      const events: BillingEvent[] = [];
      for (const inv of invoices) {
        const docType = inv.doc_type ?? 'invoice';
        const isEstimate = docType === 'estimate';
        const headerDomain = cfVal(inv.custom_fields, 'cf_domain_name');
        const businessType = findBusinessType(inv.custom_fields);
        for (const li of inv.line_items ?? []) {
          const itemCfs = li.item_custom_fields ?? li.custom_fields ?? [];
          const domain = cfVal(itemCfs, mappings.domain_name ?? 'cf_domain_name') || headerDomain;
          const start  = parseZohoDate(cfVal(itemCfs, mappings.start_date ?? 'cf_subscription_start_date'));
          const end    = parseZohoDate(cfVal(itemCfs, mappings.end_date ?? 'cf_subscription_end_date'));
          const cost   = Number(cfVal(itemCfs, mappings.cost_price ?? 'cf_cost_price')) || 0;
          events.push({
            // For estimates there is no invoice — leave invoiceId blank; the quote fields carry the link.
            invoiceId: isEstimate ? '' : inv.invoice_id,
            invoiceNumber: isEstimate ? '' : inv.invoice_number,
            invoiceDate: inv.date,
            customerId: inv.customer_id,
            customerName: inv.customer_name,
            itemId: li.item_id ?? '',
            itemName: li.name,
            domain,
            businessType,
            start, end,
            qty: li.quantity,
            rate: li.rate,
            cost,
            quoteId: inv.quote_id,
            quoteNumber: inv.quote_number,
            quoteDate: inv.quote_date,
            quoteStatus: inv.quote_status,
            docType,
            currency: inv.currency_code ?? 'INR',
            exchangeRate: inv.exchange_rate ?? 1,
          });
        }
      }

      // 2. Group by customer :: domain :: item
      const groups = new Map<string, BillingEvent[]>();
      for (const e of events) {
        const key = `${e.customerId}::${e.domain}::${e.itemId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(e);
      }

      // 3. Build candidates — current term from latest Fresh/Renewal (not Pro-rata)
      const cands: Candidate[] = [];
      for (const [key, evts] of groups) {
        const sorted = [...evts].sort((a, b) => (a.end || a.invoiceDate).localeCompare(b.end || b.invoiceDate));
        const termDefining = sorted.filter((e) => !/pro.?rata/i.test(e.businessType));
        const current = (termDefining.length ? termDefining : sorted)[ (termDefining.length ? termDefining : sorted).length - 1 ];
        cands.push({
          key,
          dupKey: `${current.customerId}::${current.domain}`,
          isDuplicate: false,
          customerId: current.customerId,
          customerName: current.customerName,
          itemId: current.itemId,
          itemName: current.itemName,
          domain: current.domain,
          start: current.start,
          end: current.end,
          qty: current.qty,
          rate: current.rate,
          cost: current.cost,
          billingCycle: detectBillingCycle(current.start, current.end),
          events: sorted,
          selected: !!(current.domain && current.start && current.end),
          docType: current.docType,
          currency: current.currency,
          exchangeRate: current.exchangeRate,
          sourceQuoteStatus: current.quoteStatus,
        });
      }

      // 4. Duplicate detection — same customer+domain, different item
      const dupCount = new Map<string, number>();
      cands.forEach((c) => dupCount.set(c.dupKey, (dupCount.get(c.dupKey) ?? 0) + 1));
      cands.forEach((c) => { c.isDuplicate = (dupCount.get(c.dupKey) ?? 0) > 1; });

      // sort: duplicates grouped together
      cands.sort((a, b) => a.dupKey.localeCompare(b.dupKey) || a.itemName.localeCompare(b.itemName));

      setCandidates(cands);
      const docLabel = docSource === 'estimates' ? 'quotes' : 'invoices';
      setFetchMsg(`✅ ${invoices.length} ${docLabel} · ${events.length} line items → ${cands.length} subscriptions`);
    } catch {
      setFetchMsg('❌ Server error');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key: string) =>
    setCandidates((prev) => prev.map((c) => c.key === key ? { ...c, selected: !c.selected } : c));

  const update = (key: string, field: keyof Candidate, value: unknown) =>
    setCandidates((prev) => prev.map((c) => c.key === key ? { ...c, [field]: value } : c));

  const selected = candidates.filter((c) => c.selected);

  // Refine filters — applied instantly over fetched candidates (no refetch).
  const min = fMin.trim() ? Number(fMin) : null;
  const max = fMax.trim() ? Number(fMax) : null;
  const visible = candidates.filter((c) => {
    if (fCycle && c.billingCycle !== fCycle) return false;
    if (fDomain && !c.domain.toLowerCase().includes(fDomain.toLowerCase())) return false;
    if (fItem && !c.itemName.toLowerCase().includes(fItem.toLowerCase())) return false;
    if (min !== null && !Number.isNaN(min) && c.rate < min) return false;
    if (max !== null && !Number.isNaN(max) && c.rate > max) return false;
    return true;
  });
  const visibleKeys = new Set(visible.map((c) => c.key));
  const allVisibleSelected = visible.length > 0 && visible.every((c) => c.selected);
  const clearRefine = () => { setFCycle(''); setFDomain(''); setFItem(''); setFMin(''); setFMax(''); };

  const handleImport = async () => {
    if (!selected.length) return;
    setImporting(true);
    setResult(null);

    const payload: ImportSubscription[] = selected.map((c) => ({
      organizationId:    selectedOrg,
      zohoCustomerId:    c.customerId,
      zohoCustomerName:  c.customerName,
      zohoItemId:        c.itemId,
      zohoItemName:      c.itemName,
      domainName:        c.domain,
      quantity:          c.qty,
      subscriptionPrice: c.rate,
      costPrice:         c.cost,
      billingCycle:      c.billingCycle,
      currency:          c.currency,
      exchangeRate:      c.exchangeRate,
      startDate:         c.start,
      endDate:           c.end,
      lastInvoiceId:     c.docType === 'estimate' ? undefined : c.events[c.events.length - 1]?.invoiceId,
      lastInvoiceNumber: c.docType === 'estimate' ? undefined : c.events[c.events.length - 1]?.invoiceNumber,
      sourceIsEstimate:  c.docType === 'estimate',
      sourceQuoteStatus: c.sourceQuoteStatus,
      history: c.events.map((e) => ({
        invoiceId:     e.invoiceId || undefined,
        invoiceNumber: e.invoiceNumber || undefined,
        invoiceDate:   e.invoiceDate || undefined,
        startDate:     e.start || undefined,
        endDate:       e.end || undefined,
        quantity:      e.qty,
        price:         e.rate,
        businessType:  e.businessType || undefined,
        quoteId:       e.quoteId || undefined,
        quoteNumber:   e.quoteNumber || undefined,
        quoteDate:     e.quoteDate || undefined,
        quoteStatus:   e.quoteStatus || undefined,
        currency:      e.currency,
        exchangeRate:  e.exchangeRate,
      })),
    }));

    const res = await importSubscriptionsAction(payload);
    setResult(res);
    setImporting(false);
    if (res.created > 0) {
      setCandidates((prev) => prev.map((c) => c.selected ? { ...c, selected: false } : c));
    }
  };

  const hasMappings = mappings.domain_name || mappings.start_date;

  return (
    <div className="space-y-5">
      <div>
        <nav className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
          <Link href="/dashboard/subscriptions" className="hover:text-slate-600">Subscriptions</Link>
          <span>›</span>
          <span className="text-slate-600">Import from Zoho</span>
        </nav>
        <h1 className="text-2xl font-bold text-slate-900">Import Subscriptions from Zoho</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          एक ही subscription के कई साल के invoices automatically group होंगे — कोई duplicate नहीं।
        </p>
      </div>

      {/* Step 1 — Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">Step 1 — Organization & Filters</h2>

        {!hasMappings && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700">
            ⚠️ Item field mapping set नहीं है — Domain/Start/End/Cost values नहीं मिलेंगी।{' '}
            <Link href="/dashboard/settings/organizations" className="underline font-medium">
              Settings → Organizations
            </Link>{' '}में पहले mapping configure करो। (Defaults: cf_domain_name, cf_subscription_start_date आदि try होंगे।)
          </div>
        )}

        <div className="grid grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Organization</label>
            <select value={selectedOrg} onChange={(e) => handleOrgChange(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Source</label>
            <select value={docSource} onChange={(e) => { setDocSource(e.target.value as 'invoices' | 'estimates'); setStatus(e.target.value === 'estimates' ? 'accepted' : 'paid'); setCandidates([]); }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="invoices">Invoices</option>
              <option value="estimates">Quotes (Estimates)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {docSource === 'estimates' ? (
                <>
                  <option value="accepted">Accepted</option>
                  <option value="invoiced">Invoiced</option>
                  <option value="sent">Sent</option>
                  <option value="declined">Declined</option>
                  <option value="expired">Expired</option>
                  <option value="">All</option>
                </>
              ) : (
                <>
                  <option value="paid">Paid</option>
                  <option value="sent">Sent</option>
                  <option value="overdue">Overdue</option>
                  <option value="">All</option>
                </>
              )}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Date From</label>
            <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Date To</label>
            <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Reference No.</label>
            <input type="text" value={refNumber} onChange={(e) => setRefNumber(e.target.value)} placeholder="domain / PO…"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Business Type</label>
            <select value={businessType} onChange={(e) => setBusinessType(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All</option>
              <option value="Renewal">Renewal</option>
              <option value="Fresh">Fresh</option>
              <option value="Pro-rata">Pro-rata</option>
              <option value="Transfer">Transfer</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Service Expiry From</label>
            <input type="date" value={expiryFrom} onChange={(e) => setExpiryFrom(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Service Expiry To</label>
            <input type="date" value={expiryTo} onChange={(e) => setExpiryTo(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="button" onClick={() => void fetchInvoices()} disabled={loading || !selectedOrg}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold rounded-lg transition-colors">
            {loading ? '⏳ Fetching…' : `↓ Fetch & Group ${docSource === 'estimates' ? 'Quotes' : 'Invoices'}`}
          </button>
          {fetchMsg && <span className="text-sm text-slate-600">{fetchMsg}</span>}
        </div>
      </div>

      {/* Step 2 — Grouped candidates */}
      {candidates.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">Step 2 — Review Subscriptions</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {selected.length} selected · showing {visible.length} of {candidates.length} · हर row = एक subscription
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" checked={allVisibleSelected}
                  onChange={(e) => setCandidates((prev) => prev.map((c) => visibleKeys.has(c.key) ? { ...c, selected: e.target.checked } : c))}
                  className="rounded" />
                Select {visible.length < candidates.length ? 'Shown' : 'All'}
              </label>
              <button type="button" onClick={() => void handleImport()} disabled={importing || !selected.length}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-semibold rounded-lg transition-colors">
                {importing ? 'Importing…' : `✓ Import Selected (${selected.length})`}
              </button>
            </div>
          </div>

          {/* Refine filters — instant, over the fetched candidates */}
          <div className="flex flex-wrap items-end gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
            <div>
              <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-0.5">Cycle</label>
              <select value={fCycle} onChange={(e) => setFCycle(e.target.value)}
                className="px-2 py-1 border border-slate-300 rounded text-xs bg-white">
                <option value="">All</option>
                {['monthly', 'quarterly', 'half_yearly', 'annual', 'biennial', 'triennial'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-0.5">Domain contains</label>
              <input value={fDomain} onChange={(e) => setFDomain(e.target.value)} placeholder="example.in"
                className="px-2 py-1 border border-slate-300 rounded text-xs w-32" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-0.5">Product contains</label>
              <input value={fItem} onChange={(e) => setFItem(e.target.value)} placeholder="Workspace"
                className="px-2 py-1 border border-slate-300 rounded text-xs w-32" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-0.5">Rate min</label>
              <input type="number" value={fMin} onChange={(e) => setFMin(e.target.value)}
                className="px-2 py-1 border border-slate-300 rounded text-xs w-20" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-0.5">Rate max</label>
              <input type="number" value={fMax} onChange={(e) => setFMax(e.target.value)}
                className="px-2 py-1 border border-slate-300 rounded text-xs w-20" />
            </div>
            <button type="button" onClick={clearRefine}
              className="px-2.5 py-1 border border-slate-300 text-slate-500 rounded text-xs hover:bg-white">
              Clear
            </button>
          </div>

          {result && (
            <div className={`px-5 py-3 text-sm border-b ${result.errors.length ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
              <p className="font-medium">
                {result.created} created · {result.enriched} enriched (history linked) · {result.skipped} skipped ✅
              </p>
              {result.errors.map((e, i) => <p key={i} className="text-xs text-red-600 mt-1">❌ {e}</p>)}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2.5 w-8"></th>
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Customer / Domain</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Product</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Invoices</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Qty</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Rate</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Current Term</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Cycle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((c) => (
                  <tr key={c.key} className={`hover:bg-slate-50 ${c.selected ? 'bg-blue-50/30' : ''} ${c.isDuplicate ? 'border-l-2 border-l-amber-400' : ''}`}>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" checked={c.selected} onChange={() => toggle(c.key)}
                        className="rounded border-slate-300 text-blue-600" />
                    </td>
                    <td className="px-3 py-2 max-w-44">
                      <p className="font-medium text-slate-800 truncate">{c.customerName}</p>
                      <input value={c.domain} onChange={(e) => update(c.key, 'domain', e.target.value)}
                        placeholder="domain.in"
                        className={`mt-0.5 w-full px-1.5 py-0.5 border rounded text-xs ${!c.domain ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`} />
                      {c.isDuplicate && (
                        <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                          ⚠️ same domain — choose one
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-40">
                      <p className="text-slate-700 truncate">{c.itemName}</p>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="inline-flex items-center gap-1">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">{c.events.length}</span>
                      </span>
                      <div className="flex flex-wrap gap-0.5 mt-1 justify-center max-w-32">
                        {c.events.map((e, i) => (
                          <span key={i} title={`${e.invoiceNumber} (${e.businessType})`}
                            className={`text-[9px] px-1 py-0.5 rounded ${BUSINESS_BADGE[e.businessType] ?? 'bg-slate-100 text-slate-500'}`}>
                            {e.businessType || '—'}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input type="number" min={1} value={c.qty} onChange={(e) => update(c.key, 'qty', Number(e.target.value))}
                        className="w-12 px-1 py-0.5 border border-slate-200 rounded text-xs text-center" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {c.currency && c.currency !== 'INR' && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">{c.currency}</span>
                        )}
                        <input type="number" min={0} value={c.rate} onChange={(e) => update(c.key, 'rate', Number(e.target.value))}
                          className="w-20 px-1 py-0.5 border border-slate-200 rounded text-xs text-right" />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-0.5">
                        <input type="date" value={c.start} onChange={(e) => update(c.key, 'start', e.target.value)}
                          className={`px-1 py-0.5 border rounded text-xs ${!c.start ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`} />
                        <input type="date" value={c.end} onChange={(e) => update(c.key, 'end', e.target.value)}
                          className={`px-1 py-0.5 border rounded text-xs ${!c.end ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <select value={c.billingCycle} onChange={(e) => update(c.key, 'billingCycle', e.target.value)}
                        className="px-1.5 py-1 border border-slate-200 rounded text-xs bg-white">
                        {['monthly','quarterly','half_yearly','annual','biennial','triennial'].map((x) => (
                          <option key={x} value={x}>{x}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-400 space-y-1">
            <p>🟡 Yellow = value नहीं मिली (manually fill करो)। ⚠️ Amber border = same customer+domain के कई products (duplicate — सिर्फ सही वाला select रखो)।</p>
            <p>Invoice badges: <span className="px-1 rounded bg-blue-100 text-blue-700">Fresh</span> <span className="px-1 rounded bg-green-100 text-green-700">Renewal</span> <span className="px-1 rounded bg-purple-100 text-purple-700">Pro-rata</span> — current term latest Fresh/Renewal से लिया जाता है।</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ImportSubscriptionsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-400 p-8">Loading…</div>}>
      <ImportSubscriptionsInner />
    </Suspense>
  );
}
