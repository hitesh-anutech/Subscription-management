'use client';

import { useTransition } from 'react';
import { syncLeadToZohoAction } from '../../actions';

export function SyncZohoButton({ leadId }: { leadId: string }) {
  const [isPending, startTransition] = useTransition();

  const handleSync = () => {
    startTransition(async () => {
      const res = await syncLeadToZohoAction(leadId);
      if (res.error) {
        alert(res.error);
      } else {
        alert('Zoho Books successfully updated!');
      }
    });
  };

  return (
    <button
      onClick={handleSync}
      disabled={isPending}
      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors border border-slate-300 disabled:opacity-50"
    >
      {isPending ? 'Syncing...' : 'Update in Zoho'}
    </button>
  );
}
