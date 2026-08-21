'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Power } from 'lucide-react';

export function DeactivateSubscriptionButton({
  subscriptionId,
  currentStatus,
}: {
  subscriptionId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const isActive = currentStatus === 'Active' || currentStatus === 'Expiring_Soon';
  const newStatus = isActive ? 'Inactive' : 'Active';
  const label = isActive ? 'Deactivate' : 'Activate';

  const handleClick = async () => {
    if (!confirm(`Are you sure you want to ${label.toLowerCase()} this subscription?`)) return;
    setLoading(true);
    try {
      const res = await fetch('/api/subscriptions/bulk-update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionIds: [subscriptionId], status: newStatus }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Update failed');
      }
      router.refresh();
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 ${
        isActive
          ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
          : 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
      }`}
    >
      <Power className="w-3.5 h-3.5" />
      {loading ? '…' : label}
    </button>
  );
}
