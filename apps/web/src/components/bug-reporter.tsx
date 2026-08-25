'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { X, Bug, Lightbulb, Paintbrush, Upload, Trash2, Camera } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

type ReportType = 'Bug' | 'Feature' | 'UIPolish';
type Severity   = 'Low' | 'Medium' | 'High' | 'Critical';

const TYPE_OPTS: { value: ReportType; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'Bug',      label: 'Bug / Error',   icon: <Bug size={13} />,        color: 'border-red-400 bg-red-50 text-red-700' },
  { value: 'Feature',  label: 'Feature Idea',  icon: <Lightbulb size={13} />,  color: 'border-amber-400 bg-amber-50 text-amber-700' },
  { value: 'UIPolish', label: 'UI Polish',      icon: <Paintbrush size={13} />, color: 'border-purple-400 bg-purple-50 text-purple-700' },
];

const SEV_OPTS: { value: Severity; active: string; idle: string }[] = [
  { value: 'Low',      active: 'bg-slate-700 text-white',  idle: 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50' },
  { value: 'Medium',   active: 'bg-slate-900 text-white',  idle: 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50' },
  { value: 'High',     active: 'bg-orange-600 text-white', idle: 'bg-white text-orange-600 border border-orange-200 hover:bg-orange-50' },
  { value: 'Critical', active: 'bg-red-600 text-white',    idle: 'bg-white text-red-600   border border-red-200   hover:bg-red-50' },
];

function resizeImageToBase64(file: File, maxW = 1200, maxH = 900, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function captureScreen(): Promise<string | null> {
  try {
    const html2canvas = (await import('html2canvas')).default;
    // Scale down to 40% + low JPEG quality keeps base64 output well under 500KB
    const canvas = await html2canvas(document.body, {
      scale: 0.4,
      useCORS: true,
      allowTaint: true,
      logging: false,
      foreignObjectRendering: false,
    });
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch {
    return null;
  }
}

export function BugReporter() {
  const pathname = usePathname();

  const [open,        setOpen]        = useState(false);
  const [capturing,   setCapturing]   = useState(false);
  const [type,        setType]        = useState<ReportType>('Bug');
  const [severity,    setSeverity]    = useState<Severity>('Medium');
  const [details,     setDetails]     = useState('');
  const [shots,       setShots]       = useState<string[]>([]);
  const [submitting,  setSubmitting]  = useState(false);
  const [submittedNo, setSubmittedNo] = useState<number | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Paste screenshot anywhere in the modal
  useEffect(() => {
    if (!open) return;
    const handler = async (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imgItem = items.find((i) => i.type.startsWith('image/'));
      if (!imgItem) return;
      const file = imgItem.getAsFile();
      if (!file || shots.length >= 3) return;
      const b64 = await resizeImageToBase64(file);
      setShots((prev) => [...prev, b64]);
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [open, shots.length]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).slice(0, 3 - shots.length);
    const b64s = await Promise.all(arr.map((f) => resizeImageToBase64(f)));
    setShots((prev) => [...prev, ...b64s].slice(0, 3));
  }, [shots.length]);

  const reset = () => {
    setType('Bug'); setSeverity('Medium'); setDetails('');
    setShots([]); setError(null); setSubmittedNo(null);
  };

  // Auto-capture page → open modal
  const handleOpen = async () => {
    reset();
    setCapturing(true);
    const screenshot = await captureScreen();
    setCapturing(false);
    if (screenshot) setShots([screenshot]);
    setOpen(true);
  };

  // Manual re-capture while modal is open
  const handleManualCapture = async () => {
    if (shots.length >= 3) return;
    setCapturing(true);
    setOpen(false); // hide modal so capture is clean
    await new Promise((r) => setTimeout(r, 80)); // brief paint
    const screenshot = await captureScreen();
    setOpen(true);
    setCapturing(false);
    if (screenshot) setShots((prev) => [...prev, screenshot].slice(0, 3));
  };

  const submit = async () => {
    if (!details.trim()) { setError('Please describe the issue.'); return; }
    // Guard: drop any screenshot >1.2MB (base64 length ~1.6M chars)
    const safeShots = shots.filter((s) => s.length < 1_600_000);
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/bug-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type, severity, details: details.trim(), pageUrl: pathname, screenshots: safeShots }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSubmittedNo(data.bugNumber ?? null);
      setTimeout(() => setOpen(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Floating trigger */}
      <button
        onClick={handleOpen}
        disabled={capturing}
        title="Report a bug or suggest a feature"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 disabled:bg-orange-400 text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-lg shadow-orange-500/30 transition-all hover:scale-105 active:scale-95 disabled:scale-100 select-none"
      >
        {capturing ? (
          <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />Capturing…</>
        ) : (
          <><Bug size={14} />Report Bug</>
        )}
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-[9000] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">

            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-slate-100">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-black tracking-widest text-orange-500 uppercase flex items-center gap-1.5">
                    <Bug size={11} /> Team Software Testing & Bug Reporter
                  </p>
                  <h2 className="text-xl font-black text-slate-900 mt-0.5">Report Bug / Suggest Feature</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Ask or report anything. Press{' '}
                    <kbd className="bg-slate-100 px-1 py-0.5 rounded text-[10px] font-mono">Ctrl+V</kbd>{' '}
                    to paste screenshots!
                  </p>
                </div>
                <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors mt-0.5">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Success state */}
            {submittedNo !== null ? (
              <div className="flex-1 flex flex-col items-center justify-center py-14 text-center px-8">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                  <span className="text-3xl">✓</span>
                </div>
                <p className="text-base font-bold text-slate-800">Report submitted!</p>
                <div className="mt-2 px-4 py-2 bg-orange-50 border border-orange-200 rounded-xl">
                  <span className="text-xs text-slate-500">Your bug number is </span>
                  <span className="text-lg font-black text-orange-600">
                    #{String(submittedNo).padStart(3, '0')}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Tell the developer: "Fix bug #{String(submittedNo).padStart(3, '0')}"
                </p>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

                {/* Report Type */}
                <div>
                  <label className="text-xs font-semibold text-slate-700 mb-2 block">Report Type</label>
                  <div className="flex gap-2">
                    {TYPE_OPTS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setType(opt.value)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl border-2 text-xs font-semibold transition-all
                          ${type === opt.value
                            ? opt.color + ' ring-2 ring-offset-1 ring-current'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}
                      >
                        {opt.icon}{opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Severity */}
                <div>
                  <label className="text-xs font-semibold text-slate-700 mb-2 block">Severity / Priority</label>
                  <div className="flex gap-1.5">
                    {SEV_OPTS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setSeverity(opt.value)}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-all
                          ${severity === opt.value ? opt.active : opt.idle}`}
                      >
                        {opt.value}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Details */}
                <div>
                  <label className="text-xs font-semibold text-slate-700 mb-2 block">
                    Details & Steps{' '}
                    <span className="text-slate-400 font-normal">(All-in-One AI Box)</span>
                  </label>
                  <textarea
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    rows={4}
                    placeholder="Explain what happened, steps to reproduce, or paste your error here…"
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent resize-none transition-all font-mono"
                  />
                  <div className="flex justify-between mt-1">
                    <p className="text-[10px] text-slate-400">
                      Tip: <kbd className="bg-slate-100 px-1 rounded font-mono">Ctrl+V</kbd> to paste screenshots
                    </p>
                    <span className="text-[10px] text-slate-400">{details.length} chars</span>
                  </div>
                </div>

                {/* Current Page */}
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                  <span className="text-slate-400 text-xs">🔗</span>
                  <span className="text-xs font-mono text-slate-700 flex-1 truncate">{pathname}</span>
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Auto-Captured</span>
                </div>

                {/* Screenshots */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-slate-700">
                      Screenshots ({shots.length}/3)
                    </label>
                    {shots.length > 0 && (
                      <button onClick={() => setShots([])} className="text-[10px] text-slate-400 hover:text-red-500 transition-colors">
                        Clear all
                      </button>
                    )}
                  </div>

                  {shots.length > 0 && (
                    <div className="flex gap-2 flex-wrap mb-3">
                      {shots.map((src, i) => (
                        <div key={i} className="relative group w-28 h-[4.5rem] rounded-lg overflow-hidden border border-slate-200 shadow-sm">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt={`Screenshot ${i + 1}`} className="w-full h-full object-cover" />
                          {i === 0 && (
                            <span className="absolute top-1 left-1 bg-emerald-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full pointer-events-none">
                              AUTO
                            </span>
                          )}
                          <button
                            onClick={() => setShots((p) => p.filter((_, j) => j !== i))}
                            className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                          >
                            <Trash2 size={14} className="text-white" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={handleManualCapture}
                      disabled={shots.length >= 3 || capturing}
                      className="flex-1 flex items-center justify-center gap-1.5 border border-orange-200 bg-orange-50 text-orange-700 rounded-xl py-2.5 text-xs font-semibold hover:bg-orange-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Camera size={13} />
                      {capturing ? 'Capturing…' : 'Re-capture Screen'}
                    </button>
                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={shots.length >= 3}
                      className="flex-1 flex items-center justify-center gap-1.5 border border-slate-200 rounded-xl py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Upload size={13} /> Upload / Paste
                    </button>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handleFiles(e.target.files)}
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
                    {error}
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            {submittedNo === null && (
              <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
                <button
                  onClick={() => setOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={submitting || !details.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Submitting…</>
                  ) : (
                    <><Bug size={14} />Submit Report</>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
