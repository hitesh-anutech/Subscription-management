'use client';

import { useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

interface Org { id: string; name: string }

type LineResult = {
  lineOrder: number; name: string; domain: string;
  startDate: string; endDate: string; qty: number; rate: number;
  suggestedSubId: string | null; suggestedSubNumber: string | null;
  suggestedSubDomain: string | null; endDateDeltaDays: number | null;
};

type DocResult = {
  docKey: string; zohoCustomerId: string;
  quoteNumber: string | null; invoiceNumber: string | null;
  quoteDate: string | null; invoiceDate: string | null;
  businessType: string | null; confidence: 'HIGH' | 'MEDIUM';
  lines: LineResult[];
};

type BulkMapResult = {
  summary: {
    totalDocsScanned: number; alreadyMapped: number;
    high: number; medium: number; low: number;
    appliedCount: number; skippedByValidation: number;
  };
  reviewQueue: DocResult[];
  errors: { docKey: string; error: string }[];
  dryRun: boolean;
  processedAt: string;
};

type LineState = 'confirmed' | 'skipped';

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Review card for a single document ─────────────────────────────────────────
function ReviewCard({ doc, orgId, onApplied }: { doc: DocResult; orgId: string; onApplied: () => void }) {
  const [lineStates, setLineStates] = useState<Record<number, LineState>>(() =>
    Object.fromEntries(doc.lines.map(l => [l.lineOrder, l.suggestedSubId ? 'confirmed' : 'skipped'])),
  );
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  const toggle = (order: number) =>
    setLineStates(prev => ({ ...prev, [order]: prev[order] === 'confirmed' ? 'skipped' : 'confirmed' }));

  const applyConfirmed = async () => {
    const confirmed = doc.lines.filter(l => lineStates[l.lineOrder] === 'confirmed' && l.suggestedSubId);
    if (confirmed.length === 0) { setDone(true); return; }
    setApplying(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/organizations/${orgId}/create-doc-history`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteNumber:   doc.quoteNumber,
          quoteDate:     doc.quoteDate,
          invoiceNumber: doc.invoiceNumber,
          invoiceDate:   doc.invoiceDate,
          businessType:  doc.businessType ?? 'Renewal',
          mappings: confirmed.map(l => ({
            subId:          l.suggestedSubId,
            startDate:      l.startDate,
            endDate:        l.endDate,
            qty:            l.qty,
            rate:           l.rate,
            lineItemDomain: l.domain,
          })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDone(true); onApplied();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setApplying(false);
    }
  };

  if (done) {
    return (
      <div className="border border-emerald-200 bg-emerald-50/60 rounded-xl px-4 py-3 text-xs text-emerald-700 font-semibold flex items-center gap-2">
        <span>✅</span>
        <span>{doc.quoteNumber ?? doc.invoiceNumber} — Applied</span>
      </div>
    );
  }

  const confidenceBadge = doc.confidence === 'HIGH'
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-amber-100 text-amber-700';

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <div className="bg-slate-50/80 px-4 py-2.5 flex items-center justify-between border-b border-slate-100">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wide ${confidenceBadge}`}>
            {doc.confidence}
          </span>
          <span className="text-xs font-bold text-slate-800 font-mono truncate">
            {doc.quoteNumber ?? doc.invoiceNumber ?? doc.docKey}
          </span>
          {doc.quoteDate && <span className="text-[10px] text-slate-400">{fmtDate(doc.quoteDate)}</span>}
        </div>
        <span className="text-[10px] text-slate-400 shrink-0 ml-2">{doc.lines.length} line{doc.lines.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="divide-y divide-slate-100">
        {doc.lines.map(line => {
          const state = lineStates[line.lineOrder];
          const hasMatch = !!line.suggestedSubId;
          return (
            <div key={line.lineOrder} className={`px-4 py-3 flex items-center gap-3 ${state === 'skipped' ? 'opacity-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-700 truncate">{line.name || '—'}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  <span className="font-semibold text-slate-600">{line.domain || '—'}</span>
                  {line.endDate && <> · Ends {fmtDate(line.endDate)}</>}
                  {' · '}Qty {line.qty} · ₹{line.rate}
                </p>
              </div>
              {hasMatch ? (
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-slate-700">{line.suggestedSubNumber}</p>
                    {line.endDateDeltaDays !== null && (
                      <p className={`text-[9px] font-semibold ${line.endDateDeltaDays <= 30 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        Δ {line.endDateDeltaDays}d
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={() => toggle(line.lineOrder)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors ${
                      state === 'confirmed'
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}>
                    {state === 'confirmed' ? '✓ Confirm' : '○ Skip'}
                  </button>
                </div>
              ) : (
                <span className="text-[10px] text-slate-400 shrink-0">No match</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
        {err && <p className="text-[10px] text-red-600 font-semibold">{err}</p>}
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={() => setDone(true)}
            className="text-[10px] text-slate-400 font-bold hover:text-slate-600 transition-colors">
            Skip All
          </button>
          <button type="button" onClick={() => void applyConfirmed()} disabled={applying}
            className="px-3 py-1.5 bg-[#286FAD] hover:bg-[#1e5a8f] disabled:opacity-60 text-white text-[10px] font-bold rounded-lg transition-colors">
            {applying ? 'Applying…' : '✓ Apply Confirmed'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────
export function AiBulkMapModal({ orgs, onClose }: { orgs: Org[]; onClose: () => void }) {
  const [orgId,        setOrgId]        = useState(orgs[0]?.id ?? '');
  const [dryRun,       setDryRun]       = useState(true);
  const [phase,        setPhase]        = useState<'idle' | 'running' | 'results'>('idle');
  const [result,       setResult]       = useState<BulkMapResult | null>(null);
  const [err,          setErr]          = useState('');
  const [appliedCount, setAppliedCount] = useState(0);

  const run = async () => {
    setPhase('running'); setErr('');
    try {
      const res = await fetch(`${API_BASE}/organizations/${orgId}/ai-bulk-map`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, businessType: 'Renewal', chunkSize: 20 }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as BulkMapResult;
      setResult(data); setPhase('results');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Request failed');
      setPhase('idle');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 pb-8 overflow-y-auto"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden"
        style={{ animation: 'slideDown 0.18s cubic-bezier(0.16,1,0.3,1)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-amber-500 to-orange-500">
          <div>
            <h2 className="text-white font-bold text-base tracking-tight">✦ AI Auto-Map Renewals</h2>
            <p className="text-amber-100 text-[11px] mt-0.5">Cached Renewal documents ko subscriptions se automatically map karo</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-lg transition-all">
            ×
          </button>
        </div>

        <div className="px-6 py-5">

          {/* IDLE */}
          {phase === 'idle' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Organization</label>
                  <select value={orgId} onChange={e => setOrgId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 bg-white">
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)}
                      className="w-4 h-4 rounded accent-amber-500" />
                    <div>
                      <p className="text-sm font-bold text-slate-700">Dry Run</p>
                      <p className="text-[10px] text-slate-400">Preview only — kuch apply nahi hoga</p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200/60 rounded-xl px-4 py-3 text-xs text-amber-800 space-y-1">
                <p className="font-bold">Kya hoga:</p>
                <ul className="list-disc list-inside space-y-0.5 text-amber-700">
                  <li>Saare cached Renewal documents scan honge</li>
                  <li>HIGH confidence (≤30 day delta) → automatically apply hoga</li>
                  <li>MEDIUM confidence (≤90 day delta) → review queue mein aayega</li>
                  <li>LOW confidence (no domain match) → skip hoga</li>
                </ul>
              </div>

              {err && <p className="text-xs text-red-600 font-semibold bg-red-50 border border-red-200 rounded-xl px-4 py-2">{err}</p>}

              <div className="flex justify-end gap-3 pt-1 border-t border-slate-100">
                <button type="button" onClick={onClose}
                  className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors">
                  Cancel
                </button>
                <button type="button" onClick={() => void run()} disabled={!orgId}
                  className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-sm transition-all">
                  {dryRun ? '🔍 Preview' : '✦ Run Auto-Map'}
                </button>
              </div>
            </div>
          )}

          {/* RUNNING */}
          {phase === 'running' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-10 h-10 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
              <p className="text-sm font-bold text-slate-700">Documents process ho rahe hain…</p>
              <p className="text-xs text-slate-400">Large organizations ke liye 1–2 minute lag sakte hain</p>
            </div>
          )}

          {/* RESULTS */}
          {phase === 'results' && result && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: '✅', label: 'Auto-Mapped (HIGH)',    value: result.summary.high,          color: 'emerald', note: dryRun ? 'preview' : `${result.summary.appliedCount} applied` },
                  { icon: '👁', label: 'Needs Review (MEDIUM)', value: result.summary.medium,         color: 'amber',   note: 'review queue mein' },
                  { icon: '⊖',  label: 'Skipped (no domain)',   value: result.summary.low,            color: 'slate',   note: 'domain match nahi mila' },
                  { icon: '⊟',  label: 'Already Mapped',        value: result.summary.alreadyMapped,  color: 'slate',   note: 'RenewalHistory exists' },
                ].map(item => (
                  <div key={item.label} className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${
                    item.color === 'emerald' ? 'bg-emerald-50 border-emerald-200/60' :
                    item.color === 'amber'   ? 'bg-amber-50 border-amber-200/60' :
                                               'bg-slate-50 border-slate-200/60'
                  }`}>
                    <span className="text-lg leading-none mt-0.5">{item.icon}</span>
                    <div>
                      <p className="text-xl font-extrabold text-slate-800 leading-none">{item.value}</p>
                      <p className="text-[10px] font-bold text-slate-600 mt-0.5">{item.label}</p>
                      <p className="text-[9px] text-slate-400 mt-0.5">{item.note}</p>
                    </div>
                  </div>
                ))}
              </div>

              {result.dryRun && (
                <div className="bg-blue-50 border border-blue-200/60 rounded-xl px-4 py-2.5 text-xs text-blue-700 font-semibold flex items-center gap-2">
                  <span>ℹ</span>
                  <span>Dry Run mode — kuch apply nahi hua. "Dry Run" uncheck karke wapas run karein.</span>
                </div>
              )}

              {result.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200/60 rounded-xl px-4 py-2.5">
                  <p className="text-[10px] font-bold text-red-700 mb-1">Errors ({result.errors.length})</p>
                  {result.errors.slice(0, 5).map(e => (
                    <p key={e.docKey} className="text-[10px] text-red-600">{e.docKey}: {e.error}</p>
                  ))}
                </div>
              )}

              {result.reviewQueue.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                    Review Queue ({result.reviewQueue.length} documents · {appliedCount} applied so far)
                  </h3>
                  {result.reviewQueue.map(doc => (
                    <ReviewCard key={doc.docKey} doc={doc} orgId={orgId} onApplied={() => setAppliedCount(c => c + 1)} />
                  ))}
                </div>
              )}

              <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                <button type="button" onClick={() => { setPhase('idle'); setResult(null); setAppliedCount(0); }}
                  className="text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors">
                  ← Wapas
                </button>
                <button type="button" onClick={onClose}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-colors">
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
