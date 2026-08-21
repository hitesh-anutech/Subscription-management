'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { syncCustomersAction } from '../actions';

export function ImportCustomersButton({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const onClick = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await syncCustomersAction(orgId);
      if (res.error) setMsg(`❌ ${res.error}`);
      else { setMsg(`✅ Synced ${res.synced ?? 0}`); router.refresh(); }
    });
  };

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
      <button type="button" onClick={onClick} disabled={pending}
        className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-sm font-semibold rounded-lg transition-colors">
        {pending ? 'Importing…' : '🔄 Import from Zoho'}
      </button>
    </div>
  );
}
