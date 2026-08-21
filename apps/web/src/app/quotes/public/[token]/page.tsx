import { notFound } from 'next/navigation';
import { QuoteDecision } from './_components/quote-decision';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

interface QuoteItem {
  id: string;
  lineOrder: number;
  itemName: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxRate: string;
  lineTotal: string;
  isSubscription: boolean;
  billingCycle: string | null;
  primaryDomain: string | null;
  domainList: Array<{ domain: string; qty?: number }> | null;
}

interface PublicQuote {
  id: string;
  quoteNumber: string;
  status: string;
  quoteDate: string;
  expiryDate: string;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  notesToCustomer: string | null;
  termsAndConditions: string | null;
  publicToken: string;
  items: QuoteItem[];
  lead: { companyName: string; contactName: string | null } | null;
  zohoCustomerName: string | null;
  targetOrganization: { name: string };
}

export default async function PublicQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const { token } = await params;
  const { action } = await searchParams;

  let quote: PublicQuote;
  try {
    const res = await fetch(`${API_BASE}/quick-quotes/public/${token}`, { cache: 'no-store' });
    if (!res.ok) notFound();
    quote = await res.json() as PublicQuote;
  } catch {
    notFound();
  }

  const isExpired = new Date(quote.expiryDate) < new Date();
  const isAccepted = quote.status === 'Accepted';
  const isRejected = quote.status === 'Rejected';
  const customerName = quote.lead?.companyName ?? quote.zohoCustomerName ?? 'Customer';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="font-bold text-slate-800">📦 ExcelTech Subscriptions</div>
          <div className="font-mono text-sm text-slate-500">{quote.quoteNumber}</div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
        {/* Status banners */}
        {isExpired && !isAccepted && (
          <div className="px-4 py-3 bg-orange-50 border border-orange-200 text-orange-700 rounded-lg text-sm font-medium">
            ⏰ यह quote expired हो गई है ({new Date(quote.expiryDate).toLocaleDateString('en-IN')})
          </div>
        )}
        {isAccepted && (
          <div className="px-4 py-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm font-medium">
            ✅ Quote accepted हो गई है। हम जल्द ही contact करेंगे।
          </div>
        )}
        {isRejected && (
          <div className="px-4 py-3 bg-slate-100 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium">
            यह quote decline कर दी गई है। दोबारा discuss करना हो तो हमसे contact करें।
          </div>
        )}

        {/* Quote header */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{customerName}</h1>
              <div className="text-sm text-slate-500">{quote.targetOrganization.name}</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-slate-900">₹{Number(quote.totalAmount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
              <div className="text-xs text-slate-400">Valid till {new Date(quote.expiryDate).toLocaleDateString('en-IN')}</div>
            </div>
          </div>

          {/* Items */}
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 text-xs font-medium text-slate-500">Item</th>
                <th className="text-right py-2 text-xs font-medium text-slate-500">Qty</th>
                <th className="text-right py-2 text-xs font-medium text-slate-500">Price</th>
                <th className="text-right py-2 text-xs font-medium text-slate-500">Tax</th>
                <th className="text-right py-2 text-xs font-medium text-slate-500">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quote.items.map((item) => (
                <tr key={item.id}>
                  <td className="py-2.5">
                    <div className="font-medium text-slate-800">{item.itemName}</div>
                    {item.isSubscription && item.billingCycle && (
                      <div className="text-xs text-blue-600">
                        {item.billingCycle}
                        {(item.domainList?.length ?? 0) > 1
                          ? ` · ${item.domainList!.length} domains`
                          : item.primaryDomain ? ` · ${item.primaryDomain}` : ''}
                      </div>
                    )}
                    {(item.domainList?.length ?? 0) > 1 && (
                      <div className="text-xs text-slate-400 mt-0.5">
                        {item.domainList!.slice(0, 3).map((d) => d.domain).join(', ')}
                        {item.domainList!.length > 3 ? ` +${item.domainList!.length - 3} more` : ''}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 text-right text-slate-600">{Number(item.quantity)}</td>
                  <td className="py-2.5 text-right text-slate-600">₹{Number(item.unitPrice).toLocaleString('en-IN')}</td>
                  <td className="py-2.5 text-right text-slate-500">{Number(item.taxRate)}%</td>
                  <td className="py-2.5 text-right font-medium text-slate-700">₹{Number(item.lineTotal).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-52 space-y-1 text-sm border-t border-slate-200 pt-2">
              <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>₹{Number(quote.subtotal).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between text-slate-500"><span>Discount</span><span>-₹{Number(quote.discountAmount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between text-slate-500"><span>Tax</span><span>₹{Number(quote.taxAmount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between font-bold text-slate-800 text-base pt-1 border-t border-slate-200"><span>Total</span><span>₹{Number(quote.totalAmount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
            </div>
          </div>
        </div>

        {/* Notes */}
        {quote.notesToCustomer && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 text-sm">
            <div className="font-semibold text-slate-700 mb-2">Notes</div>
            <div className="text-slate-600 whitespace-pre-wrap">{quote.notesToCustomer}</div>
          </div>
        )}

        {/* Accept / Decline */}
        {!isExpired && !isAccepted && !isRejected && (
          <QuoteDecision token={token} initialAction={action} />
        )}

        {/* Terms */}
        {quote.termsAndConditions && (
          <div className="text-xs text-slate-400 text-center px-4">{quote.termsAndConditions}</div>
        )}
      </div>
    </div>
  );
}
