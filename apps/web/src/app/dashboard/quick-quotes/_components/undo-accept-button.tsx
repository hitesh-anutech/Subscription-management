'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { unacceptQuoteAction } from '../actions';

/** Shown only while status is Accepted (pre-convert) — reverts an accidental accept. */
export function UndoAcceptButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const onClick = () => {
    if (!confirm('Accept undo करें? Quote वापस Sent/Draft हो जाएगी और lead का status Won से Quoted हो जाएगा।')) return;
    setErr(null);
    startTransition(async () => {
      const res = await unacceptQuoteAction(quoteId);
      if (res.error) setErr(res.error);
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={onClick} disabled={pending}
        title="गलती से accept हो गई? वापस Sent/Draft पर ले जाओ"
        className="px-3.5 py-2 border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 text-sm font-medium rounded-lg transition-colors whitespace-nowrap">
        {pending ? 'Reverting…' : '↩ Undo Accept'}
      </button>
      {err && <span className="text-xs text-red-600 max-w-xs text-right">{err}</span>}
    </div>
  );
}
