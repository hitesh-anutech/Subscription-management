'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { API_BASE } from '@/lib/api';

interface ImportCsvResult {
  success?: boolean;
  importLogId?: string;
  totalRows?: number;
  createdCount?: number;
  enrichedCount?: number;
  warningCount?: number;
  errorCount?: number;
  warnings?: string[];
  errors?: string[];
  message?: string;
}

const SAMPLE_HEADERS = [
  'Customer Number', 'Domain Name', 'Item ID', 'Item Name',
  'Quantity', 'Price', 'Billing Cycle', 'Start Date', 'End Date', 'Cost', 'Currency', 'Exchange Rate', 'Organization',
];

const SAMPLE_ROWS = [
  ['CUS-00073', 'intranslogistics.com', 'GWBS', 'Google Workspace Business Starter', '6', '3000', 'Annual', '06-07-2026', '05-07-2027', '2851', '', '', ''],
  ['CUS-00074', 'example.com', '', 'Shared Linux Web Hosting - Starter Plan', '1', '2500', 'Annual', '01-04-2026', '31-03-2027', '1500', '', '', ''],
  ['CUS-00090', 'phenom.io', '', 'Google Workspace Business Standard', '10', '144', 'Annual', '01-05-2026', '30-04-2027', '110', 'USD', '83', ''],
];

