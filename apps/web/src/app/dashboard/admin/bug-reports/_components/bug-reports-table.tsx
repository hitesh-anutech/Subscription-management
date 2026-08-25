'use client';

import { useState } from 'react';
import { Bug, Lightbulb, Paintbrush, ChevronDown, Trash2, ImageIcon, X, Search } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

type BugReportType   = 'Bug' | 'Feature' | 'UIPolish';
type BugSeverity     = 'Low' | 'Medium' | 'High' | 'Critical';
type BugReportStatus = 'Open' | 'InProgress' | 'Resolved' | 'Closed';

interface BugReport {
  id:          string;
  bugNumber:   number;
  type:        BugReportType;
  severity:    BugSeverity;
  details:     string;
  pageUrl:     string | null;
  screenshots: string[];
  status:      BugReportStatus;
  adminNote:   string | null;
  reportedBy:  { id: string; name: string | null; email: string } | null;
  createdAt:   string;
}

const TYPE_META: Record<BugReportType, { label: string; icon: React.ReactNode; color: string }> = {
  Bug:      { label: 'Bug / Error',  icon: <Bug size={11} />,        color: 'bg-red-100 text-red-700' },
  Feature:  { label: 'Feature Idea', icon: <Lightbulb size={11} />,  color: 'bg-amber-100 text-amber-700' },
  UIPolish: { label: 'UI Polish',    icon: <Paintbrush size={11} />, color: 'bg-purple-100 text-purple-700' },
};

const SEV_META: Record<BugSeverity, string> = {
  Low:      'bg-slate-100 text-slate-600',
  Medium:   'bg-blue-100 text-blue-700',
  High:     'bg-orange-100 text-orange-700',
  Critical: 'bg-red-100 text-red-700',
};

const STATUS_OPTS: { value: BugReportStatus; label: string; color: string }[] = [
  { value: 'Open',       label: 'Open',        color: 'bg-yellow-100 text-yellow-700' },
  { value: 'InProgress', label: 'In Progress', color: 'bg-blue-100 text-blue-700' },
  { value: 'Resolved',   label: 'Resolved',    color: 'bg-green-100 text-green-700' },
  { value: 'Closed',     label: 'Closed',      color: 'bg-slate-100 text-slate-500' },
];

function bugLabel(n: number) { return `#${String(n).padStart(3, '0')}`; }

