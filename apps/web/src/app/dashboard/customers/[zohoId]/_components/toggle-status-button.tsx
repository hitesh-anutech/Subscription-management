'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function ToggleStatusButton({ id, currentStatus }: { id: string; currentStatus: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
    if (!confirm(`Are you sure you want to change status to ${newStatus}?`)) return;

    setLoading(true);
    try {
      const res = await fetch('/api/subscriptions/bulk-update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionIds: [id], status: newStatus }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Update failed');
      }
      router.refresh();
    } catch (err: any) {
      alert(`Error: ${(err as any).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={`ml-3 text-xs font-semibold px-2 py-1 rounded border ${currentStatus === 'Active' ? 'text-red-600 border-red-200 hover:bg-red-50' : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50'} disabled:opacity-50`}
    >
      {loading ? '...' : (currentStatus === 'Active' ? 'Deactivate' : 'Activate')}
    </button>
  );
}
