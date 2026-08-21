'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useRef, useState } from 'react';
import { saveBrandingAction } from '../actions';

interface OrgSettings {
  legalName?: string | null;
  displayName?: string | null;
  logoUrl?: string | null;
  brandColor?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  stateCode?: string | null;
  postalCode?: string | null;
  country?: string | null;
  gstin?: string | null;
  pan?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  pdfTemplate?: string | null;
  pdfFooterText?: string | null;
  pdfShowCostPrice?: boolean;
  pdfShowInternalNotes?: boolean;
  pdfWatermark?: string | null;
  signatureImageUrl?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  bankAccountHolder?: string | null;
  settingsOverrides?: Record<string, unknown> | null;
}

interface Props {
  orgId: string;
  orgName: string;
  settings: OrgSettings | null;
}

type PdfOverrides = {
  logoSize?: 'sm' | 'md' | 'lg';
  logoAlignment?: 'left' | 'center' | 'right';
  showCompanyName?: boolean;
  signatureSize?: 'sm' | 'md' | 'lg';
  showSignatureSection?: boolean;
  fontFamily?: 'sans' | 'serif' | 'mono';
  documentTitle?: string;
  dateFormat?: 'dd/mm/yyyy' | 'dd-mmm-yyyy';
  showBillToGstin?: boolean;
  showBillToEmail?: boolean;
  showBillToLocation?: boolean;
  showItemDescription?: boolean;
  showBillingMeta?: boolean;
  showQtyColumn?: boolean;
  showRateColumn?: boolean;
  showSubtotalRow?: boolean;
  showGstRow?: boolean;
  showDiscountRow?: boolean;
  showPayToSection?: boolean;
  showTermsSection?: boolean;
  showNotesSection?: boolean;
};

const DEFAULT_OVERRIDES: Required<PdfOverrides> = {
  logoSize: 'md',
  logoAlignment: 'left',
  showCompanyName: true,
  signatureSize: 'md',
  showSignatureSection: true,
  fontFamily: 'sans',
  documentTitle: 'QUOTATION',
  dateFormat: 'dd/mm/yyyy',
  showBillToGstin: true,
  showBillToEmail: true,
  showBillToLocation: true,
  showItemDescription: true,
  showBillingMeta: true,
  showQtyColumn: true,
  showRateColumn: true,
  showSubtotalRow: true,
  showGstRow: true,
  showDiscountRow: true,
  showPayToSection: true,
  showTermsSection: true,
  showNotesSection: true,
};

const PDF_TEMPLATES = [
  { value: 'modern', label: 'Modern', desc: 'Clean sans-serif, colored header' },
  { value: 'classic', label: 'Classic', desc: 'Traditional business style' },
  { value: 'minimal', label: 'Minimal', desc: 'Minimal borders and lines' },
  { value: 'compact', label: 'Compact', desc: 'Dense layout, space-efficient' },
];

const WATERMARKS = [
  { value: '', label: 'None' },
  { value: 'DRAFT', label: 'DRAFT' },
  { value: 'DUPLICATE', label: 'DUPLICATE' },
];

