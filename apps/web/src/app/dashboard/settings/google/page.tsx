import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { GoogleResellerSlotCard } from './_components/google-credentials-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Google Workspace — Settings' };

interface SettingRow { key: string; value: string; isSensitive: boolean }

interface SlotStatus { connected: boolean; resellerEmail: string | null }

interface Props {
  searchParams: Promise<{ connected?: string; error?: string }>;
}

export default async function GoogleWorkspaceSettingsPage({ searchParams }: Props) {
  const cookieStore = await cookies();
  const serverApi = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  const params = await searchParams;

  let settings: SettingRow[] = [];
  try {
    const data = await serverApi.get<{ settings: SettingRow[] }>('/settings/google');
    settings = data.settings ?? [];
  } catch {
    // Not configured yet
  }

  let slot1: SlotStatus = { connected: false, resellerEmail: null };
  let slot2: SlotStatus = { connected: false, resellerEmail: null };
  try {
    const status = await serverApi.get<{ slot1?: SlotStatus; slot2?: SlotStatus; connected?: boolean }>('/google-workspace/status');
    slot1 = status.slot1 ?? { connected: status.connected ?? false, resellerEmail: null };
    slot2 = status.slot2 ?? { connected: false, resellerEmail: null };
  } catch {
    // ignore
  }

  const getValue = (k: string) => settings.find((s) => s.key === k)?.value ?? '';
  const isSet = (k: string) => (settings.find((s) => s.key === k)?.value ?? '').length > 0;

  const connectedSlot = params.connected ? Number(params.connected) : undefined;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Google Workspace Reseller</h1>
        <p className="text-sm text-slate-500 mt-1">
          एक या दो Google Reseller accounts connect करें। Domain sync पर system automatically
          दोनों accounts try करेगा और जो मिले वो save करेगा।
        </p>
      </div>

      {/* Setup Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 space-y-1.5">
        <p className="font-semibold">Setup Steps (each reseller account):</p>
        <ol className="list-decimal list-inside space-y-1 text-blue-700">
          <li>Google Cloud Console पर जाएं और एक project बनाएं</li>
          <li>APIs &amp; Services → Google Workspace Reseller API enable करें</li>
          <li>Credentials → OAuth 2.0 Client ID बनाएं (Web Application)</li>
          <li>
            Redirect URI add करें:{' '}
            <code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs font-mono">
              http://localhost:3001/api/google-workspace/auth/callback
            </code>
          </li>
          <li>Reseller Email + Client ID + Client Secret नीचे save करें</li>
          <li>"Connect Reseller N" button click करें और authorize करें</li>
        </ol>
      </div>

      {/* Slot 1 */}
      <GoogleResellerSlotCard
        slot={1}
        initialClientId={getValue('client_id')}
        initialClientSecret={getValue('client_secret')}
        initialResellerEmail={getValue('reseller_email')}
        isClientIdSet={isSet('client_id')}
        isClientSecretSet={isSet('client_secret')}
        isConnected={slot1.connected}
        connectedSlot={connectedSlot}
        error={params.error === '1'}
      />

      {/* Slot 2 */}
      <GoogleResellerSlotCard
        slot={2}
        initialClientId={getValue('client_id_2')}
        initialClientSecret={getValue('client_secret_2')}
        initialResellerEmail={getValue('reseller_email_2')}
        isClientIdSet={isSet('client_id_2')}
        isClientSecretSet={isSet('client_secret_2')}
        isConnected={slot2.connected}
        connectedSlot={connectedSlot}
        error={false}
      />
    </div>
  );
}
