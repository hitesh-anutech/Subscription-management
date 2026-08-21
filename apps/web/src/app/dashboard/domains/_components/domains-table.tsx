'use client';

import Link from 'next/link';
import { Fragment, useState, useTransition } from 'react';
import { Trash } from 'lucide-react';
import { bulkDeleteDomainsAction } from '../actions';
import { HistoryDialog } from '@/components/history-dialog';

/** Zoho data-center → Books domain TLD. */
const DC_TLD: Record<string, string> = {
  in: 'in',
  com: 'com',
  eu: 'eu',
  com_au: 'com.au',
  jp: 'jp',
  sa: 'sa',
};

/**
 * Zoho Books deep links need the org id in the path (`/app/{orgId}#/…`) and the
 * correct data-center TLD, otherwise Zoho loads the default org and 404s.
 */
function zohoBooksUrl(
  org: { zohoOrgId: string; dataCenter: string },
  entity: 'contacts' | 'invoices' | 'estimates',
  id: string,
): string {
  const tld = DC_TLD[org.dataCenter] ?? 'com';
  // Zoho Books' web-app route for estimates is `#/quotes/` — `#/estimates/` 404s ("Page Not Found").
  const path = entity === 'estimates' ? 'quotes' : entity;
  return `https://books.zoho.${tld}/app/${org.zohoOrgId}#/${path}/${id}`;
}

export interface LinkedSub {
  id: string;
  subscriptionNumber: string;
  zohoItemName: string | null;
  quantity: string;
  billingCycle: string;
  endDate: string;
  lifecycleStatus: string;
  processStatus: string;
  lastInvoiceId: string | null;
  lastInvoiceNumber: string | null;
  lastQuoteId: string | null;
  lastQuoteNumber: string | null;
}

export interface Domain {
  id: string;
  domainName: string;
  zohoCustomerName: string | null;
  zohoCustomerId: string;
  status: string;
  notes: string | null;
  organization: { id: string; name: string; zohoOrgId: string; dataCenter: string };
  activeSubsCount: number;
  _count: { subscriptions: number };
  subscriptions: LinkedSub[];
  createdAt: string;
}

/** Domain (active/inactive/suspended) status pill config. */
const DOMAIN_STATUS: Record<string, { label: string; className: string; icon: string }> = {
  active:    { label: 'Active',    className: 'bg-emerald-100 text-emerald-800', icon: '✓' },
  suspended: { label: 'Suspended', className: 'bg-amber-100 text-amber-800',     icon: '⚠' },
  inactive:  { label: 'Inactive',  className: 'bg-slate-200 text-slate-600',     icon: '' },
};

/** Subscription lifecycle status pill config. */
const SUB_STATUS: Record<string, string> = {
  Active:        'bg-emerald-100 text-emerald-800',
  Expiring_Soon: 'bg-amber-100 text-amber-800',
  Expired:       'bg-red-100 text-red-700',
  Pending:       'bg-slate-100 text-slate-600',
  Cancelled:     'bg-slate-100 text-slate-500 line-through',
  Inactive:      'bg-slate-100 text-slate-400',
};

