'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export function SubscriptionSearchInput({ defaultValue }: { defaultValue?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (value) { params.set('search', value); } else { params.delete('search'); }
      params.set('page', '1');
      router.replace(`/dashboard/subscriptions?${params.toString()}`);
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <input
      name="search"
      type="text"
      value={value}
      onChange={e => setValue(e.target.value)}
      placeholder="Search customer, domain, item…"
      className="flex-1 min-w-48 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-slate-50/50"
    />
  );
}
