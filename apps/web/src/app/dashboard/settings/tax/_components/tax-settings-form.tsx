'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { saveTaxSettingsAction, saveOrgTaxSettingsAction } from '../actions';

// Indian states with GST state codes
const INDIAN_STATES = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '28', name: 'Andhra Pradesh (Old)' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh (New)' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
];

const GST_RATES = [
  { value: '0',  label: '0% (Exempt / Nil)' },
  { value: '5',  label: '5%' },
  { value: '12', label: '12%' },
  { value: '18', label: '18% (Standard)' },
  { value: '28', label: '28%' },
];

function SaveGlobalBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold transition-colors">
      {pending ? 'Saving…' : 'Save Global Settings'}
    </button>
  );
}

interface SettingRow { key: string; value: string }

function val(settings: SettingRow[], key: string, fallback = '') {
  return settings.find((s) => s.key === key)?.value ?? fallback;
}

interface OrgRow {
  id: string;
  name: string;
  supplierState?: string | null;
  supplierStateCode?: string | null;
  defaultTaxRate?: number | null;
}

interface Props {
  settings: SettingRow[];
  orgs: OrgRow[];
}

function OrgSaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="px-3 py-1.5 rounded border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors">
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

function OrgTaxRow({ org }: { org: OrgRow }) {
  const [state, action] = useFormState(
    async (_prev: { success?: boolean; error?: string } | null, fd: FormData) =>
      saveOrgTaxSettingsAction(org.id, fd),
    null,
  );

  return (
    <form action={action}>
      <div className="px-5 py-4 border-b border-slate-100 last:border-0">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-slate-800">{org.name}</span>
          <div className="flex items-center gap-2">
            {state?.success && <span className="text-xs text-green-600">✅ Saved</span>}
            {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
            <OrgSaveBtn />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Supplier State</label>
            <select
              name={`supplier_state_code_${org.id}`}
              defaultValue={org.supplierStateCode ?? ''}
              className="w-full px-2.5 py-2 rounded border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">— Select State —</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Default Tax Rate</label>
            <select
              name={`default_tax_rate_${org.id}`}
              defaultValue={String(org.defaultTaxRate ?? 18)}
              className="w-full px-2.5 py-2 rounded border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {GST_RATES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            {org.supplierState ? (
              <p className="text-xs text-slate-400 pb-2">
                Current: <strong className="text-slate-600">{org.supplierState}</strong>
                {org.supplierStateCode && ` (${org.supplierStateCode})`}
              </p>
            ) : (
              <p className="text-xs text-amber-500 pb-2">Not configured</p>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

export function TaxSettingsForm({ settings, orgs }: Props) {
  const [state, action] = useFormState(
    async (_prev: { success?: boolean; error?: string } | null, fd: FormData) =>
      saveTaxSettingsAction(fd),
    null,
  );

  const rcmEnabled = val(settings, 'reverse_charge_enabled', 'false') === 'true';

  return (
    <div className="space-y-6">
      {/* ── Global Tax Settings ── */}
      <form action={action} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <h2 className="text-base font-semibold text-slate-800">Global Tax Defaults</h2>

        {state?.error && (
          <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {state.error}
          </div>
        )}
        {state?.success && (
          <div className="px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
            ✅ Global tax settings save हो गईं!
          </div>
        )}

        <div className="grid grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Default GST Rate
            </label>
            <select
              name="default_gst_rate"
              defaultValue={val(settings, 'default_gst_rate', '18')}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {GST_RATES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              New line items पर apply होगा जब no specific rate हो।
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Tax Mode
            </label>
            <select
              name="tax_mode"
              defaultValue={val(settings, 'tax_mode', 'exclusive')}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="exclusive">Tax Exclusive (price में tax नहीं)</option>
              <option value="inclusive">Tax Inclusive (price में tax शामिल है)</option>
            </select>
            <p className="text-xs text-slate-400 mt-1">
              B2B के लिए generally exclusive सही रहता है।
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-4 rounded-lg border border-slate-200 bg-slate-50">
          <input
            id="rcm_toggle"
            name="reverse_charge_enabled"
            type="checkbox"
            defaultChecked={rcmEnabled}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <label htmlFor="rcm_toggle" className="text-sm font-medium text-slate-700 cursor-pointer">
              Reverse Charge Mechanism (RCM)
            </label>
            <p className="text-xs text-slate-500 mt-0.5">
              Import of services / specific notified supplies के लिए। Enable करने पर quotes में RCM indicator दिखेगा।
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <SaveGlobalBtn />
        </div>
      </form>

      {/* ── Per-Org Supplier State ── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Per-Org Supplier State</h2>
          <p className="text-xs text-slate-500 mt-1">
            हर Zoho org का supplier state GST intra/inter-state determination के लिए जरूरी है।
            Customer की state से compare होकर CGST+SGST vs IGST decide होती है।
          </p>
        </div>

        {orgs.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-slate-400">
            कोई organization नहीं मिली।{' '}
            <a href="/dashboard/settings/organizations" className="text-blue-600 hover:underline">
              Organizations setup करो
            </a>
          </div>
        ) : (
          orgs.map((org) => <OrgTaxRow key={org.id} org={org} />)
        )}
      </div>

      {/* Info box */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <p className="font-medium mb-1">GST Calculation Logic</p>
        <ul className="space-y-1 text-xs list-disc list-inside">
          <li>Supplier state = Customer state → <strong>Intra-state</strong> → CGST + SGST (half each)</li>
          <li>Supplier state ≠ Customer state → <strong>Inter-state</strong> → IGST (full rate)</li>
          <li>Customer GSTIN से state auto-detect होती है (first 2 digits = state code)</li>
        </ul>
      </div>
    </div>
  );
}
