'use client';

interface FlashBannerProps {
  connected?: string;
  error?: string;
}

export function FlashBanner({ connected, error }: FlashBannerProps) {
  if (connected) {
    return (
      <div className="bg-emerald-50 border-l-4 border-emerald-500 text-emerald-900 p-3 rounded text-sm">
        ✓ Zoho connected successfully for organization <code className="bg-white px-1 rounded">{connected.slice(0, 8)}…</code>
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-red-50 border-l-4 border-red-500 text-red-900 p-3 rounded text-sm">
        ✕ {error}
      </div>
    );
  }
  return null;
}