function downloadSample() {
  const csv = [SAMPLE_HEADERS.join(','), ...SAMPLE_ROWS.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'subscriptions_import_sample.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImportCsvPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportCsvResult | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [droppedFileName, setDroppedFileName] = useState<string | null>(null);

  const uploadFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('Please select a valid .csv file.');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    setImporting(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/import-create-csv`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      const data = (await res.json()) as ImportCsvResult;
      if (!res.ok) throw new Error(data.message || 'Import failed');
      setResult(data);
    } catch (err) {
      setResult({ errors: [err instanceof Error ? err.message : String(err)] });
    } finally {
      setImporting(false);
      setDroppedFileName(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    await uploadFile(file);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    setDroppedFileName(file.name);
    await uploadFile(file);
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <nav className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
          <Link href="/dashboard/subscriptions" className="hover:text-slate-600">Subscriptions</Link>
          <span>›</span>
          <span className="text-slate-600">Import CSV</span>
        </nav>
        <h1 className="text-2xl font-bold text-slate-900">Import Subscriptions from CSV</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Bulk-create subscriptions from a spreadsheet. Valid rows import; invalid rows are reported so you can fix and re-upload.
        </p>
      </div>

      {/* Step 1 — template + instructions */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Step 1 — Prepare your file</h2>
          <div className="flex gap-2">
            <button type="button" onClick={downloadSample}
              className="px-3 py-1.5 border border-blue-300 text-blue-700 text-xs font-semibold rounded-lg hover:bg-blue-50">
              ↓ Download sample CSV
            </button>
            <button type="button" onClick={() => setShowHelp((v) => !v)}
              className="px-3 py-1.5 border border-slate-300 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50">
              {showHelp ? 'Hide instructions' : 'Show instructions'}
            </button>
          </div>
        </div>

        {showHelp && (
          <div className="text-xs text-slate-600 space-y-2 border-t border-slate-100 pt-3">
            <p className="font-medium text-slate-700">Columns (header row required):</p>
            <ul className="space-y-1 list-disc pl-5">
              <li><b>Customer Number</b> (required) — the Zoho Customer Number, e.g. <code>CUS-00073</code>. Must exist in Zoho (sync first).</li>
              <li><b>Domain Name</b> (required) — created automatically if it doesn&apos;t exist yet.</li>
              <li><b>Item ID / SKU</b> (optional) — preferred match. <b>Item Name</b> (required if no ID/SKU) — must match Zoho exactly.</li>
              <li><b>Price</b> (required, ≥ 0) — in the customer&apos;s billing currency. <b>Quantity</b> (optional, default 1). <b>Cost</b> (optional, default 0) — always in your base currency (₹ INR), even for foreign customers.</li>
              <li><b>Billing Cycle</b> (required) — Monthly, Quarterly, Half Yearly, Annual, Biennial, Triennial, or One-Time.</li>
              <li><b>Start Date</b> / <b>End Date</b> (required) — <code>DD-MM-YYYY</code>, <code>DD/MM/YYYY</code>, or <code>YYYY-MM-DD</code>.</li>
              <li><b>Currency</b> (optional) — defaults to the customer&apos;s Zoho currency. If you provide it, it <b>must match</b> the customer&apos;s Zoho currency or the row is rejected. Price is in this currency (e.g. USD), not converted to INR.</li>
              <li><b>Exchange Rate</b> (optional) — value of 1 unit of Currency in your base currency (e.g. <code>83</code> for USD→INR). Only needed for foreign currencies to get an INR-equivalent for reporting; a warning is raised if omitted.</li>
              <li><b>Organization</b> — only needed if you have more than one active org (name or Zoho Org ID).</li>
            </ul>
            <p className="text-slate-500">
              Prerequisite: <b>sync Zoho customers &amp; items first</b> so Customer Numbers and Item Names resolve.
              Lifecycle status (Active / Expiring Soon / Expired) is set automatically from the dates.
            </p>
          </div>
        )}
      </div>

      {/* Step 2 — upload */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Step 2 — Upload &amp; import</h2>

        {/* Drag-and-drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => void handleDrop(e)}
          onClick={() => !importing && fileRef.current?.click()}
          className={`
            border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
            ${dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'}
            ${importing ? 'opacity-60 cursor-not-allowed' : ''}
          `}
        >
          {importing ? (
            <div className="space-y-1">
              <p className="text-sm font-semibold text-emerald-700">Importing…</p>
              <p className="text-xs text-slate-400">Please wait</p>
            </div>
          ) : droppedFileName ? (
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-700">📄 {droppedFileName}</p>
              <p className="text-xs text-slate-400">Processing…</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-3xl">📂</p>
              <p className="text-sm font-semibold text-slate-700">
                Drag &amp; drop your CSV file here
              </p>
              <p className="text-xs text-slate-400">or click to browse</p>
            </div>
          )}
        </div>

        {/* Hidden file input for click-to-browse fallback */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={() => void handleUpload()}
        />
      </div>

      {/* Result */}
      {result && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-700">Result</h2>
          </div>
          <div className="p-5 space-y-3 text-sm">
            {result.message ? (
              <p className="text-red-600">❌ {result.message}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-medium">{result.createdCount ?? 0} created</span>
                  {(result.enrichedCount ?? 0) > 0 && (
                    <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-medium">{result.enrichedCount} enriched</span>
                  )}
                  {(result.warningCount ?? 0) > 0 && (
                    <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 font-medium">{result.warningCount} warnings</span>
                  )}
                  {(result.errorCount ?? 0) > 0 && (
                    <span className="px-2.5 py-1 rounded-lg bg-red-50 text-red-700 font-medium">{result.errorCount} errors</span>
                  )}
                  <span className="px-2.5 py-1 rounded-lg bg-slate-50 text-slate-500">{result.totalRows ?? 0} rows total</span>
                </div>

                {result.importLogId && ((result.errorCount ?? 0) > 0 || (result.warningCount ?? 0) > 0) && (
                  <a href={`/api/subscriptions/import-logs/${result.importLogId}/errors-csv`}
                    className="inline-block text-xs font-semibold text-blue-700 underline">
                    ↓ Download warnings &amp; errors CSV (fix &amp; re-upload)
                  </a>
                )}

                {result.warnings?.length ? (
                  <div>
                    <p className="text-xs font-semibold text-amber-700 mb-1">Warnings (imported, review):</p>
                    <ul className="text-xs text-amber-700 space-y-0.5 max-h-48 overflow-y-auto">
                      {result.warnings.map((w, i) => <li key={i}>⚠️ {w}</li>)}
                    </ul>
                  </div>
                ) : null}

                {result.errors?.length ? (
                  <div>
                    <p className="text-xs font-semibold text-red-700 mb-1">Errors (not imported):</p>
                    <ul className="text-xs text-red-600 space-y-0.5 max-h-48 overflow-y-auto">
                      {result.errors.map((e, i) => <li key={i}>❌ {e}</li>)}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
