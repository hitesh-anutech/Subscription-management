'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { saveEmailSettingsAction, sendTestEmailAction } from '../actions';

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold transition-colors">
      {pending ? 'Saving…' : 'Save Settings'}
    </button>
  );
}

function TestBtn({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} title={disabled ? 'पहले App Password save करो' : ''}
      className="px-4 py-2.5 rounded-lg bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 text-white text-sm font-semibold transition-colors">
      {pending ? 'Sending…' : 'Send Test'}
    </button>
  );
}

interface Props {
  initialSmtpUser: string;
  initialSmtpPassword: string;
  initialFromAddress: string;
  initialFromName: string;
  initialReplyTo: string;
  isSmtpConfigured: boolean;
}

export function EmailSettingsForm({
  initialSmtpUser, initialSmtpPassword,
  initialFromAddress, initialFromName, initialReplyTo,
  isSmtpConfigured,
}: Props) {
  const [saveState, saveAction] = useFormState(
    async (_prev: { error?: string; success?: boolean } | null, formData: FormData) =>
      saveEmailSettingsAction(formData),
    null,
  );

  const [testState, testAction] = useFormState(
    async (_prev: { success: boolean; message: string } | { error: string } | null, formData: FormData) =>
      sendTestEmailAction(formData),
    null,
  );

  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="space-y-6">
      {/* Main settings card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-1">Gmail SMTP Configuration</h2>
        <p className="text-xs text-slate-400 mb-5">
          Gmail account का regular password नहीं — <strong>App Password</strong> चाहिए।
          Google Account → Security → 2-Step Verification ON करो, फिर App Passwords से generate करो।
        </p>

        {saveState?.error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {saveState.error}
          </div>
        )}
        {saveState?.success && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
            ✅ Settings save हो गईं!
          </div>
        )}

        <form action={saveAction} className="space-y-5">
          {/* Gmail Address */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Gmail Address
            </label>
            <input
              name="smtp_user"
              type="email"
              defaultValue={initialSmtpUser}
              placeholder="quotes@anutech.in"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">
              वह Gmail / Google Workspace address जिससे emails भेजे जाएंगे।
            </p>
          </div>

          {/* App Password */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Gmail App Password
              {isSmtpConfigured && (
                <span className="ml-2 text-xs text-green-600 font-normal">● Configured</span>
              )}
            </label>
            <div className="relative">
              <input
                name="smtp_password"
                type={showPassword ? 'text' : 'password'}
                defaultValue={initialSmtpPassword}
                placeholder={isSmtpConfigured ? 'New password डालो तभी update होगा' : 'xxxx xxxx xxxx xxxx'}
                className="w-full px-3.5 py-2.5 pr-20 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-700"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Google Account → Security → App Passwords → App: "Mail", Device: "Other" → Generate।
              16-character code मिलेगा (spaces के साथ या बिना — दोनों चलते हैं)।
              {isSmtpConfigured && ' Blank छोड़ो तो current password रहेगा।'}
            </p>
          </div>

          {/* From Address */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Default From Email Address
            </label>
            <input
              name="from_address"
              type="email"
              defaultValue={initialFromAddress}
              placeholder="quotes@anutech.in"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">
              Gmail SMTP में यह Gmail Address के साथ match होना चाहिए। हर Organization का अपना sender चाहिए तो
              Settings → Organizations → 📧 Sender Email Config में per-org From set करो।
            </p>
          </div>

          {/* From Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Default From Display Name
            </label>
            <input
              name="from_name"
              type="text"
              defaultValue={initialFromName}
              placeholder="Excel Technologies"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">
              Per-org sender set हो तो From name उस org का Display Name होता है।
            </p>
          </div>

          {/* Reply-to */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Reply-To Address
              <span className="ml-1.5 text-xs text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              name="reply_to"
              type="email"
              defaultValue={initialReplyTo}
              placeholder="hitesh@exceltechnologies.in"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">
              Customer reply करे तो यह address use होगा। Blank रहा तो From address use होगा।
            </p>
          </div>

          <div className="pt-2">
            <SaveBtn />
          </div>
        </form>
      </div>

      {/* Test email card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-1">Test Email</h2>
        <p className="text-sm text-slate-500 mb-4">
          Gmail SMTP configuration verify करने के लिए test email भेजो।
        </p>

        {testState && (
          <div className={`mb-4 px-4 py-3 rounded-lg text-sm border ${
            'success' in testState && testState.success
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            {'success' in testState && testState.success ? '✅ ' : '❌ '}
            {'message' in testState ? testState.message : testState.error}
          </div>
        )}

        <form action={testAction} className="flex gap-3">
          <input
            name="test_email"
            type="email"
            placeholder="test@example.com"
            className="flex-1 px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <TestBtn disabled={!isSmtpConfigured} />
        </form>
      </div>
    </div>
  );
}
