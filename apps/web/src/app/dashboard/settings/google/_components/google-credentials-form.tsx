'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { saveGoogleCredentialsAction, connectGoogleAction, disconnectGoogleAction } from '../actions';

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold transition-colors"
    >
      {pending ? 'Saving…' : 'Save Credentials'}
    </button>
  );
}

interface SlotProps {
  slot: 1 | 2;
  initialClientId: string;
  initialClientSecret: string;
  initialResellerEmail: string;
  isClientIdSet: boolean;
  isClientSecretSet: boolean;
  isConnected: boolean;
  connectedSlot?: number;  // from URL param after OAuth callback
  error?: boolean;
}

export function GoogleResellerSlotCard({
  slot,
  initialClientId,
  initialClientSecret,
  initialResellerEmail,
  isClientIdSet,
  isClientSecretSet,
  isConnected,
  connectedSlot,
  error,
}: SlotProps) {
  const [credState, credAction] = useFormState(
    async (_prev: { error?: string; success?: boolean } | null, formData: FormData) =>
      saveGoogleCredentialsAction(formData, slot),
    null,
  );

  const [connectState, setConnectState] = useState<{ loading?: boolean; error?: string } | null>(null);
  const [disconnectState, setDisconnectState] = useState<{ loading?: boolean } | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const bothSet = isClientIdSet && isClientSecretSet;
  const justConnected = connectedSlot === slot;

  async function handleConnect() {
    setConnectState({ loading: true });
    const result = await connectGoogleAction(slot);
    if (result?.error) {
      setConnectState({ error: result.error });
    } else if (result?.authorize_url) {
      window.location.href = result.authorize_url;
    }
  }

  async function handleDisconnect() {
    setDisconnectState({ loading: true });
    await disconnectGoogleAction(slot);
    setDisconnectState(null);
    window.location.reload();
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-center gap-2.5">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          <h2 className="text-sm font-semibold text-slate-800">Reseller Account {slot}</h2>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
          isConnected ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {isConnected ? '● Connected' : '● Not Connected'}
        </span>
      </div>

      <div className="px-6 py-5 space-y-5">
        {justConnected && (
          <div className="px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
            ✅ Reseller Account {slot} successfully connect हो गया!
          </div>
        )}
        {error && slot === 1 && (
          <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            ❌ Google OAuth failed. Client credentials verify करें और फिर try करें।
          </div>
        )}
        {connectState?.error && (
          <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {connectState.error}
          </div>
        )}
        {credState?.error && (
          <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {credState.error}
          </div>
        )}
        {credState?.success && (
          <div className="px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
            ✅ Credentials save हो गए!
          </div>
        )}

        {/* Credentials form */}
        <form action={credAction} className="space-y-4">
          {/* Reseller Email */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Reseller Admin Email
              {initialResellerEmail && <span className="ml-2 text-xs text-green-600 font-normal">● Set</span>}
            </label>
            <input
              name="reseller_email"
              type="email"
              defaultValue={initialResellerEmail}
              placeholder="info@reseller.yourdomain.com"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">इस reseller account का admin email — subscriptions column में दिखेगा।</p>
          </div>

          {/* Client ID */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Client ID
              {isClientIdSet && <span className="ml-2 text-xs text-green-600 font-normal">● Set</span>}
            </label>
            <input
              name="client_id"
              type="text"
              defaultValue={initialClientId}
              placeholder={isClientIdSet ? 'New value डालो तभी update होगा' : '1234567890-xxxxxxxx.apps.googleusercontent.com'}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Client Secret */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Client Secret
              {isClientSecretSet && <span className="ml-2 text-xs text-green-600 font-normal">● Set (encrypted)</span>}
            </label>
            <div className="relative">
              <input
                name="client_secret"
                type={showSecret ? 'text' : 'password'}
                defaultValue={initialClientSecret}
                placeholder={isClientSecretSet ? 'New value डालो तभी update होगा' : 'GOCSPX-xxxxxxxxxxxxxxxx'}
                className="w-full px-3.5 py-2.5 pr-20 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-700"
              >
                {showSecret ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">Database में AES-256-GCM से encrypted store होता है।</p>
          </div>

          <div className="pt-1">
            <SubmitBtn />
          </div>
        </form>

        {/* Connect / Disconnect */}
        <div className="pt-3 border-t border-slate-100 flex gap-3">
          {!isConnected ? (
            <button
              type="button"
              onClick={handleConnect}
              disabled={!bothSet || !!connectState?.loading}
              className="px-5 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white text-sm font-semibold transition-colors"
            >
              {connectState?.loading ? 'Redirecting…' : `Connect Reseller ${slot}`}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={!!disconnectState?.loading}
              className="px-5 py-2.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 text-sm font-semibold transition-colors"
            >
              {disconnectState?.loading ? 'Disconnecting…' : 'Disconnect'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Keep backwards-compatible export for any existing imports
export { GoogleResellerSlotCard as GoogleCredentialsForm };
