'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export function PageSizeSelector({ current }: { current: number }) {
  const router = useRouter();
  const sp = useSearchParams();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams(sp.toString());
    params.set('limit', e.target.value);
    params.delete('page');
    router.push(`?${params.toString()}`);
  };

  return (
    <select
      value={String(current)}
      onChange={handleChange}
      className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold bg-white text-slate-600 focus:ring-2 focus:ring-blue-500/20 focus:outline-none cursor-pointer"
    >
      <option value="25">25 / page</option>
      <option value="50">50 / page</option>
      <option value="100">100 / page</option>
      <option value="200">200 / page</option>
      <option value="500">500 / page</option>
    </select>
  );
}
