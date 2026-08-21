'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { saveQuickQuoteSettingsAction } from '../actions';

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold transition-colors">
      {pending ? 'Saving…' : 'Save Settings'}
    </button>
  );
}

interface SettingRow { key: string; value: string }

function val(settings: SettingRow[], key: string, fallback = '') {
  return settings.find((s) => s.key === key)?.value ?? fallback;
}

interface Props {
  settings: SettingRow[];
  organizations?: any[];
}

export function QuickQuoteSettingsForm({ settings, organizations = [] }: Props) {
  const [state, action] = useFormState(
    async (_prev: { success?: boolean; error?: string } | null, fd: FormData) =>
      saveQuickQuoteSettingsAction(fd),
    null,
  );

  return (
    <form action={action} className="space-y-6">
      {state?.error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {state.error}
        </div>
      )}
      {state?.success && (
        <div className="px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
          ✅ Settings save हो गईं!
        </div>
      )}

      {/* ── Quote Defaults ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <h2 className="text-base font-semibold text-slate-800">Quote Defaults</h2>

        <div className="grid grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Default Validity Days
              <span className="ml-1.5 text-xs text-slate-400 font-normal">quote कितने दिन valid रहेगा</span>
            </label>
            <input
              name="default_validity_days"
              type="number"
              min={1}
              max={365}
              defaultValue={val(settings, 'default_validity_days', '15')}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Max Discount %
              <span className="ml-1.5 text-xs text-slate-400 font-normal">line item पर maximum</span>
            </label>
            <input
              name="max_discount_percent"
              type="number"
              min={0}
              max={100}
              defaultValue={val(settings, 'max_discount_percent', '50')}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Quote Expiry Action
          </label>
          <select
            name="auto_expire_action"
            defaultValue={val(settings, 'auto_expire_action', 'mark_expired')}
            className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="mark_expired">Mark as Expired (only)</option>
            <option value="send_reminder">Mark Expired + Send Reminder Email</option>
          </select>
          <p className="text-xs text-slate-400 mt-1">
            Validity period cross होने पर क्या करें।
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Public Token Expiry Days
            <span className="ml-1.5 text-xs text-slate-400 font-normal">customer quote link कितने दिन valid</span>
          </label>
          <input
            name="public_token_expiry_days"
            type="number"
            min={1}
            max={90}
            defaultValue={val(settings, 'public_token_expiry_days', '30')}
            className="w-1/2 px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-slate-400 mt-1">
            Quote validity से ज़्यादा होना चाहिए ताकि customer बाद में भी देख सके।
          </p>
        </div>
      </div>

      {/* ── Numbering Formats ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Numbering Formats</h2>
          <p className="text-xs text-slate-500 mt-1">
            <code className="font-mono bg-slate-100 px-1 rounded">{'{YYYY}'}</code> = year,{' '}
            <code className="font-mono bg-slate-100 px-1 rounded">{'{NNNN}'}</code> = auto-incrementing number (zero-padded)
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Quote Number Format
            </label>
            <input
              name="number_format"
              type="text"
              defaultValue={val(settings, 'number_format', 'QQ-{YYYY}-{NNNN}')}
              placeholder="QQ-{YYYY}-{NNNN}"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            <p className="text-xs text-slate-400 mt-1">Example: QQ-2026-0042</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Lead Number Format
            </label>
            <input
              name="lead_number_format"
              type="text"
              defaultValue={val(settings, 'lead_number_format', 'LD-{YYYY}-{NNNN}')}
              placeholder="LD-{YYYY}-{NNNN}"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            <p className="text-xs text-slate-400 mt-1">Example: LD-2026-0012</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Subscription Number Format
            </label>
            <input
              name="subscription_number_format"
              type="text"
              defaultValue={val(settings, 'subscription_number_format', 'SUB-{YYYY}-{NNNN}')}
              placeholder="SUB-{YYYY}-{NNNN}"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            <p className="text-xs text-slate-400 mt-1">Example: SUB-2026-0007</p>
          </div>
        </div>

        {organizations && organizations.length > 0 && (
          <div className="border-t border-slate-200/60 pt-5 space-y-4">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Organization-Specific Overrides</h3>
            <p className="text-xs text-slate-500">
              प्रत्येक Zoho organization के लिए कस्टम फॉर्मेट सेट करें। आप नीचे दिए गए प्लेसहोल्डर्स का उपयोग कर सकते हैं:
            </p>
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[10px] text-slate-500">
              <div><strong className="text-slate-700">{"{ORG}"}</strong> = Short Name (e.g. ECA)</div>
              <div><strong className="text-slate-700">{"{FY}"}</strong> = FY Short (e.g. 26-27)</div>
              <div><strong className="text-slate-700">{"{YYYY}"}</strong> = 4-digit Year (e.g. 2026)</div>
              <div><strong className="text-slate-700">{"{YY}"}</strong> = 2-digit Year (e.g. 26)</div>
              <div><strong className="text-slate-700">{"{NNNN}"}</strong> = Sequence (e.g. 0001)</div>
            </div>
            <p className="text-xs text-slate-400">
              खाली रखने पर यह ऊपर दिए गए ग्लोबल फॉर्मेट का उपयोग करेगा।
            </p>

            <div className="space-y-4">
              {organizations.map((org) => (
                <div key={org.id} className="bg-slate-50/40 border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-xs text-slate-700 tracking-tight">{org.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono">Org ID: {org.zohoOrgId}</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Quote Number Format</label>
                      <input
                        name={`org_quote_format_${org.id}`}
                        type="text"
                        defaultValue={org.orgSettings?.quoteNumberFormat ?? ''}
                        placeholder="e.g. QQ/{ORG}/{FY}/{NNNN}"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono font-semibold"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Lead Number Format</label>
                      <input
                        name={`org_lead_format_${org.id}`}
                        type="text"
                        defaultValue={org.orgSettings?.leadNumberFormat ?? ''}
                        placeholder="e.g. LD/{ORG}/{FY}/{NNNN}"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono font-semibold"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Sub Number Format</label>
                      <input
                        name={`org_subscription_format_${org.id}`}
                        type="text"
                        defaultValue={org.orgSettings?.subscriptionNumberFormat ?? ''}
                        placeholder="e.g. SUB/{ORG}/{FY}/{NNNN}"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono font-semibold"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Default Content ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Default Content</h2>
          <p className="text-xs text-slate-500 mt-1">
            हर नई quote में यह content pre-filled रहेगा। Individual quote में override किया जा सकता है।
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Default Terms & Conditions
          </label>
          <textarea
            name="default_terms_and_conditions"
            rows={6}
            defaultValue={val(settings, 'default_terms_and_conditions')}
            placeholder="1. All prices are exclusive of GST unless otherwise stated.&#10;2. Payment due within 30 days of invoice date.&#10;3. Quote valid for the period mentioned above."
            className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Default Notes to Customer
          </label>
          <textarea
            name="default_notes_to_customer"
            rows={3}
            defaultValue={val(settings, 'default_notes_to_customer')}
            placeholder="Thank you for your business. Please review the above quote and let us know if you have any questions."
            className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
          <p className="text-xs text-slate-400 mt-1">
            Quote PDF के नीचे customer को दिखेगा।
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <SaveBtn />
      </div>
    </form>
  );
}
