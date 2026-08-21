import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { QuoteActionBar } from '../_components/quote-action-bar';
import { ConvertedInvoiceActions, type PostConvert } from '../_components/converted-invoice-actions';
import { getCurrentUser } from '@/lib/auth';
import { DeleteQuoteButton } from '../_components/delete-quote-button';
import { HistoryDialog } from '@/components/history-dialog';

export const dynamic = 'force-dynamic';

interface QuoteItem {
  id: string;
  lineOrder: number;
  itemName: string;
  itemDescription: string | null;
  hsnOrSac: string | null;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  discountAmount: string;
  taxRate: string;
  lineSubtotal: string;
  lineTax: string;
  lineTotal: string;
  isSubscription: boolean;
  billingCycle: string | null;
  primaryDomain: string | null;
  domainList: Array<{ domain: string; qty?: number }> | null;
}

interface Quote {
  id: string;
  quoteNumber: string;
  customerType: string;
  status: string;
  quoteDate: string;
  expiryDate: string;
  validityDays: number;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  isIntraState: boolean | null;
  publicToken: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  termsAndConditions: string | null;
  notesToCustomer: string | null;
  internalNotes: string | null;
  items: QuoteItem[];
  lead: { id: string; companyName: string; contactName: string | null; email: string; gstin: string | null; convertedToZohoCustomerId: string | null } | null;
  zohoCustomerId: string | null;
  zohoCustomerName: string | null;
  targetOrganization: { id: string; name: string };
  createdBy: { name: string; email: string } | null;
}

