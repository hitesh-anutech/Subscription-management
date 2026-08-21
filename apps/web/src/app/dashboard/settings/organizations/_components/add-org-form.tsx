'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createOrganization, type ActionState } from '../actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
    >
      {pending ? 'Adding…' : 'Add Organization'}
    </button>
  );
}

export function AddOrgForm() {
  const [state, formAction] = useFormState<ActionState, FormData>(createOrganization, null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full border-2 border-dashed border-slate-300 py-4 rounded text-slate-600 hover:bg-slate-50"
      >
        + Add New Organization
      </button>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="bg-white border border-slate-200 rounded p-4 space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-slate-900">Add new Zoho Books organization</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-slate-400 hover:text-slate-600 text-sm"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-600 font-medium">Display Name *</label>
          <input
            name="name"
            type="text"
            required
            minLength={2}
            maxLength={150}
            placeholder="e.g. ExcelTech India"
            className="border w-full px-3 py-2 rounded mt-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-slate-600 font-medium">Zoho Org ID *</label>
          <input
            name="zoho_org_id"
            type="text"
            required
            placeholder="e.g. 60000000123"
            className="border w-full px-3 py-2 rounded mt-1 text-sm font-mono"
          />
          <p className="text-xs text-slate-500 mt-1">Find in Zoho Books → Settings → Org Details</p>
        </div>
        <div>
          <label className="text-xs text-slate-600 font-medium">Data Center</label>
          <select
            name="data_center"
            defaultValue="in"
            className="border w-full px-3 py-2 rounded mt-1 text-sm bg-white"
          >
            <option value="in">India (.in)</option>
            <option value="com">US (.com)</option>
            <option value="eu">EU (.eu)</option>
            <option value="com.au">Australia (.com.au)</option>
            <option value="jp">Japan (.jp)</option>
            <option value="sa">Saudi Arabia (.sa)</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-600 font-medium">Base Currency</label>
          <input
            name="base_currency"
            type="text"
            defaultValue="INR"
            maxLength={10}
            className="border w-full px-3 py-2 rounded mt-1 text-sm"
          />
        </div>
      </div>

      {state?.error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded">
          {state.error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="border border-slate-300 px-4 py-2 rounded text-sm hover:bg-slate-50"
        >
          Cancel
        </button>
        <SubmitButton />
      </div>

      <p className="text-xs text-slate-500 border-t pt-2">
        Org create होने के बाद "Connect Zoho" button से OAuth flow shuru होगा.
      </p>
    </form>
  );
}
