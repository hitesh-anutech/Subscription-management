'use client';

import { useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

export type PdfKind = 'estimate' | 'invoice';

/**
 * Opens a Zoho estimate/invoice PDF in a new tab.
 *
 * Fetches the PDF (session-cookie auth) as a blob and points a new tab at it,
 * so the browser's built-in viewer renders it. The backend serves the bytes
 * from a DB cache (`zoho_document_pdf`) — first open hits Zoho, repeats are free.
 *
 * The blank tab is opened synchronously on click (before the await) so popup
 * blockers treat it as user-initiated; an anchor click is the fallback.
 */
export function ViewPdfButton({
  orgId,
  kind,
  docId,
  label = '📄 PDF',
  loadingLabel = '⏳',
  className,
  title,
}: {
  orgId: string;
  kind: PdfKind;
  docId: string | null | undefined;
  label?: string;
  loadingLabel?: string;
  className?: string;
  title?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);

  const disabled = loading || !docId || !orgId;

  const open = async () => {
    if (!docId || !orgId) return;
    setErr(false);
    setLoading(true);
    const win = window.open('', '_blank'); // opened inside the click gesture
    try {
      const res = await fetch(
        `${API_BASE}/organizations/${orgId}/documents/${kind}/${docId}/pdf`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      if (win) {
        win.location.href = objUrl;
      } else {
        const a = document.createElement('a');
        a.href = objUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
    } catch {
      if (win) win.close();
      setErr(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={disabled}
      title={err ? 'PDF load nahi ho paaya — dobara try karein' : (title ?? 'View PDF')}
      className={
        className ??
        'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors'
      }
    >
      {loading ? loadingLabel : err ? '⚠ Retry PDF' : label}
    </button>
  );
}
