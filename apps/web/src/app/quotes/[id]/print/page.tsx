import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { PrintButton } from './print-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quote PDF' };

interface QuoteItem {
  id: string;
  lineOrder: number;
  itemName: string;
  itemDescription: string | null;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxRate: string;
  lineTotal: string;
  billingCycle: string | null;
  primaryDomain: string | null;
  domainList: Array<{ domain: string; qty?: number }> | null;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
}
interface Quote {
  id: string;
  quoteNumber: string;
  status: string;
  quoteDate: string;
  expiryDate: string;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  termsAndConditions: string | null;
  notesToCustomer: string | null;
  items: QuoteItem[];
  customerType: 'lead' | 'existing';
  lead: { companyName: string; contactName: string | null; email: string; gstin: string | null; city: string | null; state: string | null } | null;
  zohoCustomerName: string | null;
  targetOrganizationId: string;
  targetOrganization: { name: string };
}

interface Branding {
  legalName?: string | null;
  displayName?: string | null;
  logoUrl?: string | null;
  brandColor?: string | null;
  signatureImageUrl?: string | null;
  pdfFooterText?: string | null;
  pdfWatermark?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  gstin?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  bankAccountHolder?: string | null;
  settingsOverrides?: Record<string, unknown> | null;
}

const inr = (n: string | number) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const CYCLE_LABELS: Record<string, string> = {
  monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half Yearly',
  annual: 'Yearly', biennial: 'Biennial', triennial: 'Triennial', one_time: 'One Time',
};

/** White or near-black — whichever is readable on the given hex background. */
function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 160 ? '#0f172a' : '#ffffff';
}