export function BrandingForm({ orgId, orgName, settings: init }: Props) {
  const boundAction = saveBrandingAction.bind(null, orgId);
  const [state, action] = useFormState(
    async (prev: { error?: string; success?: boolean } | null, formData: FormData) =>
      boundAction(prev, formData),
    null,
  );

  const [logoPreview, setLogoPreview] = useState<string | null>(init?.logoUrl ?? null);
  const [logoBase64, setLogoBase64] = useState<string | null>(init?.logoUrl ?? null);
  const [sigPreview, setSigPreview] = useState<string | null>(init?.signatureImageUrl ?? null);
  const [sigBase64, setSigBase64] = useState<string | null>(init?.signatureImageUrl ?? null);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const sigInputRef = useRef<HTMLInputElement>(null);

  const [overrides, setOverrides] = useState<PdfOverrides>(() => {
    const raw = init?.settingsOverrides;
    if (typeof raw === 'object' && raw !== null) {
      return { ...DEFAULT_OVERRIDES, ...(raw as PdfOverrides) };
    }
    return { ...DEFAULT_OVERRIDES };
  });
  const setOpt = <K extends keyof PdfOverrides>(k: K, v: PdfOverrides[K]) =>
    setOverrides(prev => ({ ...prev, [k]: v }));

  function readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await readAsBase64(file);
    setLogoPreview(b64);
    setLogoBase64(b64);
  }

  async function handleSigChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await readAsBase64(file);
    setSigPreview(b64);
    setSigBase64(b64);
  }

  const s = init ?? {};
  const inp = 'w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
  const label = 'block text-sm font-medium text-slate-700 mb-1.5';
  const section = 'bg-white border border-slate-200 rounded-xl p-6 space-y-5';
  const groupLabel = 'text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400';

  return (
    <form action={action} className="space-y-6">
      {/* Hidden base64 image fields */}
      <input type="hidden" name="logoUrl" value={logoBase64 ?? ''} />
      <input type="hidden" name="signatureImageUrl" value={sigBase64 ?? ''} />
      <input type="hidden" name="settingsOverrides" value={JSON.stringify(overrides)} />

      {state?.error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {state.error}
        </div>
      )}
      {state?.success && (
        <div className="px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
          ✅ {orgName} की branding save हो गई!
        </div>
      )}

      {/* 1. Company Info */}
      <div className={section}>
        <h2 className="text-base font-semibold text-slate-800">Company Information</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label}>Legal Name</label>
            <input name="legalName" type="text" defaultValue={s.legalName ?? ''} placeholder="Excel Technologies Pvt Ltd" className={inp} />
          </div>
          <div>
            <label className={label}>Display Name</label>
            <input name="displayName" type="text" defaultValue={s.displayName ?? ''} placeholder="Excel Technologies" className={inp} />
          </div>
          <div>
            <label className={label}>GSTIN</label>
            <input name="gstin" type="text" defaultValue={s.gstin ?? ''} placeholder="27AAAPL1234C1Z5" className={`${inp} font-mono uppercase`} />
          </div>
          <div>
            <label className={label}>PAN</label>
            <input name="pan" type="text" defaultValue={s.pan ?? ''} placeholder="AAAPL1234C" className={`${inp} font-mono uppercase`} />
          </div>
          <div>
            <label className={label}>Phone</label>
            <input name="phone" type="text" defaultValue={s.phone ?? ''} placeholder="+91 98765 43210" className={inp} />
          </div>
          <div>
            <label className={label}>Email</label>
            <input name="email" type="email" defaultValue={s.email ?? ''} placeholder="billing@exceltechnologies.in" className={inp} />
          </div>
          <div className="col-span-2">
            <label className={label}>Website</label>
            <input name="website" type="text" defaultValue={s.website ?? ''} placeholder="https://exceltechnologies.in" className={inp} />
          </div>
        </div>
      </div>

      {/* 2. Address */}
      <div className={section}>
        <h2 className="text-base font-semibold text-slate-800">Address</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={label}>Address Line 1</label>
            <input name="addressLine1" type="text" defaultValue={s.addressLine1 ?? ''} placeholder="Office No. 101, Tech Park" className={inp} />
          </div>
          <div className="col-span-2">
            <label className={label}>Address Line 2</label>
            <input name="addressLine2" type="text" defaultValue={s.addressLine2 ?? ''} placeholder="Andheri East" className={inp} />
          </div>
          <div>
            <label className={label}>City</label>
            <input name="city" type="text" defaultValue={s.city ?? ''} placeholder="Mumbai" className={inp} />
          </div>
          <div>
            <label className={label}>State</label>
            <input name="state" type="text" defaultValue={s.state ?? ''} placeholder="Maharashtra" className={inp} />
          </div>
          <div>
            <label className={label}>State Code</label>
            <input name="stateCode" type="text" defaultValue={s.stateCode ?? ''} placeholder="27" className={inp} />
          </div>
          <div>
            <label className={label}>Postal Code</label>
            <input name="postalCode" type="text" defaultValue={s.postalCode ?? ''} placeholder="400069" className={inp} />
          </div>
          <div>
            <label className={label}>Country</label>
            <input name="country" type="text" defaultValue={s.country ?? 'India'} className={inp} />
          </div>
        </div>
      </div>

      {/* 3. PDF Appearance */}
      <div className={section}>
        <h2 className="text-base font-semibold text-slate-800">PDF Appearance</h2>

        {/* Template */}
        <div>
          <label className={label}>PDF Template</label>
          <div className="grid grid-cols-4 gap-3">
            {PDF_TEMPLATES.map((t) => (
              <label key={t.value} className="cursor-pointer">
                <input
                  type="radio"
                  name="pdfTemplate"
                  value={t.value}
                  defaultChecked={(s.pdfTemplate ?? 'modern') === t.value}
                  className="sr-only peer"
                />
                <div className="border-2 rounded-lg p-3 text-center peer-checked:border-blue-500 peer-checked:bg-blue-50 hover:border-slate-400 transition-colors">
                  <div className="text-sm font-semibold text-slate-800">{t.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{t.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Brand color */}
        <div className="flex items-center gap-4">
          <div>
            <label className={label}>Brand Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                name="brandColor"
                defaultValue={s.brandColor ?? '#1F2937'}
                className="w-12 h-10 rounded-lg border border-slate-300 cursor-pointer p-0.5"
              />
              <span className="text-sm text-slate-500">PDF header accent color</span>
            </div>
          </div>
        </div>

        {/* Watermark */}
        <div>
          <label className={label}>Watermark</label>
          <div className="flex gap-4">
            {WATERMARKS.map((w) => (
              <label key={w.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="pdfWatermark"
                  value={w.value}
                  defaultChecked={(s.pdfWatermark ?? '') === w.value}
                />
                <span className="text-sm text-slate-700">{w.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Show/hide toggles */}
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="hidden" name="pdfShowCostPrice" value={String(false)} />
            <input
              type="checkbox"
              name="pdfShowCostPrice"
              value="true"
              defaultChecked={s.pdfShowCostPrice ?? false}
              onChange={(e) => {
                const hidden = e.currentTarget.form?.elements.namedItem('pdfShowCostPrice') as HTMLInputElement | null;
                if (hidden) hidden.value = String(e.currentTarget.checked);
              }}
              className="w-4 h-4 rounded border-slate-300 text-blue-600"
            />
            <span className="text-sm text-slate-700">Cost price PDF में दिखाओ</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="hidden" name="pdfShowInternalNotes" value={String(false)} />
            <input
              type="checkbox"
              name="pdfShowInternalNotes"
              value="true"
              defaultChecked={s.pdfShowInternalNotes ?? false}
              onChange={(e) => {
                const hidden = e.currentTarget.form?.elements.namedItem('pdfShowInternalNotes') as HTMLInputElement | null;
                if (hidden) hidden.value = String(e.currentTarget.checked);
              }}
              className="w-4 h-4 rounded border-slate-300 text-blue-600"
            />
            <span className="text-sm text-slate-700">Internal notes PDF में दिखाओ</span>
          </label>
        </div>

        {/* Footer text */}
        <div>
          <label className={label}>PDF Footer Text</label>
          <textarea
            name="pdfFooterText"
            rows={2}
            defaultValue={s.pdfFooterText ?? ''}
            placeholder="Thank you for your business!"
            className={`${inp} resize-none`}
          />
        </div>
      </div>

      {/* 4. Images */}
      <div className={section}>
        <h2 className="text-base font-semibold text-slate-800">Logo & Signature</h2>
        <div className="grid grid-cols-2 gap-6">
          {/* Logo */}
          <div>
            <label className={label}>Company Logo</label>
            {logoPreview && (
              <div className="mb-3 p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-center h-20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoPreview} alt="Logo preview" className="max-h-16 max-w-full object-contain" />
              </div>
            )}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/svg+xml,image/jpeg,image/webp"
              onChange={handleLogoChange}
              className="hidden"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                {logoPreview ? 'Change Logo' : 'Upload Logo'}
              </button>
              {logoPreview && (
                <button
                  type="button"
                  onClick={() => { setLogoPreview(null); setLogoBase64(null); }}
                  className="px-4 py-2 rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1.5">PNG, SVG, JPG — max 2MB recommended</p>
          </div>

          {/* Signature */}
          <div>
            <label className={label}>Signature / Seal</label>
            {sigPreview && (
              <div className="mb-3 p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-center h-20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sigPreview} alt="Signature preview" className="max-h-16 max-w-full object-contain" />
              </div>
            )}
            <input
              ref={sigInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleSigChange}
              className="hidden"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => sigInputRef.current?.click()}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                {sigPreview ? 'Change Signature' : 'Upload Signature'}
              </button>
              {sigPreview && (
                <button
                  type="button"
                  onClick={() => { setSigPreview(null); setSigBase64(null); }}
                  className="px-4 py-2 rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1.5">PNG, JPG — transparent background अच्छा लगता है</p>
          </div>
        </div>
      </div>

      {/* 4b. Document Layout & Typography */}
      <div className={section}>
        <h2 className="text-base font-semibold text-slate-800">Document Layout & Typography</h2>

        {/* Logo controls */}
        <div className="space-y-3">
          <div className={groupLabel}>Logo</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Logo Size</label>
              <PillSel
                options={[{ v: 'sm', l: 'Small (40px)' }, { v: 'md', l: 'Medium (64px)' }, { v: 'lg', l: 'Large (96px)' }]}
                value={overrides.logoSize ?? 'md'}
                onChange={v => setOpt('logoSize', v as PdfOverrides['logoSize'])}
              />
            </div>
            <div>
              <label className={label}>Logo Alignment</label>
              <PillSel
                options={[{ v: 'left', l: 'Left' }, { v: 'center', l: 'Center' }, { v: 'right', l: 'Right' }]}
                value={overrides.logoAlignment ?? 'left'}
                onChange={v => setOpt('logoAlignment', v as PdfOverrides['logoAlignment'])}
              />
            </div>
          </div>
          <ToggleRow
            checked={overrides.showCompanyName !== false}
            onChange={v => setOpt('showCompanyName', v)}
            label="Show company name below logo"
            desc="Header में logo के नीचे org name text"
          />
        </div>

        <hr className="border-slate-100" />

        {/* Signature controls */}
        <div className="space-y-3">
          <div className={groupLabel}>Signature</div>
          <div>
            <label className={label}>Signature Size</label>
            <PillSel
              options={[{ v: 'sm', l: 'Small (40px)' }, { v: 'md', l: 'Medium (64px)' }, { v: 'lg', l: 'Large (90px)' }]}
              value={overrides.signatureSize ?? 'md'}
              onChange={v => setOpt('signatureSize', v as PdfOverrides['signatureSize'])}
            />
          </div>
          <ToggleRow
            checked={overrides.showSignatureSection !== false}
            onChange={v => setOpt('showSignatureSection', v)}
            label="Show Authorised Signatory section"
          />
        </div>

        <hr className="border-slate-100" />

        {/* Typography */}
        <div className="space-y-3">
          <div className={groupLabel}>Typography</div>
          <div>
            <label className={label}>Font Style</label>
            <PillSel
              options={[{ v: 'sans', l: 'Sans-serif' }, { v: 'serif', l: 'Serif' }, { v: 'mono', l: 'Monospace' }]}
              value={overrides.fontFamily ?? 'sans'}
              onChange={v => setOpt('fontFamily', v as PdfOverrides['fontFamily'])}
            />
            <p className="text-xs text-slate-400 mt-1.5">Print page और email PDF दोनों पर apply होगा</p>
          </div>
        </div>

        <hr className="border-slate-100" />

        {/* Document Identity */}
        <div className="space-y-3">
          <div className={groupLabel}>Document Identity</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Document Title</label>
              <input
                type="text"
                className={inp}
                value={overrides.documentTitle ?? 'QUOTATION'}
                onChange={e => setOpt('documentTitle', e.target.value)}
                placeholder="QUOTATION"
              />
              <p className="text-xs text-slate-400 mt-1">e.g. PROFORMA INVOICE, ESTIMATE</p>
            </div>
            <div>
              <label className={label}>Date Format</label>
              <PillSel
                options={[{ v: 'dd/mm/yyyy', l: '18/07/2026' }, { v: 'dd-mmm-yyyy', l: '18 Jul 2026' }]}
                value={overrides.dateFormat ?? 'dd/mm/yyyy'}
                onChange={v => setOpt('dateFormat', v as PdfOverrides['dateFormat'])}
              />
            </div>
          </div>
        </div>

        <hr className="border-slate-100" />

        {/* Bill To Section */}
        <div className="space-y-3">
          <div className={groupLabel}>Bill To Section</div>
          <div className="space-y-2">
            <ToggleRow checked={overrides.showBillToGstin !== false} onChange={v => setOpt('showBillToGstin', v)} label="Show customer GSTIN" />
            <ToggleRow checked={overrides.showBillToEmail !== false} onChange={v => setOpt('showBillToEmail', v)} label="Show customer email" />
            <ToggleRow checked={overrides.showBillToLocation !== false} onChange={v => setOpt('showBillToLocation', v)} label="Show city / state" />
          </div>
        </div>

        <hr className="border-slate-100" />

        {/* Items Table */}
        <div className="space-y-3">
          <div className={groupLabel}>Items Table</div>
          <div className="space-y-2">
            <ToggleRow checked={overrides.showItemDescription !== false} onChange={v => setOpt('showItemDescription', v)} label="Show item descriptions" desc="Item के नीचे description text" />
            <ToggleRow checked={overrides.showBillingMeta !== false} onChange={v => setOpt('showBillingMeta', v)} label="Show billing cycle & domain" desc="monthly · domain.com line" />
            <ToggleRow checked={overrides.showQtyColumn !== false} onChange={v => setOpt('showQtyColumn', v)} label="Show Qty column" />
            <ToggleRow checked={overrides.showRateColumn !== false} onChange={v => setOpt('showRateColumn', v)} label="Show Rate column" />
          </div>
        </div>

        <hr className="border-slate-100" />

        {/* Totals Section */}
        <div className="space-y-3">
          <div className={groupLabel}>Totals Section</div>
          <div className="space-y-2">
            <ToggleRow checked={overrides.showSubtotalRow !== false} onChange={v => setOpt('showSubtotalRow', v)} label="Show Subtotal row" />
            <ToggleRow checked={overrides.showGstRow !== false} onChange={v => setOpt('showGstRow', v)} label="Show GST row" />
            <ToggleRow checked={overrides.showDiscountRow !== false} onChange={v => setOpt('showDiscountRow', v)} label="Show Discount row" desc="Discount > 0 होने पर ही दिखता है" />
          </div>
        </div>

        <hr className="border-slate-100" />

        {/* Document Sections */}
        <div className="space-y-3">
          <div className={groupLabel}>Document Sections</div>
          <div className="space-y-2">
            <ToggleRow checked={overrides.showPayToSection !== false} onChange={v => setOpt('showPayToSection', v)} label="Show Pay To (bank details)" />
            <ToggleRow checked={overrides.showTermsSection !== false} onChange={v => setOpt('showTermsSection', v)} label="Show Terms & Conditions" />
            <ToggleRow checked={overrides.showNotesSection !== false} onChange={v => setOpt('showNotesSection', v)} label="Show Notes to Customer" />
          </div>
        </div>
      </div>

      {/* 5. Bank Details */}
      <div className={section}>
        <h2 className="text-base font-semibold text-slate-800">Bank Details (for PDF footer)</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label}>Bank Name</label>
            <input name="bankName" type="text" defaultValue={s.bankName ?? ''} placeholder="HDFC Bank" className={inp} />
          </div>
          <div>
            <label className={label}>Account Holder</label>
            <input name="bankAccountHolder" type="text" defaultValue={s.bankAccountHolder ?? ''} placeholder="Excel Technologies Pvt Ltd" className={inp} />
          </div>
          <div>
            <label className={label}>Account Number</label>
            <input name="bankAccountNumber" type="text" defaultValue={s.bankAccountNumber ?? ''} placeholder="XXXX XXXX XXXX" className={`${inp} font-mono`} />
          </div>
          <div>
            <label className={label}>IFSC Code</label>
            <input name="bankIfsc" type="text" defaultValue={s.bankIfsc ?? ''} placeholder="HDFC0001234" className={`${inp} font-mono uppercase`} />
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <SubmitBtn />
      </div>
    </form>
  );
}

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold transition-colors"
    >
      {pending ? 'Saving…' : 'Save Branding'}
    </button>
  );
}

function PillSel({ options, value, onChange }: {
  options: { v: string; l: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex bg-slate-100 rounded-lg p-0.5 gap-0.5 flex-wrap">
      {options.map(o => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
            value === o.v
              ? 'bg-white shadow-sm text-slate-900'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function ToggleRow({ checked, onChange, label, desc }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
}) {
  return (
    <div
      className="flex items-center justify-between py-2.5 px-3.5 rounded-lg bg-slate-50 border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors select-none"
      onClick={() => onChange(!checked)}
    >
      <div>
        <div className="text-sm text-slate-700">{label}</div>
        {desc && <div className="text-xs text-slate-400 mt-0.5">{desc}</div>}
      </div>
      <div className={`relative ml-4 w-9 h-5 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-blue-500' : 'bg-slate-300'}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${checked ? 'left-4' : 'left-0.5'}`} />
      </div>
    </div>
  );
}
