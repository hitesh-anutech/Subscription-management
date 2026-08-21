'use client';

import { useState, useTransition } from 'react';
import { extractApiError } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

interface User  { id: string; name: string | null; email: string; role: string; allowedOrgIds: string[] | null }
interface Org   { id: string; name: string }

const ROLE_BADGE: Record<string, string> = {
  Admin:   'bg-red-100 text-red-700',
  Manager: 'bg-purple-100 text-purple-700',
  Sales:   'bg-blue-100 text-blue-700',
  Viewer:  'bg-slate-100 text-slate-600',
};

export function UserOrgPanel({ user, orgs }: { user: User; orgs: Org[] }) {
  // null = all orgs (no restriction)
  const [selected, setSelected] = useState<string[]>(user.allowedOrgIds ?? []);
  const [allOrgs, setAllOrgs]   = useState(!user.allowedOrgIds);
  const [saving,  setSaving]    = useState(false);
  const [saved,   setSaved]     = useState(false);
  const [error,   setError]     = useState<string | null>(null);
  const [, startTransition]     = useTransition();

  const toggle = (orgId: string) => {
    setSaved(false);
    setSelected((prev) =>
      prev.includes(orgId) ? prev.filter((id) => id !== orgId) : [...prev, orgId],
    );
  };

  const save = () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      try {
        const orgIds = allOrgs ? [] : selected;
        const res = await fetch(`${API_BASE}/users/${user.id}/org-access`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ org_ids: orgIds }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(extractApiError(body, 'Save failed'));
        } else {
          setSaved(true);
        }
      } catch {
        setError('Server से connect नहीं हो पाया');
      } finally {
        setSaving(false);
      }
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold text-slate-900">{user.name ?? user.email}</p>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${ROLE_BADGE[user.role] ?? 'bg-slate-100 text-slate-600'}`}>
              {user.role}
            </span>
            {saved && <span className="text-xs text-green-600">✅ Saved</span>}
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">{user.email}</p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Save Access'}
        </button>
      </div>

      {/* All orgs toggle */}
      <label className="flex items-center gap-2.5 mb-3 cursor-pointer">
        <input
          type="checkbox"
          checked={allOrgs}
          onChange={(e) => { setAllOrgs(e.target.checked); setSaved(false); }}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-sm font-medium text-slate-700">
          सभी Organizations का access दो
          <span className="ml-1.5 text-xs text-slate-400 font-normal">(Admin के लिए recommended)</span>
        </span>
      </label>

      {/* Per-org checkboxes */}
      {!allOrgs && (
        <div className="grid grid-cols-2 gap-2 pl-1">
          {orgs.length === 0 && (
            <p className="text-xs text-slate-400 col-span-2">कोई organization नहीं।</p>
          )}
          {orgs.map((org) => (
            <label key={org.id} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50 has-[:checked]:border-blue-300 has-[:checked]:bg-blue-50 transition-colors">
              <input
                type="checkbox"
                checked={selected.includes(org.id)}
                onChange={() => toggle(org.id)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-700">{org.name}</span>
            </label>
          ))}
        </div>
      )}

      {!allOrgs && selected.length === 0 && orgs.length > 0 && (
        <p className="text-xs text-amber-600 mt-2 pl-1">
          ⚠️ कोई org select नहीं — user को कोई data नहीं दिखेगा।
        </p>
      )}
    </div>
  );
}
