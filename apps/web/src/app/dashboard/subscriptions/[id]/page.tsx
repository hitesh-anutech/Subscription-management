import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { RenewalQuoteForm } from './_components/renewal-quote-form';
import { ProrataForm } from './_components/prorata-form';
import { StartSubscriptionModal } from './_components/start-subscription-modal';
import { EditSubscriptionButton } from './_components/edit-subscription-modal';
import { DeactivateSubscriptionButton } from './_components/deactivate-subscription-button';
import { getCurrentUser } from '@/lib/auth';
import { DeleteSubscriptionButton } from '../_components/delete-subscription-button';
import { HistoryDialog } from '@/components/history-dialog';
import { OrderHistoryTimeline } from './_components/order-history-timeline';

export const dynamic = 'force-dynamic';

const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', AUD: 'A$', CAD: 'C$', JPY: '¥',
};
/** Format an amount in its billing currency (falls back to the code for unknown currencies). */
function money(amount: number, currency = 'INR'): string {
  const code = (currency || 'INR').toUpperCase();
  const sym = CURRENCY_SYMBOL[code] ?? `${code} `;
  return `${sym}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

interface RenewalHistory {
  id: string;
  businessType: string;
  renewalStatus: string;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
  quantity: string | null;
  sellingPrice: string | null;
  subtotalAmount: string | null;
  currency: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  quoteDate: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  zohoEstimateStatus: string | null;
  zohoInvoiceStatus: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface Subscription {
  id: string;
  subscriptionNumber: string;
  zohoCustomerId: string;
  zohoCustomerName: string | null;
  zohoItemId: string;
  zohoItemName: string | null;
  quantity: string;
  subscriptionPrice: string;
  nextRenewalPrice: string | null;
  costPrice: string;
  currency: string;
  exchangeRate: string | null;
  billingCycle: string;
  startDate: string;
  endDate: string;
  nextRenewalDate: string | null;
  autoRenew: boolean;
  lifecycleStatus: string;
  processStatus: string;
  notes: string | null;
  lastQuoteNumber: string | null;
  lastInvoiceId: string | null;
  lastInvoiceNumber: string | null;
  organization: { id: string; name: string; zohoOrgId: string; dataCenter: string };
  domain: { id: string; domainName: string };
  originLead: { id: string; leadNumber: string; companyName: string } | null;
  originQuickQuote: { id: string; quoteNumber: string } | null;
  renewalHistory: RenewalHistory[];
}

/** Order-history timeline row — real history rows + a synthesized Fresh entry
 *  for subscriptions created before Fresh rows were written to renewal_history. */
type TimelineRow = RenewalHistory & { synthetic?: boolean };

const DC_TLD: Record<string, string> = { in: 'in', com: 'com', eu: 'eu', com_au: 'com.au', jp: 'jp', sa: 'sa' };

function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default async function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const currentUser = await getCurrentUser();
  const isAdmin = currentUser?.role === 'Admin';

  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let sub: Subscription;
  try {
    sub = await api.get<Subscription>(`/subscriptions/${id}`);
  } catch {
    notFound();
  }

  const canRenew = ['Active', 'Expiring_Soon', 'Expired'].includes(sub.lifecycleStatus);
  const canProrata = ['Active', 'Expiring_Soon'].includes(sub.lifecycleStatus);
  const daysLeft = Math.ceil((new Date(sub.endDate).getTime() - Date.now()) / 86_400_000);
  const renewalPrice = Number(sub.nextRenewalPrice ?? sub.subscriptionPrice);

  // Order History = renewal_history rows (newest first) + the ORIGINAL fresh order.
  // Older subscriptions have no 'Fresh' history row — synthesize one from the
  // subscription's own origin-quote/last-invoice linkage so the first sale shows.
  const timeline: TimelineRow[] = [...sub.renewalHistory];
  const hasFreshRow = sub.renewalHistory.some((h) => h.businessType === 'Fresh');
  // Don't synthesize if lastQuote/lastInvoice is already present in a real history row
  const lastQuoteCovered   = sub.lastQuoteNumber   && sub.renewalHistory.some((h) => h.quoteNumber   === sub.lastQuoteNumber);
  const lastInvoiceCovered = sub.lastInvoiceNumber && sub.renewalHistory.some((h) => h.invoiceNumber === sub.lastInvoiceNumber);
  const docsCovered = lastQuoteCovered || lastInvoiceCovered;
  if (!hasFreshRow && !docsCovered && (sub.originQuickQuote || sub.lastInvoiceNumber || sub.lastQuoteNumber)) {
    timeline.push({
      id: 'fresh-origin',
      synthetic: true,
      businessType: 'Fresh',
      renewalStatus: sub.lastInvoiceNumber ? 'Invoiced' : 'Quoted',
      serviceStartDate: sub.startDate,
      serviceEndDate: sub.endDate,
      quantity: sub.quantity,
      sellingPrice: sub.subscriptionPrice,
      subtotalAmount: String(Number(sub.quantity) * Number(sub.subscriptionPrice)),
      currency: sub.currency,
      quoteId: null,
      quoteNumber: sub.originQuickQuote?.quoteNumber ?? sub.lastQuoteNumber,
      quoteDate: null,
      invoiceId: sub.lastInvoiceId,
      invoiceNumber: sub.lastInvoiceNumber,
      invoiceDate: null,
      zohoEstimateStatus: null,
      zohoInvoiceStatus: null,
      sentAt: null,
      createdAt: sub.startDate,
    });
  }

  return (
    <div className="max-w-5xl space-y-5">
      {/* Header */}
      <div>
        <nav className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
          <Link href="/dashboard/subscriptions" className="hover:text-slate-600">Subscriptions</Link>
          <span>›</span>
          <span className="text-slate-600 font-mono">{sub.subscriptionNumber}</span>
        </nav>
        <div className="flex items-center gap-2">
          {sub.zohoCustomerId ? (
            <Link
              href={`/dashboard/customers/${sub.zohoCustomerId}?org_id=${sub.organization.id}`}
              className="text-2xl font-bold text-blue-700 hover:underline transition-colors"
              title="Customer page par jaao"
            >
              {sub.zohoCustomerName ?? sub.zohoItemName ?? 'Subscription'}
            </Link>
          ) : (
            <h1 className="text-2xl font-bold text-slate-900">
              {sub.zohoCustomerName ?? sub.zohoItemName ?? 'Subscription'}
            </h1>
          )}
          {sub.zohoCustomerId && (
            <a
              href={`https://books.zoho.${DC_TLD[sub.organization.dataCenter] ?? 'com'}/app/${sub.organization.zohoOrgId}#/contacts/${sub.zohoCustomerId}`}
              target="_blank"
              rel="noreferrer"
              title="Zoho Books mein customer kholein"
              aria-label="Open customer in Zoho Books"
              className="text-blue-500 hover:text-blue-700 transition-colors flex-shrink-0"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 3h6v6" />
                <path d="M10 14 21 3" />
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              </svg>
            </a>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
          <span>{sub.domain.domainName}</span>
          <span>·</span>
          <span>{sub.organization.name}</span>
          <span>·</span>
          <span className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition-all ${
            sub.lifecycleStatus === 'Active' ? 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm shadow-emerald-500/5' :
            sub.lifecycleStatus === 'Expiring_Soon' ? 'bg-amber-50 border-amber-200 text-amber-700 shadow-sm shadow-amber-500/5' :
            sub.lifecycleStatus === 'Expired' ? 'bg-red-50 border-red-200 text-red-700 shadow-sm shadow-red-500/5' :
            sub.lifecycleStatus === 'Cancelled' ? 'bg-red-100 border-red-300 text-red-800 font-extrabold shadow-sm shadow-red-500/10' :
            'bg-slate-50 border-slate-200 text-slate-600 shadow-sm'
          }`}>{sub.lifecycleStatus.replace('_', ' ')}</span>
          <HistoryDialog entityType="subscription" entityId={sub.id} title={`Subscription History: ${sub.subscriptionNumber}`} />
        </div>
      </div>

      {/* Expiry alert */}
      {daysLeft <= 30 && daysLeft >= 0 && (() => {
        const latestRenewalDoc = sub.renewalHistory.find(
          (h) => h.businessType === 'Renewal' && (h.quoteNumber || h.invoiceNumber),
        );
        const pill = (text: string) => (
          <strong className="bg-amber-100/80 border border-amber-300 px-2 py-0.5 rounded-lg text-amber-900 font-extrabold mx-0.5 shadow-sm font-mono">
            {text}
          </strong>
        );
        return (
          <div className="px-4 py-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-center gap-2 shadow-sm font-medium">
            <span>⚠️</span>
            <span>
              Subscription will expire in <strong className="bg-amber-100/80 border border-amber-300 px-2 py-0.5 rounded-lg text-amber-900 font-extrabold mx-0.5 shadow-sm">{daysLeft === 0 ? 'today' : `${daysLeft} days`}</strong> (on <strong className="bg-amber-100/80 border border-amber-300 px-2 py-0.5 rounded-lg text-amber-900 font-extrabold mx-0.5 shadow-sm">{fmt(sub.endDate)}</strong>){' '}
              {latestRenewalDoc
                ? latestRenewalDoc.invoiceNumber
                  ? <>— Invoice {pill(latestRenewalDoc.invoiceNumber)} is generated on {pill(fmt(latestRenewalDoc.invoiceDate ?? latestRenewalDoc.createdAt))}.</>
                  : <>— Quote {pill(latestRenewalDoc.quoteNumber!)} is generated on {pill(fmt(latestRenewalDoc.quoteDate ?? latestRenewalDoc.createdAt))}.</>
                : '— please generate a renewal quote.'
              }
            </span>
          </div>
        );
      })()}
      {daysLeft < 0 && (
        <div className="px-4 py-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2 shadow-sm">
          <span>❌</span>
          <span>
            Subscription expired on <strong className="bg-red-100/70 border border-red-300/60 px-1.5 py-0.5 rounded text-red-900 font-bold">{fmt(sub.endDate)}</strong> ({Math.abs(daysLeft)} days ago).
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-5">
        {/* Left column */}
        <div className="col-span-2 space-y-5">
          {/* Details card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Subscription Details</h2>
              <div className="flex items-center gap-2">
                <EditSubscriptionButton
                  subscriptionId={sub.id}
                  itemName={sub.zohoItemName ?? sub.zohoItemId}
                  quantity={Number(sub.quantity)}
                  currency={sub.currency || 'INR'}
                  exchangeRate={sub.exchangeRate ? Number(sub.exchangeRate) : 1}
                  billingCycle={sub.billingCycle}
                  price={Number(sub.subscriptionPrice)}
                  nextRenewalPrice={sub.nextRenewalPrice ? Number(sub.nextRenewalPrice) : null}
                  startDate={sub.startDate}
                  endDate={sub.endDate}
                  autoRenew={sub.autoRenew}
                  lastQuoteNumber={sub.lastQuoteNumber ?? null}
                  lastInvoiceNumber={sub.lastInvoiceNumber ?? null}
                />
                <DeactivateSubscriptionButton subscriptionId={sub.id} currentStatus={sub.lifecycleStatus} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 text-sm">
              {/* Customer — rendered separately to include Zoho Books deep-link */}
              <div>
                <p className="text-xs text-slate-400">Customer</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="text-slate-800 font-medium">{sub.zohoCustomerName ?? sub.zohoCustomerId}</p>
                  {sub.zohoCustomerId && (
                    <a
                      href={`https://books.zoho.${DC_TLD[sub.organization.dataCenter] ?? 'com'}/app/${sub.organization.zohoOrgId}#/contacts/${sub.zohoCustomerId}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Zoho Books mein customer kholein"
                      aria-label="Open customer in Zoho Books"
                      className="text-blue-500 hover:text-blue-700 transition-colors flex-shrink-0"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M15 3h6v6" />
                        <path d="M10 14 21 3" />
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      </svg>
                    </a>
                  )}
                </div>
              </div>
              {[
                ['Item', sub.zohoItemName ?? sub.zohoItemId],
                ['Quantity', sub.quantity],
                ['Billing Cycle', sub.billingCycle],
                ['Price', money(Number(sub.subscriptionPrice), sub.currency)],
                ['Renewal Price', sub.nextRenewalPrice ? money(Number(sub.nextRenewalPrice), sub.currency) : '(same)'],
                ['Cost (base)', `₹${Number(sub.costPrice).toLocaleString('en-IN')}`],
                ['Start Date', fmt(sub.startDate)],
                ['End Date', fmt(sub.endDate)],
                ['Last Quote', sub.lastQuoteNumber ?? '—'],
                ['Last Invoice', sub.lastInvoiceNumber ?? '—'],
                ['Auto Renew', sub.autoRenew ? 'Yes' : 'No'],
                ['Process Status', sub.processStatus.replace(/_/g, ' ')],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="text-slate-800 font-medium mt-0.5">{value}</p>
                </div>
              ))}
            </div>
            {sub.notes && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-400 mb-1">Notes</p>
                <p className="text-sm text-slate-600">{sub.notes}</p>
              </div>
            )}
          </div>

          {/* Order History Timeline — fresh sale + renewals + pro-rata */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-700">📜 Order History</h2>
              <span className="text-xs text-slate-400">Fresh sale + renewals — Quote → Invoice → Status (synced from Zoho Books)</span>
            </div>
            <OrderHistoryTimeline
              timeline={timeline}
              org={sub.organization}
              currency={sub.currency}
              zohoItemName={sub.zohoItemName}
              domainName={sub.domain.domainName}
              originQuickQuote={sub.originQuickQuote}
            />
          </div>
        </div>

        {/* Actions sidebar */}
        <div className="space-y-4">
          {sub.lifecycleStatus === 'Pending' && (
            <StartSubscriptionModal
              subscriptionId={sub.id}
              billingCycle={sub.billingCycle}
              customerName={sub.zohoCustomerName}
              itemName={sub.zohoItemName}
            />
          )}

          {canRenew && (
            <div className="bg-white border border-emerald-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-emerald-800 mb-3">🔄 Renewal Quote</h3>
              <RenewalQuoteForm
                subscriptionId={sub.id}
                currentPrice={renewalPrice}
                currentQuantity={Number(sub.quantity)}
                currentEndDate={sub.endDate}
                billingCycle={sub.billingCycle}
              />
            </div>
          )}

          {canProrata && (
            <div className="bg-white border border-indigo-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-indigo-800 mb-3">📐 Pro-rata Quote</h3>
              <ProrataForm
                subscriptionId={sub.id}
                subscriptionPrice={Number(sub.subscriptionPrice)}
                endDate={sub.endDate}
                billingCycle={sub.billingCycle}
              />
            </div>
          )}

          {sub.originLead && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm">
              <p className="text-xs text-slate-500 mb-1">Origin Lead</p>
              <Link
                href={`/dashboard/leads/${sub.originLead.id}`}
                className="text-blue-600 hover:underline font-medium"
              >
                {sub.originLead.companyName}
              </Link>
              <p className="text-xs text-slate-400 font-mono mt-0.5">{sub.originLead.leadNumber}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
