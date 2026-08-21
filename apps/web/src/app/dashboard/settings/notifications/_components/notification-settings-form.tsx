'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { saveNotificationSettingsAction } from '../actions';

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

function isOn(settings: SettingRow[], key: string, defaultVal = true): boolean {
  const found = settings.find((s) => s.key === key);
  if (!found) return defaultVal;
  return found.value === 'true';
}

function val(settings: SettingRow[], key: string, fallback = ''): string {
  return settings.find((s) => s.key === key)?.value ?? fallback;
}

// Toggle checkbox row
function EventToggle({
  name, label, description, defaultChecked,
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start gap-3 py-3 cursor-pointer group">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0"
      />
      <div>
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <p className="text-xs text-slate-400 mt-0.5">{description}</p>
      </div>
    </label>
  );
}

interface Props {
  settings: SettingRow[];
}

export function NotificationSettingsForm({ settings }: Props) {
  const [state, action] = useFormState(
    async (_prev: { success?: boolean; error?: string } | null, fd: FormData) =>
      saveNotificationSettingsAction(fd),
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

      {/* ── Card 1: Channels ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Notification Channels</h2>
          <p className="text-xs text-slate-500 mt-1">
            Notifications कहाँ deliver हों।
          </p>
        </div>

        <div className="space-y-3">
          <label className="flex items-start gap-3 p-4 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50 transition-colors">
            <input
              type="checkbox"
              name="channel_inapp_enabled"
              defaultChecked={isOn(settings, 'channel_inapp_enabled')}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="text-sm font-medium text-slate-700">In-App Notifications</span>
              <p className="text-xs text-slate-500 mt-0.5">
                Dashboard के अंदर notification bell में दिखेंगे।
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 p-4 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50 transition-colors">
            <input
              type="checkbox"
              name="channel_email_enabled"
              defaultChecked={isOn(settings, 'channel_email_enabled')}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="text-sm font-medium text-slate-700">Email Notifications</span>
              <p className="text-xs text-slate-500 mt-0.5">
                SendGrid के through email भेजे जाएंगे।
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* ── Card 2: Per-Event Toggles ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-800">Per-Event Notifications</h2>
          <p className="text-xs text-slate-500 mt-1">
            कौन से events पर notify करना है। Uncheck करने पर वो event के लिए कोई notification नहीं जाएगी।
          </p>
        </div>

        <div className="space-y-0 divide-y divide-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide pt-1 pb-2">
            Quotes
          </p>
          <EventToggle name="evt_quote_sent"     label="Quote Sent"     description="Customer को quote email भेजा गया।"         defaultChecked={isOn(settings, 'evt_quote_sent')} />
          <EventToggle name="evt_quote_viewed"   label="Quote Viewed"   description="Customer ने quote link open किया।"          defaultChecked={isOn(settings, 'evt_quote_viewed')} />
          <EventToggle name="evt_quote_accepted" label="Quote Accepted" description="Customer ने quote accept किया।"             defaultChecked={isOn(settings, 'evt_quote_accepted')} />
          <EventToggle name="evt_quote_rejected" label="Quote Rejected" description="Customer ने quote reject किया।"             defaultChecked={isOn(settings, 'evt_quote_rejected')} />

          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide pt-4 pb-2">
            Subscriptions
          </p>
          <EventToggle name="evt_renewal_reminder"       label="Renewal Reminder Due"       description="Subscription expiry reminder schedule के अनुसार।" defaultChecked={isOn(settings, 'evt_renewal_reminder')} />

          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide pt-4 pb-2">
            Conversions & System
          </p>
          <EventToggle name="evt_conversion_completed"  label="Conversion Completed"   description="Lead successfully Zoho customer बन गया।"  defaultChecked={isOn(settings, 'evt_conversion_completed')} />
          <EventToggle name="evt_conversion_failed"     label="Conversion Failed"      description="Lead-to-customer conversion fail हुई।"    defaultChecked={isOn(settings, 'evt_conversion_failed')} />
          <EventToggle name="evt_oauth_token_expiring"  label="OAuth Token Expiring"   description="किसी Zoho org का access token जल्द expire होगा।" defaultChecked={isOn(settings, 'evt_oauth_token_expiring')} />
          <EventToggle name="evt_webhook_failure"       label="Webhook Processing Failed" description="Zoho webhook retry limit cross हुई।"   defaultChecked={isOn(settings, 'evt_webhook_failure')} />
        </div>
      </div>

      {/* ── Card 3: Delivery Settings ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Delivery Settings</h2>
          <p className="text-xs text-slate-500 mt-1">
            Digest mode और quiet hours।
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Delivery Mode
          </label>
          <select
            name="digest_mode"
            defaultValue={val(settings, 'digest_mode', 'realtime')}
            className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="realtime">Real-time (हर event पर तुरंत)</option>
            <option value="daily_digest">Daily Digest (दिन में एक बार summary)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Quiet Hours
            <span className="ml-1.5 text-xs text-slate-400 font-normal">IST — इस दौरान email notifications hold होंगी</span>
          </label>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-500 mb-1">From</label>
              <input
                name="quiet_hours_start"
                type="time"
                defaultValue={val(settings, 'quiet_hours_start', '22:00')}
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <span className="text-slate-400 mt-5">to</span>
            <div className="flex-1">
              <label className="block text-xs text-slate-500 mb-1">Until</label>
              <input
                name="quiet_hours_end"
                type="time"
                defaultValue={val(settings, 'quiet_hours_end', '08:00')}
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <SaveBtn />
      </div>
    </form>
  );
}
