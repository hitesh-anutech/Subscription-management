import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { EmailSettingsForm } from './_components/email-settings-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Email Configuration — Settings' };


interface SettingRow { key: string; value: string; isSensitive: boolean; description?: string | null }

export default async function EmailSettingsPage() {
  const cookieStore = await cookies();
  const serverApi = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let settings: SettingRow[] = [];

  try {
    const data = await serverApi.get<{ settings: SettingRow[] }>('/settings/email');
    settings = data.settings ?? [];
  } catch {
    // No settings saved yet — show empty form
  }

  const getValue = (key: string) => settings.find((s) => s.key === key)?.value ?? '';
  const isConfigured = (key: string) => {
    const v = settings.find((s) => s.key === key)?.value ?? '';
    return v.length > 0;
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Email Configuration</h1>
          <p className="text-sm text-slate-500 mt-1">
            Gmail SMTP credentials और default sender यहाँ से manage करो। Per-org sender के लिए
            Settings → Organizations → 📧 Sender Email Config। App Password database में encrypted save होता है।
          </p>
        </div>
        <a
          href="/dashboard/settings/email/templates"
          className="shrink-0 px-3.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
        >
          📝 Email Templates
        </a>
      </div>

      {/* Status banner */}
      <div className={`px-4 py-3 rounded-lg text-sm flex items-center gap-2 ${
        isConfigured('smtp_password')
          ? 'bg-green-50 text-green-700 border border-green-200'
          : 'bg-amber-50 text-amber-700 border border-amber-200'
      }`}>
        <span>{isConfigured('smtp_password') ? '✅' : '⚠️'}</span>
        <span>
          {isConfigured('smtp_password')
            ? 'Gmail SMTP configured है — emails send हो सकते हैं।'
            : 'Gmail App Password अभी set नहीं है — emails send नहीं होंगे।'}
        </span>
      </div>

      <EmailSettingsForm
        initialSmtpUser={getValue('smtp_user')}
        initialSmtpPassword={getValue('smtp_password')}
        initialFromAddress={getValue('from_address')}
        initialFromName={getValue('from_name')}
        initialReplyTo={getValue('reply_to')}
        isSmtpConfigured={isConfigured('smtp_password')}
      />
    </div>
  );
}
