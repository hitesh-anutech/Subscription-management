'use client';

import { useState, useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

// ------------------------------------------------------------------
// Types matching backend GoogleCustomer / GoogleSubscription shapes
// ------------------------------------------------------------------
interface GoogleSubscriptionData {
  subscriptionId: string;
  skuId: string;
  skuName: string | null;
  status: string;
  plan: { planName: string; isCommitmentPlan?: boolean } | null;
  seats: { numberOfSeats?: number; maximumNumberOfSeats?: number } | null;
  renewalSettings: { renewalType: string } | null;
  trialSettings: { isInTrial?: boolean; trialEndTime?: string } | null;
  creationTime: string | null;
}

interface GoogleData {
  customerId: string;
  customerDomain: string;
  alternateEmail: string | null;
  resourceUiUrl: string | null;
  postalAddress: {
    organizationName?: string;
    contactName?: string;
    countryCode?: string;
  } | null;
  subscriptions: GoogleSubscriptionData[];
}

interface ApiResponse {
  googleCustomerId: string | null;
  consoleUrl: string | null;
  syncedAt: string | null;
  googleData: GoogleData | null;
}

interface Props {
  domainId: string;
  domainName: string;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function ExternalLinkIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE:    'bg-green-100 text-green-800',
  SUSPENDED: 'bg-amber-100 text-amber-800',
  CANCELLED: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${STATUS_STYLE[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}

const PLAN_LABELS: Record<string, string> = {
  FLEXIBLE:              'Flexible',
  ANNUAL_MONTHLY_PAY:    'Annual (monthly pay)',
  ANNUAL_YEARLY_PAY:     'Annual (yearly pay)',
  TRIAL:                 'Trial',
  FREE:                  'Free',
};

const RENEWAL_LABELS: Record<string, string> = {
  AUTO_RENEW_MONTHLY_PAY:              'Auto Renew (monthly)',
  AUTO_RENEW_YEARLY_PAY:               'Auto Renew (yearly)',
  RENEW_CURRENT_USERS_MONTHLY_PAY:     'Renew Current Users (monthly)',
  RENEW_CURRENT_USERS_YEARLY_PAY:      'Renew Current Users (yearly)',
  SWITCH_TO_PAY_AS_YOU_GO:             'Switch to Pay-As-You-Go',
  CANCEL:                              'Cancel at end',
};

function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ------------------------------------------------------------------
// Main Component
// ------------------------------------------------------------------

export function GoogleResellerPanel({ domainId, domainName }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function fetchStored() {
    try {
      const res = await fetch(`${API_BASE}/google-workspace/customers/${domainId}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (res.ok) setData(await res.json() as ApiResponse);
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchStored(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/google-workspace/customers/fetch`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domainId }),
      });
      const json = await res.json() as ApiResponse & { error?: string };
      if (!res.ok || json.error) {
        setError((json as { error?: string }).error ?? 'Sync failed');
      } else {
        setData({
          googleCustomerId: json.googleCustomerId,
          consoleUrl: json.consoleUrl,
          syncedAt: new Date().toISOString(),
          googleData: json.googleData ?? null,
        });
      }
    } catch {
      setError('Server se connect nahi ho paya');
    } finally {
      setSyncing(false);
    }
  }

  function handleCopy() {
    if (data?.googleCustomerId) {
      navigator.clipboard.writeText(data.googleCustomerId).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }
  }

  if (loading) return null;

  const gd = data?.googleData ?? null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span className="text-base">🌐</span>
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Google Reseller</h2>
        </div>
        {data?.googleCustomerId && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">● Synced</span>
        )}
      </div>

      <div className="px-5 py-4 space-y-5">
        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">{error}</div>
        )}

        {!data?.googleCustomerId && !error && (
          <p className="text-sm text-slate-500">
            <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{domainName}</span> का Google Customer ID अभी store नहीं है।
          </p>
        )}

        {/* Section A: Customer Details */}
        {gd && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Customer Details</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">

              {/* Customer ID */}
              <div>
                <p className="text-xs text-slate-400">Customer ID</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="font-mono font-medium text-slate-800 text-xs">{gd.customerId}</span>
                  <button type="button" onClick={handleCopy} title="Copy" className="text-slate-400 hover:text-slate-600 text-xs">
                    {copied ? '✓' : '📋'}
                  </button>
                </div>
              </div>

              {/* Primary Domain */}
              <div>
                <p className="text-xs text-slate-400">Primary Domain</p>
                <p className="text-slate-800 font-medium mt-0.5 text-xs font-mono">{gd.customerDomain}</p>
              </div>

              {/* Org Name */}
              {gd.postalAddress?.organizationName && (
                <div>
                  <p className="text-xs text-slate-400">Organization</p>
                  <p className="text-slate-800 font-medium mt-0.5 text-sm">{gd.postalAddress.organizationName}</p>
                </div>
              )}

              {/* Country */}
              {gd.postalAddress?.countryCode && (
                <div>
                  <p className="text-xs text-slate-400">Country</p>
                  <p className="text-slate-800 font-medium mt-0.5 text-sm">{gd.postalAddress.countryCode}</p>
                </div>
              )}

              {/* Alternate Email */}
              {gd.alternateEmail && (
                <div className="col-span-2">
                  <p className="text-xs text-slate-400">Alternate Email</p>
                  <p className="text-slate-800 font-medium mt-0.5 text-sm">{gd.alternateEmail}</p>
                </div>
              )}
            </div>

            {/* Section B: Console Links */}
            <div className="flex flex-wrap gap-2 pt-1">
              <a
                href={`https://channelservices.cloud.google.com/customers/${gd.customerId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold border border-blue-200 transition-colors"
              >
                Partner Sales Console
                <ExternalLinkIcon className="w-3 h-3" />
              </a>
              {gd.resourceUiUrl && (
                <a
                  href={gd.resourceUiUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 transition-colors"
                >
                  Admin Console
                  <ExternalLinkIcon className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Section C: Google Subscriptions */}
        {gd && gd.subscriptions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Google Subscriptions ({gd.subscriptions.length})
            </p>
            <div className="space-y-2">
              {gd.subscriptions.map((s) => (
                <div key={s.subscriptionId} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm space-y-2">
                  {/* SKU name + status */}
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-slate-800 text-sm">{s.skuName ?? s.skuId}</p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {s.trialSettings?.isInTrial && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-700">
                          Trial
                        </span>
                      )}
                      <StatusBadge status={s.status} />
                    </div>
                  </div>

                  {/* Details grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    {s.seats?.numberOfSeats !== undefined && (
                      <div>
                        <span className="text-slate-400">Licensed Seats: </span>
                        <span className="text-slate-700 font-medium">{s.seats.numberOfSeats}</span>
                        {s.seats.maximumNumberOfSeats !== undefined && (
                          <span className="text-slate-400"> / {s.seats.maximumNumberOfSeats} max</span>
                        )}
                      </div>
                    )}
                    {s.plan?.planName && (
                      <div>
                        <span className="text-slate-400">Plan: </span>
                        <span className="text-slate-700 font-medium">
                          {PLAN_LABELS[s.plan.planName] ?? s.plan.planName}
                          {s.plan.isCommitmentPlan && ' (commitment)'}
                        </span>
                      </div>
                    )}
                    {s.renewalSettings?.renewalType && (
                      <div className="col-span-2">
                        <span className="text-slate-400">Renewal: </span>
                        <span className="text-slate-700 font-medium">
                          {RENEWAL_LABELS[s.renewalSettings.renewalType] ?? s.renewalSettings.renewalType}
                        </span>
                      </div>
                    )}
                    {s.creationTime && (
                      <div className="col-span-2">
                        <span className="text-slate-400">Created: </span>
                        <span className="text-slate-700">{fmtDate(s.creationTime)}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section D: Sync */}
        <div className="pt-1 border-t border-slate-100 flex items-center justify-between">
          {data?.syncedAt && (
            <p className="text-xs text-slate-400">Last synced: {fmtDateTime(data.syncedAt)}</p>
          )}
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 disabled:text-slate-400 font-medium transition-colors ml-auto"
          >
            <span className={syncing ? 'animate-spin inline-block' : ''}>🔄</span>
            {syncing ? 'Syncing…' : 'Google से Sync करें'}
          </button>
        </div>
      </div>
    </div>
  );
}
