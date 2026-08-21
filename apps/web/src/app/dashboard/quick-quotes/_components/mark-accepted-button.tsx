'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markAcceptedAction } from '../actions';

export function MarkAcceptedButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const onClick = () => {
    setErr(null);
    startTransition(async () => {
      const res = await markAcceptedAction(quoteId);
      if (res.error) setErr(res.error);
      else router.refresh(); // status → Accepted; Convert button appears
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={onClick} disabled={pending}
        className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap">
        {pending ? 'Accepting…' : '✓ Mark as Accepted'}
      </button>
      {err && <span className="text-xs text-red-600 max-w-xs text-right">{err}</span>}
    </div>
  );
}
