'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState, useFormStatus } from 'react-dom';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

async function saveOrgEmailAction(
  orgId: string,
  _prev: { success?: boolean; error?: string } | null,
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const emailFromAddress = (formData.get('email_from_address') as string | null)?.trim() || null;
  const emailReplyTo     = (formData.get('email_reply_to')     as string | null)?.trim() || null;
  const smtpUser         = (formData.get('smtp_user')          as string | null)?.trim() || null;
  const smtpPasswordRaw  = (formData.get('smtp_password')      as string | null) ?? '';

  const body: Record<string, unknown> = { emailFromAddress, emailReplyTo, smtpUser };
  // Only send password when a new non-masked value is entered
  if (smtpPasswordRaw && !smtpPasswordRaw.includes('•')) {
    body.smtpPassword = smtpPasswordRaw;
  }

  try {
    const res = await fetch(`${API_BASE}/org-settings/${orgId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string }; message?: string };
      return { error: err.error?.message ?? err.message ?? `Save failed (HTTP ${res.status})` };
    }
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-semibold rounded-lg transition-colors">
      {pending ? 'Saving…' : 'Save Email Config'}
    </button>
  );
}

interface Props {
  orgId: string;
  currentFromAddress?: string | null;
  currentReplyTo?: string | null;
  currentSmtpUser?: string | null;
  isSmtpConfigured: boolean;
}

export function OrgEmailConfig({ orgId, currentFromAddress, currentReplyTo, currentSmtpUser, isSmtpConfigured }: Props) {
  const [open, setOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  const boundAction = saveOrgEmailAction.bind(null, orgId);
  const [state, action] = useFormState(
    async (_prev: { success?: boolean; error?: string } | null, fd: FormData) =>
      boundAction(_prev, fd),
    null,
  );

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state, router]);

  return (
    <div className="mt-3 pt-3 border-t border-slate-200">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1.5"
      >
        <span>{open ? '▾' : '▸'}</span>
        📧 Sender Email Config
        {currentFromAddress && (
          <span className="ml-1 text-blue-600 font-mono">{currentFromAddress}</span>
        )}
        {!currentFromAddress && (
          <span className="ml-1 text-amber-500">not configured</span>
        )}
        {isSmtpConfigured && (
          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">SMTP ✓</span>
        )}
      </button>

      {open && (
        <form action={action} className="mt-3 space-y-3">
          {state?.error && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded border border-red-200">{state.error}</p>
          )}
          {state?.success && (
            <p className="text-xs text-green-700 bg-green-50 px-3 py-2 rounded border border-green-200">✅ Saved!</p>
          )}

          {/* Gmail Address + App Password */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
            <p className="text-[11px] font-medium text-slate-600">Gmail SMTP Credentials</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Gmail Address
                  {isSmtpConfigured && <span className="ml-1 text-green-600">● Configured</span>}
                </label>
                <input
                  name="smtp_user"
                  type="email"
                  defaultValue={currentSmtpUser ?? ''}
                  placeholder="quotes@yourorg.in"
                  className="w-full px-3 py-2 border border-slate-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Gmail App Password
                </label>
                <div className="relative">
                  <input
                    name="smtp_password"
                    type={showPassword ? 'text' : 'password'}
                    defaultValue=""
                    placeholder={isSmtpConfigured ? 'New password = update, blank = keep' : 'xxxx xxxx xxxx xxxx'}
                    className="w-full px-3 py-2 pr-14 border border-slate-300 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 hover:text-slate-600">
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Google Account → Security → App Passwords → App: "Mail" → Generate। इस org के सभी emails इसी Gmail से जाएंगे।
            </p>
          </div>

          {/* From Address + Reply-To */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                From Email Address
                <span className="ml-1 text-slate-400 font-normal">(Gmail address से match होना चाहिए)</span>
              </label>
              <input
                name="email_from_address"
                type="email"
                defaultValue={currentFromAddress ?? ''}
                placeholder="quotes@yourorg.in"
                className="w-full px-3 py-2 border border-slate-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Reply-To Address</label>
              <input
                name="email_reply_to"
                type="email"
                defaultValue={currentReplyTo ?? ''}
                placeholder="support@yourorg.in"
                className="w-full px-3 py-2 border border-slate-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <SaveBtn />
        </form>
      )}
    </div>
  );
}
