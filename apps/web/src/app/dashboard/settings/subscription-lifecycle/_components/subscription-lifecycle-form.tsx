'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { saveSubscriptionLifecycleAction } from '../actions';

// Available reminder day options
const REMINDER_DAY_OPTIONS = [90, 60, 45, 30, 21, 15, 7, 3, 1];

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
  subSettings: SettingRow[];
  convSettings: SettingRow[];
}

export function SubscriptionLifecycleForm({ subSettings, convSettings }: Props) {
  const [state, action] = useFormState(
    async (_prev: { success?: boolean; error?: string } | null, fd: FormData) =>
      saveSubscriptionLifecycleAction(fd),
    null,
  );

  // Parse reminder days — stored as "60,30,15,7" (comma-separated)
  const rawDays = val(subSettings, 'renewal_reminder_days', '60,30,15,7');
  const activeDays = new Set(
    rawDays
      .split(',')
      .map((d) => parseInt(d.trim(), 10))
      .filter((d) => !isNaN(d)),
  );

  const autoRenewDefault = val(subSettings, 'auto_renew_default', 'false') === 'true';
  const autoConvert = val(convSettings, 'auto_convert_on_accept', 'false') === 'true';

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

      {/* ── Card 1: Renewal Reminders ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Renewal Reminders</h2>
          <p className="text-xs text-slate-500 mt-1">
            Subscription expire होने से कितने दिन पहले reminder email भेजें।
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-3">
            Reminder Schedule (days before expiry)
          </label>
          <div className="flex flex-wrap gap-2">
            {REMINDER_DAY_OPTIONS.map((day) => (
              <label
                key={day}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg border cursor-pointer select-none transition-colors has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 border-slate-200 hover:border-slate-300"
              >
                <input
                  type="checkbox"
                  name="reminder_day"
                  value={String(day)}
                  defaultChecked={activeDays.has(day)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-slate-700">{day}d</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Current: {[...activeDays].sort((a, b) => b - a).join(', ')} days — at least एक select करो।
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Reminder Recipients
          </label>
          <select
            name="reminder_recipients"
            defaultValue={val(subSettings, 'reminder_recipients', 'both')}
            className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="customer_only">Customer Only (subscription owner को email)</option>
            <option value="sales_only">Sales Only (internal team को alert)</option>
            <option value="both">Both (customer + sales team दोनों)</option>
          </select>
        </div>
      </div>

      {/* ── Card 2: Grace Period & Auto-Cancel ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Grace Period & Expiry</h2>
          <p className="text-xs text-slate-500 mt-1">
            Subscription expire होने के बाद कितने दिन renewable रहे।
          </p>
        </div>

        <div className="grid grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Grace Period (days)
            </label>
            <input
              name="expiry_grace_days"
              type="number"
              min={0}
              max={365}
              defaultValue={val(subSettings, 'expiry_grace_days', '60')}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">
              End date के बाद subscription &quot;Expired&quot; में रहेगी इतने दिन।
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Auto-Cancel After (days)
              <span className="ml-1.5 text-xs text-slate-400 font-normal">grace period के बाद</span>
            </label>
            <input
              name="auto_cancel_after_days"
              type="number"
              min={0}
              max={365}
              defaultValue={val(subSettings, 'auto_cancel_after_days', '0')}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">
              <strong>0</strong> = auto-cancel नहीं होगा (manual ही होगा)।
            </p>
          </div>
        </div>
      </div>

      {/* ── Card 3: Subscription Behavior ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <h2 className="text-base font-semibold text-slate-800">Default Behavior</h2>

        <div className="space-y-4">
          <label className="flex items-start gap-3 p-4 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50 transition-colors">
            <input
              id="auto_renew_default"
              name="auto_renew_default"
              type="checkbox"
              defaultChecked={autoRenewDefault}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="text-sm font-medium text-slate-700">Auto-Renew by Default</span>
              <p className="text-xs text-slate-500 mt-0.5">
                नई subscription create होने पर auto_renew flag default ON रहे। Individual subscription पर override किया जा सकता है।
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 p-4 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50 transition-colors">
            <input
              id="auto_convert_on_accept"
              name="auto_convert_on_accept"
              type="checkbox"
              defaultChecked={autoConvert}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="text-sm font-medium text-slate-700">Auto-Convert Lead on Quote Accept</span>
              <p className="text-xs text-slate-500 mt-0.5">
                Lead quote accept होने पर automatically Zoho में customer create हो। OFF रखने पर sales manually confirm करेगा।
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* ── Card 4: Pro-rata ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Pro-rata Calculation</h2>
          <p className="text-xs text-slate-500 mt-1">
            Mid-cycle license addition के लिए pro-rata amount कैसे calculate हो।
          </p>
        </div>

        <div className="grid grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Calculation Method
            </label>
            <select
              name="prorata_method"
              defaultValue={val(subSettings, 'prorata_method', 'daily')}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="daily">Daily Rate (annual ÷ 365 × remaining days)</option>
              <option value="monthly">Monthly Rate (annual ÷ 12 × remaining months)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Rounding Rule
            </label>
            <select
              name="prorata_rounding"
              defaultValue={val(subSettings, 'prorata_rounding', 'nearest')}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="nearest">Nearest (0.5 → up)</option>
              <option value="up">Always Round Up</option>
              <option value="down">Always Round Down</option>
            </select>
          </div>
        </div>

        <div className="bg-slate-50 rounded-lg p-4 text-xs text-slate-500 border border-slate-200">
          <p className="font-medium text-slate-600 mb-1">Example — Daily Rate</p>
          <p>Annual plan ₹12,000. Customer adds 2 licenses on day 200 (165 days remaining).</p>
          <p className="mt-1">
            Pro-rata = (12,000 ÷ 365) × 165 × 2 = <strong className="text-slate-700">₹10,849</strong>
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <SaveBtn />
      </div>
    </form>
  );
}
