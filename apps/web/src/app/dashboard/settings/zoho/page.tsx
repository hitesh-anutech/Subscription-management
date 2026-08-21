import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { ZohoCredentialsForm } from './_components/zoho-credentials-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Zoho App Credentials — Settings' };

interface SettingRow { key: string; value: string; isSensitive: boolean }

export default async function ZohoCredentialsPage() {
  const cookieStore = await cookies();
  const serverApi = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let settings: SettingRow[] = [];
  try {
    const data = await serverApi.get<{ settings: SettingRow[] }>('/settings/zoho');
    settings = data.settings ?? [];
  } catch {
    // Not configured yet
  }

  const getValue = (key: string) => settings.find((s) => s.key === key)?.value ?? '';
  const isSet = (key: string) => (settings.find((s) => s.key === key)?.value ?? '').length > 0;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Zoho App Credentials</h1>
        <p className="text-sm text-slate-500 mt-1">
          Zoho Self-Client का Client ID और Client Secret यहाँ save करो।
          यह एक बार setup होता है — सभी organizations इसी से connect होती हैं।
        </p>
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 space-y-1.5">
        <p className="font-semibold">Setup Steps:</p>
        <ol className="list-decimal list-inside space-y-1 text-blue-700">
          <li>
            <a href="https://api-console.zoho.in" target="_blank" rel="noreferrer" className="underline">
              api-console.zoho.in
            </a> पर जाओ
          </li>
          <li>Add Client → Self Client select करो</li>
          <li>Client ID और Client Secret नीचे paste करो</li>
        </ol>
      </div>

      <ZohoCredentialsForm
        initialClientId={getValue('client_id')}
        initialClientSecret={getValue('client_secret')}
        isClientIdSet={isSet('client_id')}
        isClientSecretSet={isSet('client_secret')}
      />
    </div>
  );
}