const statusColors: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-600',
  Sent: 'bg-blue-100 text-blue-700',
  Viewed: 'bg-purple-100 text-purple-700',
  Accepted: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  Expired: 'bg-orange-100 text-orange-700',
};

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const currentUser = await getCurrentUser();
  const isAdmin = currentUser?.role === 'Admin';

  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let quote: Quote;
  try {
    quote = await api.get<Quote>(`/quick-quotes/${id}`);
  } catch {
    notFound();
  }

  const customerName = quote.customerType === 'lead'
    ? quote.lead?.companyName
    : quote.zohoCustomerName;

  const publicUrl = quote.publicToken
    ? `${process.env.NEXT_PUBLIC_WEB_BASE_URL ?? 'http://localhost:3000'}/quotes/public/${quote.publicToken}`
    : null;

  // Once converted (Pushed_To_Zoho) the live document is the Zoho Invoice — fetch its
  // info to show "Invoice mode" (number/status + Create-Subscription / Email / Refresh actions).
  const isConverted = quote.status === 'Pushed_To_Zoho';
  let postConvert: PostConvert | null = null;
  if (isConverted) {
    try {
      postConvert = await api.get<PostConvert>(`/conversions/quote/${id}/post-convert`);
    } catch { /* fall back to plain view */ }
  }
  const invStatusColors: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-600', sent: 'bg-blue-100 text-blue-700',
    paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700', void: 'bg-slate-100 text-slate-400',
  };

  return (
    <div className="max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/dashboard/quick-quotes" className="text-slate-400 hover:text-slate-600 text-sm">← Quotes</Link>
            <span className="text-slate-300">/</span>
            <span className="font-mono text-sm text-slate-500">{quote.quoteNumber}</span>
          </div>
          {quote.customerType === 'lead' && quote.lead ? (
            <Link href={`/dashboard/leads/${quote.lead.id}`} className="text-2xl font-bold text-slate-900 hover:text-blue-700 hover:underline transition-colors">
              {customerName ?? 'Quote'}
            </Link>
          ) : quote.customerType === 'existing' && quote.zohoCustomerId ? (
            <Link href={`/dashboard/customers/${quote.zohoCustomerId}?org_id=${quote.targetOrganization.id}`} className="text-2xl font-bold text-blue-700 hover:underline transition-colors" title="Customer page par jaao">
              {customerName ?? 'Quote'}
            </Link>
          ) : (
            <h1 className="text-2xl font-bold text-slate-900">{customerName ?? 'Quote'}</h1>
          )}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {isConverted && postConvert ? (
              <>
                {postConvert.zohoInvoiceUrl ? (
                  <a
                    href={postConvert.zohoInvoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-blue-700 hover:underline"
                    title="Zoho Books me kholo"
                  >
                    🧾 Invoice {postConvert.invoice.number} ↗
                  </a>
                ) : (
                  <span className="text-sm font-semibold text-slate-700">🧾 Invoice {postConvert.invoice.number}</span>
                )}
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${invStatusColors[postConvert.invoice.status.toLowerCase()] ?? 'bg-slate-100 text-slate-600'}`}>
                  {postConvert.invoice.status}
                </span>
              </>
            ) : (
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[quote.status] ?? 'bg-slate-100 text-slate-600'}`}>
                {quote.status.replace('_', ' ')}
              </span>
            )}
            <HistoryDialog entityType="quote" entityId={quote.id} title={`Quote History: ${quote.quoteNumber}`} />
            <span className="text-sm text-slate-500">{quote.targetOrganization.name}</span>
          </div>
        </div>
        {isConverted && postConvert ? (
          <ConvertedInvoiceActions quoteId={id} info={postConvert} />
        ) : (
          <QuoteActionBar
              quoteId={id}
              status={quote.status}
              publicUrl={publicUrl}
              leadEmail={quote.lead?.email ?? null}
              convert={
                // Lead already converted (customer exists in Zoho) → invoice-only path,
                // never "Convert to Customer" (that would duplicate the Zoho contact).
                quote.status === 'Accepted' && quote.customerType === 'lead' && quote.lead?.id && !quote.lead.convertedToZohoCustomerId
                  ? { mode: 'lead' as const, leadId: quote.lead.id, organizationId: quote.targetOrganization.id, hasSubscriptionItems: quote.items?.some((i) => i.isSubscription) ?? false }
                  : quote.status === 'Accepted' && (quote.zohoCustomerId || quote.lead?.convertedToZohoCustomerId)
                    ? { mode: 'existing' as const, organizationId: quote.targetOrganization.id, hasSubscriptionItems: quote.items?.some((i) => i.isSubscription) ?? false }
                    : null
              }
            />
          )}
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Quote info */}
        <div className="col-span-2 space-y-4">
          {/* Items table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <span className="font-semibold text-sm text-slate-700">Items</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">#</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">Item</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">Qty</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">Price</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">Disc%</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">Tax%</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {quote.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-2 text-slate-400 text-xs">{item.lineOrder}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">{item.itemName}</div>
                      {item.hsnOrSac && <div className="text-xs text-slate-400">HSN: {item.hsnOrSac}</div>}
                      {item.isSubscription && item.billingCycle && (
                        <div className="text-xs text-blue-600">
                          {item.billingCycle}
                          {(item.domainList?.length ?? 0) > 1
                            ? ` · 🌐 ${item.domainList!.length} domains`
                            : item.primaryDomain ? ` · ${item.primaryDomain}` : ''}
                        </div>
                      )}
                      {/* Bulk-domains line: compact expandable list */}
                      {(item.domainList?.length ?? 0) > 1 && (
                        <details className="mt-1">
                          <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
                            {item.domainList!.slice(0, 2).map((d) => d.domain).join(', ')} +{item.domainList!.length - 2 > 0 ? `${item.domainList!.length - 2} more` : ''}
                          </summary>
                          <div className="mt-1 max-h-40 overflow-y-auto text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-2 columns-2">
                            {item.domainList!.map((d, i) => (
                              <div key={i}>{d.domain}{d.qty && d.qty !== 1 ? ` (${d.qty})` : ''}</div>
                            ))}
                          </div>
                        </details>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600">{Number(item.quantity)}</td>
                    <td className="px-4 py-2 text-right text-slate-600">₹{Number(item.unitPrice).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{Number(item.discountPercent)}%</td>
                    <td className="px-4 py-2 text-right text-slate-500">{Number(item.taxRate)}%</td>
                    <td className="px-4 py-2 text-right font-medium text-slate-700">₹{Number(item.lineTotal).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
              <div className="w-56 space-y-1 text-sm">
                <div className="flex justify-between text-slate-500">
                  <span>Subtotal</span><span>₹{Number(quote.subtotal).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Discount</span><span>-₹{Number(quote.discountAmount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Tax</span><span>₹{Number(quote.taxAmount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-800 text-base pt-1 border-t border-slate-200">
                  <span>Total</span><span>₹{Number(quote.totalAmount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          {(quote.notesToCustomer || quote.termsAndConditions) && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-sm">
              {quote.notesToCustomer && (
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-1">Notes to Customer</div>
                  <div className="text-slate-700 whitespace-pre-wrap">{quote.notesToCustomer}</div>
                </div>
              )}
              {quote.termsAndConditions && (
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-1">Terms & Conditions</div>
                  <div className="text-slate-600 whitespace-pre-wrap text-xs">{quote.termsAndConditions}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 text-sm">
            <div className="font-semibold text-slate-700 mb-2">Details</div>
            <div className="flex justify-between"><span className="text-slate-500">Date</span><span>{new Date(quote.quoteDate).toLocaleDateString('en-IN')}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Expiry</span><span>{new Date(quote.expiryDate).toLocaleDateString('en-IN')}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Validity</span><span>{quote.validityDays} days</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Type</span><span>{quote.isIntraState ? 'Intra-state' : 'Inter-state'}</span></div>
            {quote.sentAt && <div className="flex justify-between"><span className="text-slate-500">Sent</span><span>{new Date(quote.sentAt).toLocaleDateString('en-IN')}</span></div>}
            {quote.acceptedAt && <div className="flex justify-between text-green-600"><span>Accepted</span><span>{new Date(quote.acceptedAt).toLocaleDateString('en-IN')}</span></div>}
          </div>

          {quote.lead && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 text-sm">
              <div className="font-semibold text-slate-700 mb-2">Lead</div>
              <div className="font-medium text-slate-800">{quote.lead.companyName}</div>
              <div className="text-slate-500 text-xs">{quote.lead.email}</div>
              {quote.lead.gstin && <div className="font-mono text-xs text-slate-400 mt-1">{quote.lead.gstin}</div>}
              <Link href={`/dashboard/leads/${quote.lead.id}`} className="text-blue-600 hover:underline text-xs mt-2 block">
                View Lead →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Footer action bar — same actions as the top */}
      <div className="border-t border-slate-200 pt-4">
        {isConverted && postConvert ? (
          <ConvertedInvoiceActions quoteId={id} info={postConvert} />
        ) : (
          <QuoteActionBar
            quoteId={id}
            status={quote.status}
            publicUrl={publicUrl}
            leadEmail={quote.lead?.email ?? null}
            convert={
              // Lead already converted (customer exists in Zoho) → invoice-only path,
              // never "Convert to Customer" (that would duplicate the Zoho contact).
              quote.status === 'Accepted' && quote.customerType === 'lead' && quote.lead?.id && !quote.lead.convertedToZohoCustomerId
                ? { mode: 'lead' as const, leadId: quote.lead.id, organizationId: quote.targetOrganization.id, hasSubscriptionItems: quote.items?.some((i) => i.isSubscription) ?? false }
                : quote.status === 'Accepted' && (quote.zohoCustomerId || quote.lead?.convertedToZohoCustomerId)
                  ? { mode: 'existing' as const, organizationId: quote.targetOrganization.id, hasSubscriptionItems: quote.items?.some((i) => i.isSubscription) ?? false }
                  : null
            }
          />
        )}
      </div>
    </div>
  );
}
