'use client';

import { useTransition } from 'react';
import { syncSingleCustomerAction } from '../../actions';

export function SyncCustomerButton({ orgId, zohoId }: { orgId: string; zohoId: string }) {
  const [isPending, startTransition] = useTransition();

  const handleSync = () => {
    startTransition(async () => {
      const res = await syncSingleCustomerAction(orgId, zohoId);
      if (res.error) {
        alert(res.error);
      }
    });
  };

  return (
    <button
      onClick={handleSync}
      disabled={isPending}
      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors border border-slate-300 disabled:opacity-50"
    >
      {isPending ? 'Syncing...' : 'Sync from Zoho'}
    </button>
  );
}
