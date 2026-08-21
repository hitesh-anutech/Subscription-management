'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { saveZohoCredentialsAction } from '../actions';

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

interface Props {
  initialClientId: string;
  initialClientSecret: string;
  isClientIdSet: boolean;
  isClientSecretSet: boolean;
}

export function ZohoCredentialsForm({ initialClientId, initialClientSecret, isClientIdSet, isClientSecretSet }: Props) {
  const [state, action] = useFormState(
    async (_prev: { error?: string; success?: boolean } | null, formData: FormData) =>
      saveZohoCredentialsAction(formData),
    null,
  );

  const [showSecret, setShowSecret] = useState(false);
  const bothSet = isClientIdSet && isClientSecretSet;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-slate-800">Self-Client Credentials</h2>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
          bothSet ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {bothSet ? '● Configured' : '● Not configured'}
        </span>
      </div>

      {state?.error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {state.error}
        </div>
      )}
      {state?.success && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
          ✅ Credentials save हो गए!
        </div>
      )}

      <form action={action} className="space-y-5">
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
            placeholder={isClientIdSet ? 'New value डालो तभी update होगा' : '1000.XXXXXXXXXXXXXXXXXX'}
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
              placeholder={isClientSecretSet ? 'New value डालो तभी update होगा' : 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
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

        <div className="pt-2">
          <SubmitBtn />
        </div>
      </form>
    </div>
  );
}