export default async function QuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let q: Quote;
  try {
    q = await api.get<Quote>(`/quick-quotes/${id}`);
  } catch {
    notFound();
  }

  // PDF Branding (logo / signature / footer) — best-effort; the sheet still
  // renders without it.
  let branding: Branding | null = null;
  try {
    const data = await api.get<{ settings: Branding | null }>(`/org-settings/${q.targetOrganizationId}`);
    branding = data.settings;
  } catch {
    // no branding configured
  }

  const customerName = q.customerType === 'lead' ? q.lead?.companyName : q.zohoCustomerName;
  const brand = branding?.brandColor?.trim() || '#1F2937';
  const onBrand = readableOn(brand);

  // Parse settingsOverrides — defaults to true for all show-* flags (opt-out model)
  const raw = (branding?.settingsOverrides ?? {}) as Record<string, unknown>;
  const ov = {
    logoSize:              (raw.logoSize as string)      ?? 'md',
    logoAlignment:         (raw.logoAlignment as string) ?? 'left',
    showCompanyName:       raw.showCompanyName       !== false,
    signatureSize:         (raw.signatureSize as string) ?? 'md',
    showSignatureSection:  raw.showSignatureSection  !== false,
    fontFamily:            (raw.fontFamily as string)    ?? 'sans',
    documentTitle:         (raw.documentTitle as string) || 'QUOTATION',
    dateFormat:            (raw.dateFormat as string)    ?? 'dd/mm/yyyy',
    showBillToGstin:       raw.showBillToGstin       !== false,
    showBillToEmail:       raw.showBillToEmail        !== false,
    showBillToLocation:    raw.showBillToLocation     !== false,
    showItemDescription:   raw.showItemDescription    !== false,
    showBillingMeta:       raw.showBillingMeta        !== false,
    showQtyColumn:         raw.showQtyColumn          !== false,
    showRateColumn:        raw.showRateColumn         !== false,
    showSubtotalRow:       raw.showSubtotalRow        !== false,
    showGstRow:            raw.showGstRow             !== false,
    showDiscountRow:       raw.showDiscountRow        !== false,
    showPayToSection:      raw.showPayToSection       !== false,
    showTermsSection:      raw.showTermsSection       !== false,
    showNotesSection:      raw.showNotesSection       !== false,
  };

  const fmtDate = (s: string) => {
    const dt = new Date(s);
    if (ov.dateFormat === 'dd-mmm-yyyy') {
      return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    return dt.toLocaleDateString('en-IN');
  };

  /** Formats "Subscription Validity" for the print page.
   *  Named cycle (not one_time) → "Monthly (28/07/2026 to 27/08/2026)"
   *  one_time / no cycle + dates → "30 days (28/07/2026 to 27/08/2026)"
   */
  const validityLabel = (cycle: string | null | undefined, start: string | null | undefined, end: string | null | undefined): string => {
    const dateRange = start && end ? `(${fmtDate(start)} to ${fmtDate(end)})` : '';
    if (cycle && cycle !== 'one_time') {
      const label = CYCLE_LABELS[cycle] ?? cycle;
      return dateRange ? `${label} ${dateRange}` : label;
    }
    if (start && end) {
      const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000);
      return `${days} days${dateRange ? ` ${dateRange}` : ''}`;
    }
    return cycle ? (CYCLE_LABELS[cycle] ?? cycle) : '';
  };

  const fontClass = ov.fontFamily === 'serif' ? 'font-serif' : ov.fontFamily === 'mono' ? 'font-mono' : '';
  const logoMaxH = ov.logoSize === 'sm' ? 'max-h-10' : ov.logoSize === 'lg' ? 'max-h-24' : 'max-h-16';
  const sigMaxH  = ov.signatureSize === 'sm' ? 'max-h-10' : ov.signatureSize === 'lg' ? 'max-h-24' : 'max-h-16';
  const logoAlignClass = ov.logoAlignment === 'center' ? 'text-center' : ov.logoAlignment === 'right' ? 'text-right' : '';

  const hasBank = Boolean(branding?.bankName || branding?.bankAccountNumber);

  return (
    <div className={`min-h-screen bg-slate-100 print:bg-white py-8 print:py-0 ${fontClass}`}>
      {/* Print hides this toolbar; force backgrounds (brand band, zebra, totals card) to print */}
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 12mm; } body { background: #fff; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>

      <div className="max-w-3xl mx-auto mb-4 flex items-center justify-between no-print px-4">
        <a href={`/dashboard/quick-quotes/${q.id}`} className="text-sm text-slate-500 hover:text-slate-700">← Back to quote</a>
        <PrintButton />
      </div>

      <div className="max-w-3xl mx-auto bg-white shadow-sm print:shadow-none relative overflow-hidden">
        {/* Brand accent bar */}
        <div style={{ background: brand }} className="h-2" aria-hidden />

        {/* Watermark (DRAFT / DUPLICATE from PDF Branding) */}
        {branding?.pdfWatermark && (
          <div aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
            <span className="text-[110px] font-black uppercase tracking-[0.3em] text-slate-900 opacity-[0.04] -rotate-[30deg] whitespace-nowrap">
              {branding.pdfWatermark}
            </span>
          </div>
        )}

        <div className="p-10 print:px-2 print:py-6">
        {/* Header: logo/org left · quote meta right */}
        <div className="flex items-start justify-between gap-6">
          <div className={logoAlignClass}>
            {branding?.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logoUrl} alt="Logo" className={`${logoMaxH} max-w-[220px] object-contain mb-2`} />
            )}
            {ov.showCompanyName && (
              <h1 className="text-xl font-bold text-slate-900">{q.targetOrganization?.name ?? 'Quotation'}</h1>
            )}
          </div>
          {ov.showPayToSection && hasBank && (
            <div className="text-right text-sm shrink-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.15em] mb-1.5" style={{ color: brand }}>Pay To</div>
              {branding?.bankAccountHolder && <div className="font-medium text-slate-800">{branding.bankAccountHolder}</div>}
              {branding?.bankName && <div className="text-slate-600">{branding.bankName}</div>}
              {branding?.bankAccountNumber && <div className="text-slate-600 font-mono text-xs mt-0.5">A/C: {branding.bankAccountNumber}</div>}
              {branding?.bankIfsc && <div className="text-slate-600 font-mono text-xs">IFSC: {branding.bankIfsc}</div>}
            </div>
          )}
        </div>

        {/* Centered document title, flanked by hairlines */}
        <div className="flex items-center gap-5 mt-6 mb-2">
          <div className="flex-1 border-t border-slate-200" aria-hidden />
          <h2 className="text-2xl font-semibold tracking-[0.35em] uppercase" style={{ color: brand }}>{ov.documentTitle}</h2>
          <div className="flex-1 border-t border-slate-200" aria-hidden />
        </div>

        {/* Bill to + Quote meta */}
        <div className="py-5 flex items-start justify-between gap-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] mb-1.5" style={{ color: brand }}>Bill To</div>
            <div className="text-base font-semibold text-slate-900">{customerName ?? '—'}</div>
            {q.lead?.contactName && <div className="text-sm text-slate-600">{q.lead.contactName}</div>}
            {ov.showBillToEmail && q.lead?.email && <div className="text-sm text-slate-600">{q.lead.email}</div>}
            {ov.showBillToLocation && (q.lead?.city || q.lead?.state) && (
              <div className="text-sm text-slate-600">{[q.lead?.city, q.lead?.state].filter(Boolean).join(', ')}</div>
            )}
            {ov.showBillToGstin && q.lead?.gstin && <div className="text-xs font-mono text-slate-500 mt-0.5">GSTIN: {q.lead.gstin}</div>}
          </div>
          <div className="text-right text-sm shrink-0">
            <span className="inline-block px-2.5 py-1 rounded-md font-mono font-semibold text-sm"
              style={{ background: `${brand}14`, color: brand }}>
              {q.quoteNumber}
            </span>
            <div className="text-slate-500 mt-2">Date: <span className="text-slate-700 font-medium">{fmtDate(q.quoteDate)}</span></div>
            <div className="text-slate-500">Valid till: <span className="text-slate-700 font-medium">{fmtDate(q.expiryDate)}</span></div>
          </div>
        </div>

        {/* Items — brand header band + zebra rows */}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide" style={{ background: brand, color: onBrand }}>
              <th className="py-2.5 px-2 w-8 rounded-l-md font-semibold">#</th>
              <th className="py-2.5 px-2 font-semibold">Item</th>
              {ov.showQtyColumn && <th className="py-2.5 px-2 text-right font-semibold">Qty</th>}
              {ov.showRateColumn && <th className="py-2.5 px-2 text-right font-semibold">Rate</th>}
              <th className="py-2.5 px-2 text-right rounded-r-md font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {q.items.sort((a, b) => a.lineOrder - b.lineOrder).map((it) => (
              <tr key={it.id} className="border-b border-slate-100 align-top even:bg-slate-50/60">
                <td className="py-2.5 px-2 text-slate-400">{it.lineOrder}</td>
                <td className="py-2.5 px-2">
                  <div className="font-medium text-slate-800">{it.itemName}</div>
                  {ov.showItemDescription && it.itemDescription && <div className="text-xs text-slate-500 whitespace-pre-wrap mt-0.5">{it.itemDescription}</div>}
                  {ov.showBillingMeta && (it.billingCycle || it.primaryDomain || (it.serviceStartDate && it.serviceEndDate)) && (
                    <div className="text-xs mt-0.5 leading-5" style={{ color: brand }}>
                      {(it.domainList?.length ?? 0) <= 1 && it.primaryDomain && (
                        <div>Domain Name: {it.primaryDomain}</div>
                      )}
                      {(it.domainList?.length ?? 0) > 1 && (
                        <div>🌐 {it.domainList!.length} domains</div>
                      )}
                      {(it.billingCycle || (it.serviceStartDate && it.serviceEndDate)) && (
                        <div>Subscription Validity: {validityLabel(it.billingCycle, it.serviceStartDate, it.serviceEndDate)}</div>
                      )}
                    </div>
                  )}
                  {ov.showBillingMeta && (it.domainList?.length ?? 0) > 1 && (
                    <div className="mt-1 text-[10px] text-slate-500 columns-3 gap-3">
                      {it.domainList!.map((dl, i) => (
                        <div key={i}>{dl.domain}{dl.qty && dl.qty !== 1 ? ` (${dl.qty})` : ''}</div>
                      ))}
                    </div>
                  )}
                </td>
                {ov.showQtyColumn && <td className="py-2.5 px-2 text-right text-slate-600 tabular-nums">{Number(it.quantity)}</td>}
                {ov.showRateColumn && <td className="py-2.5 px-2 text-right text-slate-600 tabular-nums">{inr(it.unitPrice)}</td>}
                <td className="py-2.5 px-2 text-right font-semibold text-slate-800 tabular-nums">{inr(it.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals card */}
        <div className="flex justify-end mt-5">
          <div className="w-64 bg-slate-50 rounded-lg px-4 py-3.5 space-y-1.5 text-sm border border-slate-300">
            {ov.showSubtotalRow && <div className="flex justify-between text-slate-600"><span>Subtotal</span><span className="tabular-nums">{inr(q.subtotal)}</span></div>}
            {ov.showDiscountRow && Number(q.discountAmount) > 0 && (
              <div className="flex justify-between text-slate-600"><span>Discount</span><span className="tabular-nums">-{inr(q.discountAmount)}</span></div>
            )}
            {ov.showGstRow && <div className="flex justify-between text-slate-600"><span>GST</span><span className="tabular-nums">{inr(q.taxAmount)}</span></div>}
            <div className="flex justify-between font-bold text-base pt-2 border-t border-slate-200">
              <span className="text-slate-900">Total</span>
              <span className="tabular-nums" style={{ color: brand }}>{inr(q.totalAmount)}</span>
            </div>
          </div>
        </div>

        {/* Notes & terms */}
        {ov.showNotesSection && q.notesToCustomer && (
          <div className="mt-6 text-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400 mb-1">Notes</div>
            <div className="text-slate-600 whitespace-pre-wrap">{q.notesToCustomer}</div>
          </div>
        )}
        {ov.showTermsSection && q.termsAndConditions && (
          <div className="mt-4 text-xs">
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400 mb-1">Terms &amp; Conditions</div>
            <div className="text-slate-500 whitespace-pre-wrap">{q.termsAndConditions}</div>
          </div>
        )}

        {/* Authorised Signatory */}
        {ov.showSignatureSection && branding?.signatureImageUrl && (
          <div className="mt-10 flex justify-end">
            <div className="text-center shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={branding.signatureImageUrl} alt="Signature" className={`${sigMaxH} max-w-[200px] object-contain mb-1 ml-auto`} />
              <div className="text-xs text-slate-600 border-t border-slate-300 pt-1 font-medium">Authorised Signatory</div>
              <div className="text-xs text-slate-400">{q.targetOrganization?.name}</div>
            </div>
          </div>
        )}

        {/* Footer text */}
        {branding?.pdfFooterText && (
          <div className="mt-8 pt-4 border-t border-slate-200 text-center text-xs text-slate-400 whitespace-pre-wrap">
            {branding.pdfFooterText}
          </div>
        )}

        {/* Company address footer */}
        {branding && (branding.addressLine1 || branding.addressLine2 || branding.city || branding.state || branding.phone || branding.email) && (
          <div className={`text-center text-xs text-slate-500 ${branding.pdfFooterText ? 'mt-3' : 'mt-8 pt-4 border-t border-slate-200'}`}>
            <div className="font-medium text-slate-600">
              {branding.legalName || branding.displayName || q.targetOrganization?.name}
            </div>
            {[branding.addressLine1, branding.addressLine2].filter(Boolean).length > 0 && (
              <div>{[branding.addressLine1, branding.addressLine2].filter(Boolean).join(', ')}</div>
            )}
            {[branding.city, branding.state, branding.postalCode].filter(Boolean).length > 0 && (
              <div>
                {[branding.city, branding.state, branding.postalCode].filter(Boolean).join(', ')}
                {branding.country ? `, ${branding.country}` : ''}
              </div>
            )}
            {[branding.phone && `Ph: ${branding.phone}`, branding.email, branding.website].filter(Boolean).length > 0 && (
              <div>{[branding.phone && `Ph: ${branding.phone}`, branding.email, branding.website].filter(Boolean).join('  ·  ')}</div>
            )}
            {branding.gstin && <div className="font-mono">GSTIN: {branding.gstin}</div>}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
