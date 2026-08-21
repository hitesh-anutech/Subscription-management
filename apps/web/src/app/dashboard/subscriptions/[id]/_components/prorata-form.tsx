'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { generateProrataQuoteAction } from '../actions';

function SendBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-semibold rounded-lg transition-colors">
      {pending ? 'Calculating & Sending…' : '📐 Generate Pro-rata Quote'}
    </button>
  );
}

interface Props {
  subscriptionId: string;
  subscriptionPrice: number;
  endDate: string;
  billingCycle: string;
}

function calcProrata(price: number, cycle: string, additionalLicenses: number, effectiveDate: string, endDate: string) {
  const cycleDaysMap: Record<string, number> = {
    monthly: 30, quarterly: 90, half_yearly: 182, annual: 365, biennial: 730, triennial: 1095,
  };
  const cycleDays = cycleDaysMap[cycle] ?? 365;
  const periodDays = Math.max(0, Math.ceil(
    (new Date(endDate).getTime() - new Date(effectiveDate).getTime()) / 86_400_000,
  ));
  const dailyRate = price / cycleDays;
  const subtotal = Math.round(dailyRate * periodDays * additionalLicenses * 100) / 100;
  return { periodDays, dailyRate: Math.round(dailyRate * 100) / 100, subtotal };
}

export function ProrataForm({ subscriptionId, subscriptionPrice, endDate, billingCycle }: Props) {
  const [additionalLicenses, setAdditionalLicenses] = useState(1);
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]);

  const preview = effectiveDate && additionalLicenses > 0
    ? calcProrata(subscriptionPrice, billingCycle, additionalLicenses, effectiveDate, endDate)
    : null;

  const boundAction = generateProrataQuoteAction.bind(null, subscriptionId);
  const [state, action] = useFormState(
    async (_prev: { success?: boolean; error?: string; calculation?: Record<string, unknown>; zohoEstimateNumber?: string } | null, fd: FormData) =>
      boundAction(fd),
    null,
  );

  return (
    <form action={action} className="space-y-4">
      {state?.error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {state.error}
        </div>
      )}
      {state?.success && (
        <div className="px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
          ✅ Pro-rata quote Zoho में create हो गई!
          {state.zohoEstimateNumber && (
            <span className="ml-2 font-mono font-semibold">{state.zohoEstimateNumber}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Additional Licenses
          </label>
          <input
            name="additional_licenses"
            type="number"
            min={1}
            value={additionalLicenses}
            onChange={(e) => setAdditionalLicenses(Number(e.target.value))}
            className="w-full px-3 py-2 rounded border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Effective Date
          </label>
          <input
            name="effective_date"
            type="date"
            value={effectiveDate}
            max={endDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className="w-full px-3 py-2 rounded border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Live preview */}
      {preview && preview.periodDays > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 text-xs text-indigo-800 space-y-1">
          <p className="font-semibold">Pro-rata Preview</p>
          <p>Period: <strong>{preview.periodDays} days</strong> ({effectiveDate} → {endDate})</p>
          <p>Daily rate: ₹{preview.dailyRate} per license</p>
          <p className="text-sm font-bold text-indigo-900">
            Total: ₹{preview.subtotal.toLocaleString('en-IN')} for {additionalLicenses} license{additionalLicenses > 1 ? 's' : ''}
          </p>
        </div>
      )}

      <SendBtn />
    </form>
  );
}
