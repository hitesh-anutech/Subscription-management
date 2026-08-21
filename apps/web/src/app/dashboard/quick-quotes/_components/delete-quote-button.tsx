'use client';

import { useState } from 'react';
import { deleteQuoteAction } from '../actions';

export function DeleteQuoteButton({ quoteId }: { quoteId: string }) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm('क्या आप सच में इस Quote को डिलीट करना चाहते हैं? इससे सारा संबंधित डेटा भी डिलीट हो जाएगा।')) {
      return;
    }
    setLoading(true);
    try {
      await deleteQuoteAction(quoteId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'डिलीट करने में त्रुटि आई');
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={loading}
      className="px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 disabled:bg-slate-100 disabled:text-slate-400 text-sm font-semibold rounded-lg transition-all active:scale-95 flex items-center gap-1.5"
    >
      🗑️ {loading ? 'Deleting...' : 'Delete Quote'}
    </button>
  );
}