function ScreenshotModal({ shots, onClose }: { shots: string[]; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  return (
    <div className="fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-9 right-0 text-white/70 hover:text-white flex items-center gap-1 text-xs">
          <X size={16} /> Close
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shots[idx]} alt={`Screenshot ${idx + 1}`} className="w-full rounded-xl shadow-2xl border border-white/10" />
        {shots.length > 1 && (
          <div className="flex justify-center gap-2 mt-3">
            {shots.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={`w-2.5 h-2.5 rounded-full transition-colors ${i === idx ? 'bg-white' : 'bg-white/40'}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function BugReportsTable({ initial }: { initial: BugReport[] }) {
  const [reports, setReports]     = useState<BugReport[]>(initial);
  const [search, setSearch]       = useState('');
  const [filter, setFilter]       = useState<{ status: string; type: string; severity: string }>({ status: '', type: '', severity: '' });
  const [noteEdit, setNoteEdit]   = useState<Record<string, string>>({});
  const [saving, setSaving]       = useState<Record<string, boolean>>({});
  const [shotModal, setShotModal] = useState<string[] | null>(null);
  const [expanded, setExpanded]   = useState<string | null>(null);

  const filtered = reports.filter((r) => {
    if (filter.status   && r.status   !== filter.status)   return false;
    if (filter.type     && r.type     !== filter.type)     return false;
    if (filter.severity && r.severity !== filter.severity) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase().replace(/^#/, '');
      const num = parseInt(q, 10);
      if (!isNaN(num)) return r.bugNumber === num;
      return r.details.toLowerCase().includes(q) ||
             (r.pageUrl ?? '').toLowerCase().includes(q) ||
             (r.reportedBy?.name ?? '').toLowerCase().includes(q) ||
             (r.reportedBy?.email ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  const updateStatus = async (id: string, status: BugReportStatus) => {
    setSaving((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch(`${API_BASE}/bug-reports/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      setReports((p) => p.map((r) => r.id === id ? { ...r, status } : r));
    } finally {
      setSaving((p) => ({ ...p, [id]: false }));
    }
  };

  const saveNote = async (id: string) => {
    const note = noteEdit[id] ?? '';
    setSaving((p) => ({ ...p, [`note_${id}`]: true }));
    try {
      const res = await fetch(`${API_BASE}/bug-reports/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ adminNote: note }),
      });
      if (!res.ok) return;
      setReports((p) => p.map((r) => r.id === id ? { ...r, adminNote: note } : r));
      setNoteEdit((p) => { const n = { ...p }; delete n[id]; return n; });
    } finally {
      setSaving((p) => ({ ...p, [`note_${id}`]: false }));
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this report?')) return;
    setSaving((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch(`${API_BASE}/bug-reports/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok && res.status !== 204) return;
      setReports((p) => p.filter((r) => r.id !== id));
    } finally {
      setSaving((p) => ({ ...p, [id]: false }));
    }
  };

  return (
    <div className="space-y-4">
      {/* Search + Filters */}
      <div className="flex flex-wrap gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search or type #001…"
            className="text-xs border border-slate-200 rounded-lg pl-7 pr-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400 w-44"
          />
        </div>
        <select value={filter.status} onChange={(e) => setFilter((p) => ({ ...p, status: e.target.value }))}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400">
          <option value="">All Status</option>
          {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filter.type} onChange={(e) => setFilter((p) => ({ ...p, type: e.target.value }))}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400">
          <option value="">All Types</option>
          <option value="Bug">Bug / Error</option>
          <option value="Feature">Feature Idea</option>
          <option value="UIPolish">UI Polish</option>
        </select>
        <select value={filter.severity} onChange={(e) => setFilter((p) => ({ ...p, severity: e.target.value }))}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400">
          <option value="">All Severity</option>
          <option value="Low">Low</option>
          <option value="Medium">Medium</option>
          <option value="High">High</option>
          <option value="Critical">Critical</option>
        </select>
        <span className="ml-auto text-xs text-slate-400 self-center">
          {filtered.length} of {reports.length} report{reports.length !== 1 ? 's' : ''}
        </span>
      </div>

      {filtered.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-12 text-center text-slate-400 text-sm">
          {search ? `No report found matching "${search}"` : 'No reports found.'}
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((r) => {
          const tm       = TYPE_META[r.type];
          const sm       = SEV_META[r.severity];
          const st       = STATUS_OPTS.find((o) => o.value === r.status)!;
          const isExpanded = expanded === r.id;
          const noteVal  = noteEdit[r.id] ?? r.adminNote ?? '';
          const noteChanged = r.id in noteEdit;

          return (
            <div key={r.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              {/* Row */}
              <div className="flex items-start gap-3 px-4 py-4">

                {/* Bug number badge */}
                <div className="shrink-0 flex flex-col items-center justify-center bg-orange-50 border border-orange-200 rounded-xl px-2.5 py-2 min-w-[52px]">
                  <span className="text-[9px] font-bold text-orange-400 uppercase tracking-widest">BUG</span>
                  <span className="text-base font-black text-orange-600 leading-none">{bugLabel(r.bugNumber)}</span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${tm.color}`}>
                      {tm.icon}{tm.label}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${sm}`}>
                      {r.severity}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${st.color}`}>
                      {r.status === 'InProgress' ? 'In Progress' : r.status}
                    </span>
                    {r.screenshots.length > 0 && (
                      <button
                        onClick={() => setShotModal(r.screenshots)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                      >
                        <ImageIcon size={10} />{r.screenshots.length} screenshot{r.screenshots.length > 1 ? 's' : ''}
                      </button>
                    )}
                  </div>
                  <p className={`text-sm text-slate-800 ${isExpanded ? '' : 'line-clamp-2'}`}>{r.details}</p>
                  <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-slate-400">
                    {r.pageUrl && <span title={r.pageUrl}>📍 {r.pageUrl}</span>}
                    <span>👤 {r.reportedBy?.name ?? r.reportedBy?.email ?? 'Anonymous'}</span>
                    <span>🕐 {new Date(r.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  {r.adminNote && !isExpanded && (
                    <p className="mt-1.5 text-[10px] text-slate-500 italic bg-slate-50 px-2 py-1 rounded-lg">
                      📝 {r.adminNote}
                    </p>
                  )}
                </div>

                <button
                  onClick={() => setExpanded(isExpanded ? null : r.id)}
                  className="text-slate-400 hover:text-slate-600 transition-colors mt-0.5 shrink-0"
                >
                  <ChevronDown size={16} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {/* Expanded panel */}
              {isExpanded && (
                <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/60 space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">Change Status</label>
                    <div className="flex flex-wrap gap-2">
                      {STATUS_OPTS.map((o) => (
                        <button
                          key={o.value}
                          disabled={saving[r.id]}
                          onClick={() => updateStatus(r.id, o.value)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all
                            ${r.status === o.value ? o.color + ' ring-2 ring-current ring-offset-1' : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'}`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 block">Admin Note</label>
                    <div className="flex gap-2">
                      <textarea
                        rows={2}
                        value={noteVal}
                        onChange={(e) => setNoteEdit((p) => ({ ...p, [r.id]: e.target.value }))}
                        placeholder="Add a note for the team…"
                        className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                      />
                      {noteChanged && (
                        <button
                          onClick={() => saveNote(r.id)}
                          disabled={saving[`note_${r.id}`]}
                          className="px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50 self-end"
                        >
                          {saving[`note_${r.id}`] ? '…' : 'Save'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-mono text-slate-300 select-all">{r.id}</span>
                    <button
                      onClick={() => remove(r.id)}
                      disabled={saving[r.id]}
                      className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={12} />Delete report
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {shotModal && <ScreenshotModal shots={shotModal} onClose={() => setShotModal(null)} />}
    </div>
  );
}
