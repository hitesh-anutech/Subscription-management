'use client';

import { useState, useEffect, useRef, Suspense, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { importSubscriptionsAction, type ImportSubscription, type ImportResult } from './actions';
import { SubscriptionStatusCell, type SubscriptionCheckResult, type ProrataEvent } from './_components/subscription-status-cell';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

const DC_TLD: Record<string, string> = { in: 'in', com: 'com', eu: 'eu', com_au: 'com.au', jp: 'jp', sa: 'sa' };

interface Org { id: string; name: string; zohoOrgId?: string; dataCenter?: string }

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
  const [businessTypes, setBusinessTypes] = useState<string[]>([]);
  const [btOpen,        setBtOpen]        = useState(false);
  const btRef = useRef<HTMLDivElement>(null);
  const [expiryFrom,  setExpiryFrom]  = useState('');
  const [expiryTo,    setExpiryTo]    = useState('');
  const [loading,     setLoading]     = useState(false);
  const [candidates,  setCandidates]  = useState<Candidate[]>([]);
  const [importing,   setImporting]   = useState(false);
  const [result,      setResult]      = useState<ImportResult | null>(null);
  const [fetchMsg,    setFetchMsg]    = useState<string | null>(null);

  // Subscription DB check state
  const [subChecks,     setSubChecks]     = useState<Record<string, SubscriptionCheckResult | null>>({});
  const [checksLoading, setChecksLoading] = useState(false);
  const [overrideKeys,  setOverrideKeys]  = useState<Set<string>>(new Set());

  // Client-side "refine" filters over already-fetched candidates.
  const [fCycle,    setFCycle]    = useState('');
  const [fDomain,   setFDomain]   = useState('');
  const [fItem,     setFItem]     = useState('');
  const [fMin,      setFMin]      = useState('');
  const [fMax,      setFMax]      = useState('');

  // Close Business Type dropdown when clicking outside.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (btRef.current && !btRef.current.contains(e.target as Node)) setBtOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  // Once orgs are loaded + org is set, auto-fetch if ref_number was pre-filled (dates required).
  useEffect(() => {
    if (autoFetched.current || !selectedOrg || !preRefNum || orgs.length === 0 || !dateStart || !dateEnd) return;
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
    setSubChecks({});
    setOverrideKeys(new Set());
    void loadMappings(orgId);
  };

  // Batch check — runs after grouping (and after import to re-confirm)
  const runBatchCheck = useCallback(async (cands: Candidate[], orgId: string) => {
    if (!cands.length || !orgId) return;
    setChecksLoading(true);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/batch-check`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cands.map((c) => ({
            key:            c.key,
            organizationId: orgId,
            zohoCustomerId: c.customerId,
            zohoItemId:     c.itemId,
            zohoItemName:   c.itemName,
            domainName:     c.domain,
          })),
        }),
      });
      if (!res.ok) return;
      const checks = await res.json() as Record<string, SubscriptionCheckResult | null>;

      // Cross-reference: if candidate A has no match but a sibling candidate
      // (same customer + domain + item name, different Zoho item ID) DOES have a
      // match, reuse that match. This handles the case where the same Zoho product
      // exists under two different item IDs (recreated/duplicated item in Zoho).
      const enriched = { ...checks };
      for (const c of cands) {
        if (enriched[c.key] !== null) continue;
        const sibling = cands.find(
          (other) =>
            other.key !== c.key &&
            other.customerId === c.customerId &&
            other.domain.trim().toLowerCase() === c.domain.trim().toLowerCase() &&
            other.itemName.trim().toLowerCase() === c.itemName.trim().toLowerCase() &&
            enriched[other.key] !== null,
        );
        if (sibling) {
          enriched[c.key] = { ...enriched[sibling.key]!, matchType: 'sibling' };
        }
      }

      setSubChecks(enriched);
      // Auto-deselect rows that already have a subscription (user can re-check to override)
      setCandidates((prev) =>
        prev.map((c) => enriched[c.key] ? { ...c, selected: false } : c),
      );
    } finally {
      setChecksLoading(false);
    }
  }, []);

  const fetchInvoices = async () => {
    if (!selectedOrg) return;
    setLoading(true);
    setFetchMsg('⏳ Zoho से invoices fetch हो रही हैं…');
    setCandidates([]);
    setSubChecks({});
    setOverrideKeys(new Set());
    setResult(null);

    const params = new URLSearchParams();
    if (status)    params.set('status', status);
    if (dateStart) params.set('date_start', dateStart);
    if (dateEnd)   params.set('date_end', dateEnd);
    if (refNumber.trim()) params.set('reference_number', refNumber.trim());
    if (businessTypes.length) params.set('business_type', businessTypes.join(','));
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

      // 5. Batch check against DB (non-blocking — status column shows spinner until done)
      void runBatchCheck(cands, selectedOrg);
    } catch {
      setFetchMsg('❌ Server error');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key: string) => {
    setCandidates((prev) => prev.map((c) => {
      if (c.key !== key) return c;
      const newSelected = !c.selected;
      // Track override: user is selecting a row that already has a subscription
      if (subChecks[key] != null) {
        setOverrideKeys((prevKeys) => {
          const next = new Set(prevKeys);
          newSelected ? next.add(key) : next.delete(key);
          return next;
        });
      }
      return { ...c, selected: newSelected };
    }));
  };

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

  // Smart select helpers (post batch-check)
  const checksReady = !checksLoading && Object.keys(subChecks).length > 0;
  const newCount      = checksReady ? candidates.filter((c) => !subChecks[c.key]).length : null;
  const existingCount = checksReady ? candidates.filter((c) =>  subChecks[c.key]).length : null;

  const selectAllNew = () => {
    setOverrideKeys(new Set()); // clear overrides when bulk-selecting new only
    setCandidates((prev) => prev.map((c) => ({ ...c, selected: !subChecks[c.key] && !!(c.domain && c.start && c.end) })));
  };
  const deselectAllExisting = () => {
    setOverrideKeys(new Set());
    setCandidates((prev) => prev.map((c) => subChecks[c.key] ? { ...c, selected: false } : c));
  };

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

    if (res.created > 0 || res.enriched > 0) {
      // Deselect imported rows
      setCandidates((prev) => prev.map((c) => c.selected ? { ...c, selected: false } : c));
      // Re-run batch check to confirm newly created subscriptions
      void runBatchCheck(candidates, selectedOrg);
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
            <select value={docSource} onChange={(e) => { setDocSource(e.target.value as 'invoices' | 'estimates'); setStatus(e.target.value === 'estimates' ? 'accepted' : 'paid'); setCandidates([]); setSubChecks({}); }}
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
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Date From <span className="text-red-500">*</span>
            </label>
            <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${!dateStart ? 'border-red-300 bg-red-50' : 'border-slate-300'}`} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Date To <span className="text-red-500">*</span>
            </label>
            <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${!dateEnd ? 'border-red-300 bg-red-50' : 'border-slate-300'}`} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Invoice / Quote No.</label>
            <input type="text" value={refNumber} onChange={(e) => setRefNumber(e.target.value)} placeholder="INV/25-26/1401…"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div ref={btRef} className="relative">
            <label className="block text-xs font-medium text-slate-600 mb-1">Business Type</label>
            <button
              type="button"
              onClick={() => setBtOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-left"
            >
              <span className={businessTypes.length === 0 ? 'text-slate-400' : 'text-slate-800'}>
                {businessTypes.length === 0 ? 'All' : businessTypes.join(', ')}
              </span>
              <span className="text-slate-400 text-xs ml-1">▾</span>
            </button>
            {btOpen && (
              <div className="absolute z-50 top-full left-0 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[140px]">
                <button
                  type="button"
                  onClick={() => { setBusinessTypes([]); setBtOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 ${businessTypes.length === 0 ? 'font-semibold text-blue-600' : 'text-slate-600'}`}
                >
                  All
                </button>
                {(['Renewal', 'Fresh', 'Pro-rata', 'Transfer'] as const).map((type) => (
                  <label key={type} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={businessTypes.includes(type)}
                      onChange={(e) =>
                        setBusinessTypes((prev) =>
                          e.target.checked ? [...prev, type] : prev.filter((t) => t !== type),
                        )
                      }
                      className="rounded"
                    />
                    {type}
                  </label>
                ))}
              </div>
            )}
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
          <button type="button" onClick={() => void fetchInvoices()} disabled={loading || !selectedOrg || !dateStart || !dateEnd}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors">
            {loading ? '⏳ Fetching…' : `↓ Fetch & Group ${docSource === 'estimates' ? 'Quotes' : 'Invoices'}`}
          </button>
          {(!dateStart || !dateEnd) && !loading && (
            <span className="text-xs text-red-500">Date From और Date To दोनों select करो</span>
          )}
          {fetchMsg && (dateStart && dateEnd) && <span className="text-sm text-slate-600">{fetchMsg}</span>}
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
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setCandidates((prev) => prev.map((c) => {
                      if (!visibleKeys.has(c.key)) return c;
                      if (checked && subChecks[c.key]) {
                        setOverrideKeys((pk) => { const n = new Set(pk); n.add(c.key); return n; });
                      }
                      if (!checked) {
                        setOverrideKeys((pk) => { const n = new Set(pk); n.delete(c.key); return n; });
                      }
                      return { ...c, selected: checked };
                    }));
                  }}
                  className="rounded" />
                Select {visible.length < candidates.length ? 'Shown' : 'All'}
              </label>
              <button type="button" onClick={() => void handleImport()} disabled={importing || !selected.length}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-semibold rounded-lg transition-colors">
                {importing ? 'Importing…' : `✓ Import Selected (${selected.length})`}
              </button>
            </div>
          </div>

          {/* Summary strip — shown after batch check */}
          {checksReady && (
            <div className="flex items-center gap-3 px-5 py-2.5 border-b border-slate-100 bg-slate-50/60 text-xs">
              <span className="text-slate-500 font-medium">DB Status:</span>
              {newCount !== null && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 font-semibold">
                  ✗ {newCount} new {newCount === 1 ? 'subscription' : 'subscriptions'} ready to import
                </span>
              )}
              {existingCount !== null && existingCount > 0 && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">
                  ✓ {existingCount} already tracked
                </span>
              )}
              {/* Smart select buttons */}
              {newCount !== null && newCount > 0 && (
                <button type="button" onClick={selectAllNew}
                  className="ml-auto px-2.5 py-1 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors">
                  ✗ Select All New ({newCount})
                </button>
              )}
              {existingCount !== null && existingCount > 0 && (
                <button type="button" onClick={deselectAllExisting}
                  className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 font-medium hover:bg-white transition-colors">
                  Deselect Existing ({existingCount})
                </button>
              )}
            </div>
          )}

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
              <p className="font-semibold text-slate-800">
                {result.created > 0 && <span className="text-emerald-700">✓ {result.created} created</span>}
                {result.created > 0 && result.enriched > 0 && <span className="text-slate-400 mx-2">·</span>}
                {result.enriched > 0 && <span className="text-blue-700">↻ {result.enriched} enriched (history linked)</span>}
                {(result.created > 0 || result.enriched > 0) && result.skipped > 0 && <span className="text-slate-400 mx-2">·</span>}
                {result.skipped > 0 && <span className="text-slate-500">{result.skipped} skipped</span>}
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
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Invoices</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Qty</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Rate</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Cost</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Current Term</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide">Cycle</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    {checksLoading ? '⏳ DB Status' : 'DB Status'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((c) => (
                  <tr key={c.key} className={`hover:bg-slate-50 transition-colors ${c.selected ? 'bg-blue-50/30' : ''} ${c.isDuplicate ? 'border-l-2 border-l-amber-400' : ''}`}>
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
                    <td className="px-3 py-2">
                      <p className="text-slate-700">{c.itemName}</p>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-0.5 mb-1">
                        {c.events.map((e, i) => {
                          const isEst = e.docType === 'estimate';
                          const docId = isEst ? (e.quoteId ?? '') : e.invoiceId;
                          const docNum = isEst ? (e.quoteNumber ?? '') : e.invoiceNumber;
                          const entity = isEst ? 'quotes' : 'invoices';
                          const zo = orgs.find(o => o.id === selectedOrg);
                          const zohoUrl = (docId && zo?.zohoOrgId)
                            ? `https://books.zoho.${DC_TLD[zo.dataCenter ?? ''] ?? 'com'}/app/${zo.zohoOrgId}#/${entity}/${docId}`
                            : null;
                          return (
                            <div key={i} className="flex items-center gap-1">
                              <span className="font-mono text-[10px] text-slate-600">{docNum || '—'}</span>
                              {zohoUrl && (
                                <a href={zohoUrl} target="_blank" rel="noopener noreferrer"
                                  className="text-blue-500 hover:text-blue-700 flex-shrink-0" title="Zoho Books में खोलें">
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                    <polyline points="15 3 21 3 21 9"/>
                                    <line x1="10" y1="14" x2="21" y2="3"/>
                                  </svg>
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        {c.events.map((e, i) => (
                          <span key={i} title={`${e.invoiceNumber || e.quoteNumber} (${e.businessType})`}
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
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        value={c.cost}
                        onChange={(e) => update(c.key, 'cost', Number(e.target.value))}
                        placeholder="0"
                        title="Cost price (for margin tracking)"
                        className="w-20 px-1 py-0.5 border border-slate-200 rounded text-xs text-right"
                      />
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
                    <SubscriptionStatusCell
                      match={subChecks[c.key] ?? null}
                      isLoading={checksLoading}
                      isOverride={overrideKeys.has(c.key)}
                      candidateData={{
                        start: c.start,
                        end: c.end,
                        qty: c.qty,
                        rate: c.rate,
                        billingCycle: c.billingCycle,
                        invoiceNumber: c.events.find(e => e.start === c.start && e.end === c.end)?.invoiceNumber,
                        quoteNumber:   c.events.find(e => e.start === c.start && e.end === c.end)?.quoteNumber,
                      }}
                      prorataEvents={(() => {
                        if (!subChecks[c.key]) return undefined;
                        const evts = c.events
                          .filter((e) => /pro.?rata/i.test(e.businessType))
                          .map((e): ProrataEvent => ({
                            invoiceId: e.invoiceId, invoiceNumber: e.invoiceNumber,
                            invoiceDate: e.invoiceDate, businessType: e.businessType,
                            start: e.start, end: e.end, qty: e.qty, rate: e.rate,
                            currency: e.currency, exchangeRate: e.exchangeRate,
                          }));
                        return evts.length ? evts : undefined;
                      })()}
                      onEditSaved={() => void runBatchCheck(candidates, selectedOrg)}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-400 space-y-1">
            <p>🟡 Yellow = value नहीं मिली (manually fill करो)। ⚠️ Amber border = same customer+domain के कई products (duplicate — सिर्फ सही वाला select रखो)।</p>
            <p>
              DB Status: <span className="px-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">✓ Exists</span> = subscription already tracked (deselected by default — re-check to override).{' '}
              <span className="px-1 rounded bg-amber-50 text-amber-700 border border-amber-200">✗ No Sub</span> = import करो।{' '}
              <span className="px-1 rounded bg-orange-50 text-orange-700 border border-orange-200">⚠ Override</span> = existing subscription — history backfill होगी।
            </p>
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
