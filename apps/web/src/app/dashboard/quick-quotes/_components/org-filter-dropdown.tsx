'use client';

import { useRouter } from 'next/navigation';

interface Org { id: string; name: string }

interface OrgFilterDropdownProps {
  orgs: Org[];
  selectedOrgId?: string;
  currentStatus?: string;
}

export function OrgFilterDropdown({ orgs, selectedOrgId, currentStatus }: OrgFilterDropdownProps) {
  const router = useRouter();

  const handleChange = (orgId: string) => {
    const qs = new URLSearchParams();
    if (orgId) qs.set('org_id', orgId);
    if (currentStatus) qs.set('status', currentStatus);
    router.push(`/dashboard/quick-quotes${qs.toString() ? `?${qs}` : ''}` as never);
  };

  return (
    <select
      value={selectedOrgId ?? ''}
      onChange={(e) => handleChange(e.target.value)}
      className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
    >
      <option value="">All Orgs</option>
      {orgs.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}
