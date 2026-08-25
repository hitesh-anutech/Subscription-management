import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { SyncCustomerButton } from './_components/sync-customer-button';
import CustomerSubscriptions from './_components/customer-subscriptions';
import ZohoDocsPanel from './_components/zoho-docs-panel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Customer' };

// ---------- Types ----------
interface ZohoAddress { address?: string; street?: string; city?: string; state?: string; zip?: string; country?: string }
interface ContactPerson {
  first_name?: string; last_name?: string; salutation?: string;
  email?: string; mobile?: string; is_primary_contact?: boolean;
}
interface CustomerExtra {
  billing_address?: ZohoAddress;
  contact_persons?: ContactPerson[];
  cf_support_status?: string;
  place_of_contact?: string;
  contact_number?: string;
  portal_status?: string;
  portal_status_formatted?: string;
  currency_code?: string;
  country?: string;
}
interface CacheCustomer {
  zohoId: string; displayName: string | null; email: string | null;
  phone: string | null; gstin: string | null; extra: CustomerExtra | null;
}
interface Sub {
  id: string; subscriptionNumber: string; lifecycleStatus: string; processStatus: string;
  zohoItemName: string | null; quantity: string; subscriptionPrice: string;
  billingCycle: string; startDate: string; endDate: string;
  lastInvoiceNumber: string | null; lastInvoiceDate: string | null;
  domain: { id: string; domainName: string } | null;
}
interface Dom { id: string; domainName: string; createdAt: string }
interface Quote {
  id: string; quoteNumber: string; status: string; totalAmount: string; quoteDate: string;
  zohoEstimateId: string | null; zohoEstimateNumber: string | null; // pushed quote's Zoho invoice
  pushedToZohoAt: string | null; // doubles as the invoice date
}
interface RecentInvoice { invoiceNumber: string | null; invoiceDate: string | null; domain: string | null; amount: string; subscriptionId: string; subCount?: number }
interface RecentDocument {
  quoteId: string | null; quoteNumber: string | null; quoteDate: string | null;
  invoiceId: string | null; invoiceNumber: string | null; invoiceDate: string | null;
  domain: string | null;
}
interface AtAGlance { activeSubs: number; domainsMapped: number }
interface Detail {
  customer: CacheCustomer | null; subscriptions: Sub[]; domains: Dom[];
  quotes: Quote[]; recentInvoices: RecentInvoice[];
  recentDocuments: RecentDocument[];
  domainSubCounts: Record<string, number>; atAGlance: AtAGlance;
}

// ---------- Helpers ----------
const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const inr = (n: string | number) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const QUOTE_STATUS: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-500',
  Sent: 'bg-blue-100 text-blue-600',
  Accepted: 'bg-emerald-100 text-emerald-700',
  Declined: 'bg-red-100 text-red-600',
  Pushed_to_Zoho: 'bg-violet-100 text-violet-700',
  Expired: 'bg-orange-100 text-orange-600',
};