/** Process (last invoice/quote lifecycle) status pill config. */
const PROCESS_STATUS: Record<string, string> = {
  None:             'bg-slate-100 text-slate-400',
  Renewal_Quoted:   'bg-blue-100 text-blue-700',
  Renewal_Invoiced: 'bg-indigo-100 text-indigo-700',
  Renewal_Paid:     'bg-emerald-100 text-emerald-800',
  Prorata_Quoted:   'bg-blue-100 text-blue-700',
  Prorata_Invoiced: 'bg-indigo-100 text-indigo-700',
  Prorata_Paid:     'bg-emerald-100 text-emerald-800',
};

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function DomainStatusBadge({ status }: { status: string }) {
  const s = DOMAIN_STATUS[status] ?? { label: status, className: 'bg-slate-100 text-slate-600', icon: '' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${s.className}`}>
      {s.icon && <span aria-hidden>{s.icon}</span>}
      {s.label}
    </span>
  );
}

function SubStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${SUB_STATUS[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function ProcessStatusBadge({ status }: { status: string }) {
  if (!status || status === 'None') return <span className="text-slate-400">—</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PROCESS_STATUS[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/** Renders the Last Invoice/Quote cell as a Zoho Books deep link when an id exists. */
function LastDocLink({ sub, org }: { sub: LinkedSub; org: Domain['organization'] }) {
  if (sub.lastInvoiceNumber) {
    const href = sub.lastInvoiceId ? zohoBooksUrl(org, 'invoices', sub.lastInvoiceId) : null;
    return href ? (
      <a href={href} target="_blank" rel="noreferrer"
        className="font-mono text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5"
        title="Open invoice in Zoho Books">
        {sub.lastInvoiceNumber} <span aria-hidden>↗</span>
      </a>
    ) : (
      <span className="font-mono text-xs text-slate-600">{sub.lastInvoiceNumber}</span>
    );
  }
  if (sub.lastQuoteNumber) {
    const href = sub.lastQuoteId ? zohoBooksUrl(org, 'estimates', sub.lastQuoteId) : null;
    return href ? (
      <a href={href} target="_blank" rel="noreferrer"
        className="font-mono text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5"
        title="Open quote in Zoho Books">
        {sub.lastQuoteNumber} <span aria-hidden>↗</span>
      </a>
    ) : (
      <span className="font-mono text-xs text-slate-600">{sub.lastQuoteNumber}</span>
    );
  }
  return <span className="text-slate-400">—</span>;
}

export function DomainsTable({ domains }: { domains: Domain[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, startBulkDelete] = useTransition();

  const eligibleDomains = domains.filter(d => d.activeSubsCount === 0);
  const allEligibleSelected = eligibleDomains.length > 0 && eligibleDomains.every(d => selectedIds.has(d.id));

  const toggleAll = () => {
    if (allEligibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(eligibleDomains.map(d => d.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    if (confirm(`Kya aap sach mein in ${selectedIds.size} domains ko delete karna chahte hain?`)) {
      startBulkDelete(async () => {
        const res = await bulkDeleteDomainsAction(Array.from(selectedIds));
        if (res.error) alert(res.error);
        else setSelectedIds(new Set());
      });
    }
  };

  if (domains.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="text-center py-16 text-slate-400">
          <p className="font-medium">कोई domain नहीं मिला</p>
          <p className="text-sm mt-1">Lead convert होने पर domain automatically create होता है।</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {selectedIds.size > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
          <span className="text-red-700 font-medium text-sm">
            {selectedIds.size} domain(s) selected
          </span>
          <button
            onClick={handleBulkDelete}
            disabled={isBulkDeleting}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <Trash size={16} className={isBulkDeleting ? "animate-pulse" : ""} />
            {isBulkDeleting ? 'Deleting...' : 'Delete Selected'}
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-300 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-slate-100 text-slate-700 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 w-10 text-center">
                <input 
                  type="checkbox" 
                  className="rounded border-slate-300 cursor-pointer text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                  checked={allEligibleSelected}
                  onChange={toggleAll}
                  disabled={eligibleDomains.length === 0 || isBulkDeleting}
                />
              </th>
              <th className="text-left px-4 py-3 font-semibold">Domain</th>
              <th className="text-left px-4 py-3 font-semibold">Customer (Zoho)</th>
              <th className="text-left px-4 py-3 font-semibold">Org</th>
              <th className="text-center px-4 py-3 font-semibold">Active Subs</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {domains.map((d) => {
              const isOpen = expandedId === d.id;
              const isSelected = selectedIds.has(d.id);
              return (
                <Fragment key={d.id}>
                  <tr
                    onClick={() => setExpandedId(isOpen ? null : d.id)}
                    className={`cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : isOpen ? 'bg-blue-50/50' : 'hover:bg-slate-50'}`}
                  >
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <input 
                        type="checkbox" 
                        className="rounded border-slate-300 cursor-pointer text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                        checked={isSelected}
                        onChange={() => toggleOne(d.id)}
                        disabled={d.activeSubsCount > 0 || isBulkDeleting}
                        title={d.activeSubsCount > 0 ? "Cannot select domain with active subscriptions" : "Select domain"}
                      />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-start gap-2">
                        <span onClick={() => setExpandedId(isOpen ? null : d.id)} className={`mt-0.5 text-slate-400 transition-transform duration-200 cursor-pointer ${isOpen ? 'rotate-90 text-blue-600' : ''}`}>
                          ›
                        </span>
                        <span>
                          <span className="flex items-center gap-1.5">
                            <span onClick={() => setExpandedId(isOpen ? null : d.id)} className="font-semibold text-blue-700 font-mono text-xs cursor-pointer">{d.domainName}</span>
                            <HistoryDialog entityType="domain" entityId={d.id} title={`Domain History: ${d.domainName}`} />
                          </span>
                          <span className="block text-[11px] text-slate-500 mt-0.5">Added {fmt(d.createdAt)}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-700">{d.zohoCustomerName ?? '—'}</p>
                      {d.zohoCustomerId && (
                        <a
                          href={zohoBooksUrl(d.organization, 'contacts', d.zohoCustomerId)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5 mt-0.5"
                          title="Customer ko Zoho Books me kholo"
                        >
                          Open in Zoho Books <span aria-hidden>↗</span>
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{d.organization.name}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-block px-2 py-1 rounded bg-blue-200 text-blue-800 text-xs font-semibold">
                        {d.activeSubsCount}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <DomainStatusBadge status={d.status} />
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="bg-blue-50">
                      <td colSpan={6} className="p-0">
                        <div className="bg-white border-t border-blue-200 px-6 py-4">
                          <p className="text-xs font-semibold text-slate-700 mb-2">
                            Linked Subscriptions ({d.subscriptions.length})
                          </p>
                          {d.subscriptions.length === 0 ? (
                            <p className="text-sm text-slate-400 py-2">इस domain पर कोई subscription नहीं है।</p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs min-w-[640px]">
                                <thead className="text-slate-600 border-b border-slate-200">
                                  <tr className="text-left">
                                    <th className="py-1.5 pr-4 font-medium">Sub #</th>
                                    <th className="py-1.5 pr-4 font-medium">Item</th>
                                    <th className="py-1.5 pr-4 font-medium text-right">Qty</th>
                                    <th className="py-1.5 pr-4 font-medium">End Date</th>
                                    <th className="py-1.5 pr-4 font-medium">Status</th>
                                    <th className="py-1.5 pr-4 font-medium">Last Invoice/Quote</th>
                                    <th className="py-1.5 pr-4 font-medium">Last Doc Status</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-700">
                                  {d.subscriptions.map((s) => (
                                    <tr key={s.id} className="hover:bg-slate-50">
                                      <td className="py-2 pr-4">
                                        <Link
                                          href={`/dashboard/subscriptions/${s.id}`}
                                          className="font-mono text-xs text-blue-600 hover:underline"
                                          title="Subscription page kholo"
                                        >
                                          {s.subscriptionNumber}
                                        </Link>
                                      </td>
                                      <td className="py-2 pr-4">{s.zohoItemName ?? '—'}</td>
                                      <td className="py-2 pr-4 text-right">{Number(s.quantity)}</td>
                                      <td className="py-2 pr-4">{fmt(s.endDate)}</td>
                                      <td className="py-2 pr-4"><SubStatusBadge status={s.lifecycleStatus} /></td>
                                      <td className="py-2 pr-4"><LastDocLink sub={s} org={d.organization} /></td>
                                      <td className="py-2 pr-4"><ProcessStatusBadge status={s.processStatus} /></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  </div>
  );
}
