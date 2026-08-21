'use client';

import { useMemo, useState } from 'react';

export interface CustomizableColumn {
  key: string;
  label: string;
  group: 'standard' | 'custom' | 'app';
  type?: string;
}

const GROUP_LABELS: Record<CustomizableColumn['group'], string> = {
  standard: 'STANDARD',
  custom: 'CUSTOM FIELDS',
  app: 'APP DATA',
};

/** Reorderable column picker — mirrors Zoho's "Customize Columns". Reused across list views. */
export function CustomizeColumnsModal({
  columns,
  selected,
  onApply,
  onClose,
}: {
  columns: CustomizableColumn[];
  selected: string[];
  onApply: (keys: string[]) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<string[]>(selected.filter(k => columns.some(c => c.key === k)));
  const [search, setSearch] = useState('');

  const byKey = useMemo(() => new Map(columns.map(c => [c.key, c])), [columns]);
  const available = columns.filter(
    c => !chosen.includes(c.key) && c.label.toLowerCase().includes(search.toLowerCase()),
  );
  const groups: CustomizableColumn['group'][] = ['standard', 'custom', 'app'];

  const add    = (key: string) => setChosen(prev => [...prev, key]);
  const remove = (key: string) => setChosen(prev => prev.filter(k => k !== key));
  const move   = (i: number, dir: -1 | 1) => setChosen(prev => {
    const next = [...prev];
    const j = i + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const AvailRow = ({ c }: { c: CustomizableColumn }) => (
    <button
      type="button"
      onClick={() => add(c.key)}
      className="w-full flex items-center justify-between px-3 py-1.5 rounded hover:bg-blue-50 text-left text-sm text-slate-700"
    >
      <span>{c.label}</span>
      <span className="text-blue-500 font-bold">+</span>
    </button>
  );

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">⚙ Customize Columns</h2>
          <span className="text-xs text-slate-500">{chosen.length} selected</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 grid grid-cols-2 gap-0 overflow-hidden">
          {/* Selected (ordered) */}
          <div className="border-r border-slate-100 flex flex-col overflow-hidden">
            <div className="px-4 py-2 text-xs font-semibold text-slate-500 bg-slate-50 border-b border-slate-100">
              SELECTED (order = column order)
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {chosen.length === 0 && <p className="text-xs text-slate-400 px-3 py-4">Koi column selected nahi.</p>}
              {chosen.map((key, i) => {
                const c = byKey.get(key);
                if (!c) return null;
                return (
                  <div key={key} className="flex items-center gap-1 px-2 py-1 rounded bg-slate-50 text-sm">
                    <span className="flex-1 truncate text-slate-700">
                      {c.label}
                      {c.group === 'custom' && <span className="ml-1 text-[10px] text-purple-500">CF</span>}
                      {c.group === 'app' && <span className="ml-1 text-[10px] text-emerald-500">APP</span>}
                    </span>
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                      className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30">↑</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === chosen.length - 1}
                      className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30">↓</button>
                    <button type="button" onClick={() => remove(key)}
                      className="px-1 text-red-400 hover:text-red-600">×</button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Available */}
          <div className="flex flex-col overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-100">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search columns…"
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {groups.map(g => {
                const items = available.filter(c => c.group === g);
                if (items.length === 0) return null;
                return (
                  <div key={g}>
                    <p className="text-[11px] font-semibold text-slate-400 px-3 pt-2 pb-0.5">{GROUP_LABELS[g]}</p>
                    {items.map(c => <AvailRow key={c.key} c={c} />)}
                  </div>
                );
              })}
              {available.length === 0 && <p className="text-xs text-slate-400 px-3 py-4">Sab columns selected hain.</p>}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setChosen(columns.map(c => c.key))}
            className="text-xs text-slate-500 hover:underline"
          >
            Select all
          </button>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">
              Cancel
            </button>
            <button
              onClick={() => onApply(chosen)}
              disabled={chosen.length === 0}
              className="px-5 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