export default async function CustomerDetailPage({
  params, searchParams,
}: {
  params: Promise<{ zohoId: string }>;
  searchParams: Promise<{ org_id?: string }>;
}) {
  const { zohoId } = await params;
  const { org_id: orgId } = await searchParams;
  if (!orgId) notFound();

  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  interface Org { id: string; name: string; zohoOrgId: string; dataCenter: string }

  let detail: Detail;
  let org: Org | null = null;
  try {
    const [detailRes, orgsRes] = await Promise.allSettled([
      api.get<Detail>(`/organizations/${orgId}/customers/${zohoId}`),
      api.get<{ organizations: Org[] }>('/organizations'),
    ]);
    if (detailRes.status === 'rejected') notFound();
    detail = (detailRes as PromiseFulfilledResult<Detail>).value;
    if (orgsRes.status === 'fulfilled') {
      org = orgsRes.value.organizations.find(o => o.id === orgId) ?? null;
    }
  } catch {
    notFound();
  }

  const orgName = org?.name ?? 'Zoho';
  const DC_TLD: Record<string, string> = { in: 'in', com: 'com', eu: 'eu', com_au: 'com.au', jp: 'jp', sa: 'sa' };
  const zohoContactUrl = org
    ? `https://books.zoho.${DC_TLD[org.dataCenter] ?? 'com'}/app/${org.zohoOrgId}#/contacts/${zohoId}`
    : `https://books.zoho.in/app#/contacts/${zohoId}`;

  const { customer, subscriptions, domains, quotes, recentInvoices, recentDocuments = [], domainSubCounts, atAGlance } = detail!;
  const name = customer?.displayName || zohoId;
  const extra = (customer?.extra ?? {}) as CustomerExtra;

  // Primary contact person (falls back to the first listed person)
  const contactPerson = extra?.contact_persons?.find(p => p.is_primary_contact) ?? extra?.contact_persons?.[0];
  const contactName = contactPerson
    ? [contactPerson.salutation, contactPerson.first_name, contactPerson.last_name].filter(Boolean).join(' ').trim()
    : null;

  // Phone: cache phone → primary contact mobile
  const phone = customer?.phone || contactPerson?.mobile || null;
  const customerNumber = extra?.contact_number || null;

  // Zoho portal status (enabled / disabled)
  const portalStatusRaw = (extra?.portal_status ?? '').toLowerCase();
  const portalStatusLabel = extra?.portal_status_formatted
    || (portalStatusRaw ? portalStatusRaw.charAt(0).toUpperCase() + portalStatusRaw.slice(1) : null);
  const portalEnabled = portalStatusRaw === 'enabled';

  // Billing address incl. country
  const billingAddr = extra?.billing_address;
  const billingAddrStr = billingAddr
    ? [billingAddr.address ?? billingAddr.street, billingAddr.city, billingAddr.state, billingAddr.zip, billingAddr.country]
        .filter(Boolean).join(', ')
    : null;

  const supportStatus = extra?.cf_support_status || null;

  // Billing currency + country (from the live Zoho contact) — for foreign-client billing.
  const currencyCode = extra?.currency_code || null;
  const country = billingAddr?.country || extra?.country || null;

  // Order History — quotes + invoices merged into one list, newest first.
  // A pushed quote carries its resulting invoice on the SAME row (Quote → Invoice
  // linking); standalone invoice rows appear only when no quote references them.
  // refId: Quote → internal quick-quote id; Invoice → its subscription id.
  interface OrderRow {
    key: string; kind: 'Quote' | 'Invoice'; refId: string;
    quoteNumber: string | null; quoteDate: string | null;
    invoiceNumber: string | null; invoiceDate: string | null;
    zohoInvoiceId: string | null; // deep-link to the invoice in Zoho Books
    domain: string | null; status: string | null; amount: string;
  }
  const quoteInvoiceNumbers = new Set(quotes.map((q) => q.zohoEstimateNumber).filter(Boolean));
  const orderHistory: OrderRow[] = [
    ...quotes.map((q): OrderRow => ({
      key: `q-${q.id}`, kind: 'Quote', refId: q.id,
      quoteNumber: q.quoteNumber, quoteDate: q.quoteDate,
      invoiceNumber: q.zohoEstimateNumber, invoiceDate: q.pushedToZohoAt,
      zohoInvoiceId: q.zohoEstimateId,
      domain: null, status: q.status, amount: q.totalAmount,
    })),
    ...recentInvoices
      .filter((inv) => !quoteInvoiceNumbers.has(inv.invoiceNumber)) // already on a quote row
      .map((inv, i): OrderRow => ({
        key: `i-${i}`, kind: 'Invoice', refId: inv.subscriptionId,
        quoteNumber: null, quoteDate: null,
        invoiceNumber: inv.invoiceNumber ?? '—', invoiceDate: inv.invoiceDate,
        zohoInvoiceId: null,
        domain: inv.domain, status: null, amount: inv.amount,
      })),
  ].sort((a, b) =>
    new Date(b.quoteDate ?? b.invoiceDate ?? 0).getTime() - new Date(a.quoteDate ?? a.invoiceDate ?? 0).getTime());

  return (
    <div className="max-w-5xl space-y-5 pb-10">

      {/* ── Header ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">ORG: {orgName}</p>
            <h1 className="text-2xl font-bold text-slate-900 leading-tight flex items-center gap-2 flex-wrap">
              {name}
              <a
                href={zohoContactUrl}
                target="_blank"
                rel="noreferrer"
                title="Open in Zoho Books"
                aria-label="Open in Zoho Books"
                className="text-blue-500 hover:text-blue-700 transition-colors"
              >
                {/* external-link icon */}
                <svg className="w-4 h-4 inline-block align-middle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M15 3h6v6" />
                  <path d="M10 14 21 3" />
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                </svg>
              </a>
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-sm text-slate-500">
              {customer?.email && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-blue-500" aria-hidden>✉️</span>{customer.email}
                </span>
              )}
              {phone && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-rose-500" aria-hidden>📞</span>{phone}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">Zoho ID: {zohoId}</span>
              {customerNumber && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">Zoho Customer Number: {customerNumber}</span>
              )}
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium border border-emerald-200">✓ Active customer</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard/quick-quotes/new?customer_id=${zohoId}&org_id=${orgId}`}
                className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/10 active:scale-[0.98] transition-all"
              >
                + New Quote
              </Link>
              <SyncCustomerButton orgId={orgId} zohoId={zohoId} />
            </div>
            {supportStatus && (
              <span className="text-xs px-2.5 py-1 rounded-lg bg-rose-100 text-rose-700 font-medium border border-rose-200">
                {supportStatus}
              </span>
            )}
            <Link href={`/dashboard/customers?org_id=${orgId}`} className="text-xs text-slate-400 hover:text-slate-600">← Customers</Link>
          </div>
        </div>
      </div>

      {/* ── Customer Profile + At a Glance ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">📋 Customer Profile</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Contact Person</p>
              <p className="text-slate-800 font-medium">{contactName || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">GSTIN</p>
              <p className="font-mono text-slate-800">{customer?.gstin || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Portal Status</p>
              <p className={portalStatusLabel ? (portalEnabled ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium') : 'text-slate-400'}>
                {portalStatusLabel ? `${portalEnabled ? '✓' : '✗'} ${portalStatusLabel}` : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">State (Place of Supply)</p>
              <p className="text-slate-800">{extra?.place_of_contact || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Currency</p>
              <p className="text-slate-800">
                {currencyCode
                  ? <span className={currencyCode !== 'INR' ? 'font-semibold text-indigo-700' : 'font-medium'}>{currencyCode}</span>
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Country</p>
              <p className="text-slate-800">{country || '—'}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-slate-400 mb-0.5">Billing Address</p>
              <p className="text-slate-700">{billingAddrStr || '—'}</p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">📊 At a Glance</h2>
          {/* Quick stats */}
          <div className="flex gap-6 text-sm mb-4">
            <div>
              <p className="text-xs text-slate-400">Active Subs</p>
              <p className="font-bold text-emerald-600 text-lg leading-tight">{atAGlance.activeSubs}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Domains</p>
              <p className="font-semibold text-slate-800 text-lg leading-tight">{atAGlance.domainsMapped}</p>
            </div>
          </div>
          {/* Recent Quote + Invoice pairs */}
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Recent Documents</p>
          {recentDocuments.length === 0 ? (
            <p className="text-xs text-slate-400">कोई recent document नहीं।</p>
          ) : (
            <div className="space-y-2">
              {recentDocuments.map((doc, i) => (
                <div key={i} className="border border-slate-100 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors">
                  {/* Quote row */}
                  {doc.quoteNumber && (
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-400 shrink-0">📃 Quote</span>
                      <span className="font-mono text-slate-700 truncate">{doc.quoteNumber}</span>
                      <span className="text-slate-400 shrink-0">{fmt(doc.quoteDate)}</span>
                      <a
                        href={`/dashboard/subscriptions/import?org_id=${encodeURIComponent(orgId)}&ref_number=${encodeURIComponent(doc.quoteNumber)}&doc_source=estimates`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-[10px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100 whitespace-nowrap"
                        title="Import from Zoho"
                      >
                        ↑ Import
                      </a>
                    </div>
                  )}
                  {/* Invoice row */}
                  {doc.invoiceNumber && (
                    <div className={`flex items-center justify-between gap-2 text-xs ${doc.quoteNumber ? 'mt-1 pt-1 border-t border-slate-100' : ''}`}>
                      <span className="text-slate-400 shrink-0">🧾 Invoice</span>
                      <span className="font-mono text-slate-700 truncate">{doc.invoiceNumber}</span>
                      <span className="text-slate-400 shrink-0">{fmt(doc.invoiceDate)}</span>
                      <a
                        href={`/dashboard/subscriptions/import?org_id=${encodeURIComponent(orgId)}&ref_number=${encodeURIComponent(doc.invoiceNumber)}&doc_source=invoices`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 whitespace-nowrap"
                        title="Import from Zoho"
                      >
                        ↑ Import
                      </a>
                    </div>
                  )}
                  {doc.domain && (
                    <p className="text-[10px] text-slate-400 mt-1 truncate">{doc.domain}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Active Subscriptions Table (with New Subscription + Combined Quote) ── */}
      <CustomerSubscriptions
        orgId={orgId}
        customerId={zohoId}
        customerName={name}
        subscriptions={subscriptions}
      />

      {/* ── Mapped Domains (collapsible — native <details>, no JS needed) ── */}
      <details className="bg-white border border-slate-200 rounded-xl overflow-hidden group">
        <summary className="px-5 py-3.5 flex items-center justify-between cursor-pointer select-none hover:bg-slate-50 list-none [&::-webkit-details-marker]:hidden">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <span className="text-slate-400 text-xs transition-transform group-open:rotate-90">▶</span>
            🌐 Mapped Domains ({domains.length})
          </h2>
          <Link href={`/dashboard/domains?org_id=${orgId}`} className="text-xs text-blue-600 hover:underline">Open Domain Mapping →</Link>
        </summary>
        <div className="border-t border-slate-100">
          {domains.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-400">कोई domain नहीं।</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {domains.map((d) => {
                const count = domainSubCounts[d.domainName] ?? 0;
                return (
                  <div key={d.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50">
                    <div>
                      <p className="text-sm font-medium text-blue-700">{d.domainName}</p>
                      <p className="text-xs text-slate-400 mt-0.5">Active · {count} subscription{count !== 1 ? 's' : ''}</p>
                    </div>
                    <Link
                      href={`/dashboard/subscriptions?search=${encodeURIComponent(d.domainName)}&org_id=${orgId}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      View subs
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </details>

      {/* ── Zoho Documents sync panel ── */}
      <ZohoDocsPanel
        orgId={orgId}
        zohoCustomerId={zohoId}
        subs={subscriptions.map(s => ({
          id: s.id,
          subscriptionNumber: s.subscriptionNumber,
          zohoItemName: s.zohoItemName,
          domain: s.domain,
        }))}
      />

      {/* ── Order History (quotes + invoices, newest first) ── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-700">📜 Order History</h2>
          <span className="text-xs text-slate-400">Quotes + Invoices — newest first</span>
        </div>
        {orderHistory.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-400">अभी तक कोई order history नहीं।</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Type</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Quote</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Invoice</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Domain</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-center">Status</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orderHistory.map((row) => (
                  <tr key={row.key} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {row.kind === 'Quote' ? '📃 Quote' : '🧾 Invoice'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.kind === 'Quote' ? (
                        <>
                          <Link href={`/dashboard/quick-quotes/${row.refId}`}
                            className="text-blue-600 hover:underline" title="Quote खोलें">
                            {row.quoteNumber}
                          </Link>
                          <p className="text-[11px] text-slate-400 font-sans mt-0.5">{fmt(row.quoteDate)}</p>
                        </>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.kind === 'Invoice' ? (
                        <>
                          <Link href={`/dashboard/subscriptions/${row.refId}`}
                            className="text-blue-600 hover:underline" title="Subscription खोलें">
                            {row.invoiceNumber}
                          </Link>
                          <p className="text-[11px] text-slate-400 font-sans mt-0.5">{fmt(row.invoiceDate)}</p>
                        </>
                      ) : row.invoiceNumber ? (
                        <>
                          {org && row.zohoInvoiceId ? (
                            <a
                              href={`https://books.zoho.${DC_TLD[org.dataCenter] ?? 'com'}/app/${org.zohoOrgId}#/invoices/${row.zohoInvoiceId}`}
                              target="_blank" rel="noopener noreferrer"
                              className="text-blue-600 hover:underline inline-flex items-center gap-0.5"
                              title="Zoho Books में invoice खोलें"
                            >
                              {row.invoiceNumber} <span aria-hidden>↗</span>
                            </a>
                          ) : (
                            <span className="text-slate-700">{row.invoiceNumber}</span>
                          )}
                          <p className="text-[11px] text-slate-400 font-sans mt-0.5">{fmt(row.invoiceDate)}</p>
                        </>
                      ) : (
                        <span className="text-slate-300">not invoiced</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-blue-600">{row.domain || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {row.status ? (
                        <span className={`inline-flex text-xs px-2 py-0.5 rounded font-medium ${QUOTE_STATUS[row.status] ?? 'bg-slate-100 text-slate-500'}`}>
                          {row.status.replace(/_/g, ' ')}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-700">{inr(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
