'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { loginAction } from '../actions';

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] disabled:from-slate-700 disabled:to-slate-800 text-white text-sm font-semibold shadow-lg shadow-blue-500/15 transition-all duration-200"
    >
      {pending ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Signing in…
        </span>
      ) : (
        'Sign in'
      )}
    </button>
  );
}

interface LoginFormProps {
  from?: string;
}

export function LoginForm({ from }: LoginFormProps) {
  const [state, action] = useFormState(
    async (_prev: { error?: string } | null, formData: FormData) => {
      if (from) formData.append('from', from);
      return loginAction(formData);
    },
    null,
  );

  return (
    <div className="bg-slate-900/60 backdrop-blur-xl rounded-3xl border border-slate-800 p-8 shadow-2xl relative">
      <div className="absolute top-0 right-8 -mt-3 flex space-x-1">
        <span className="h-1.5 w-8 rounded-full bg-blue-500/50" />
        <span className="h-1.5 w-3 rounded-full bg-indigo-500/50" />
      </div>

      <h2 className="text-xl font-bold text-slate-100 mb-6 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
        Sign in to your account
      </h2>

      {state?.error && (
        <div className="mb-5 px-4 py-3 rounded-xl bg-red-950/40 border border-red-900/50 text-red-400 text-sm flex items-start gap-2.5">
          <span className="text-base leading-none">⚠️</span>
          <span>{state.error}</span>
        </div>
      )}

      <form action={action} className="space-y-6">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-semibold text-slate-300 mb-2"
          >
            Email Address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@exceltechnologies.in"
            className="w-full px-4 py-3 rounded-xl bg-slate-950/40 border border-slate-800 text-slate-100 placeholder-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-transparent transition-all duration-200"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-semibold text-slate-300 mb-2"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className="w-full px-4 py-3 rounded-xl bg-slate-950/40 border border-slate-800 text-slate-100 placeholder-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-transparent transition-all duration-200"
          />
        </div>

        <SubmitBtn />
      </form>

      <p className="mt-6 text-[11px] text-center text-slate-500 tracking-wide font-medium uppercase">
        ⚡ Excel Technologies — Internal use only
      </p>
    </div>
  );
}

