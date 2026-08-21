'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import type { Organization } from '@/lib/api';
import {
  connectZoho,
  disconnectZoho,
  testZohoConnection,
  deleteOrganization,
} from '../actions';
import { OrgEmailConfig } from './org-email-config';
import { ItemFieldMapping } from './item-field-mapping';

const statusStyles: Record<Organization['connectionStatus'], { badge: string; ring: string; label: string }> = {
  active: { badge: 'bg-emerald-100 text-emerald-800', ring: 'border-emerald-200 bg-emerald-50', label: '✓ Connected' },
  expired: { badge: 'bg-amber-100 text-amber-800', ring: 'border-amber-200 bg-amber-50', label: '⏰ Token Expired' },
  revoked: { badge: 'bg-red-100 text-red-800', ring: 'border-red-200 bg-red-50', label: '⚠ Revoked' },
  error: { badge: 'bg-red-100 text-red-800', ring: 'border-red-200 bg-red-50', label: '✕ Error' },
  disconnected: { badge: 'bg-slate-200 text-slate-700', ring: 'border-slate-200 bg-slate-50', label: 'Disconnected' },
};

export function OrgCard({ org }: { org: Organization }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [testResult,    setTestResult]    = useState<string | null>(null);
  const [syncResult,    setSyncResult]    = useState<string | null>(null);
  const [cfResult,      setCfResult]      = useState<string | null>(null);
  const [cfSyncing,     setCfSyncing]     = useState(false);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

  function handleEnsureCustomFields() {
    setCfSyncing(true);
    setCfResult('⏳ Custom fields check कर रहे हैं…');
    startTransition(async () => {
      try {
        const res = await fetch(`${API_BASE}/organizations/${org.id}/ensure-custom-fields`, {
          method: 'POST', credentials: 'include',
        });
        if (res.ok) {
          setCfResult('✅ 4 custom fields verified/created in Zoho');
        } else {
          setCfResult('❌ Custom fields setup failed');
        }
      } catch {
        setCfResult('❌ Could not connect to server');
      } finally {
        setCfSyncing(false);
      }
    });
  }

  function handleSync() {
    setSyncResult('⏳ Syncing…');
    startTransition(async () => {
      try {
        const [cusRes, itmRes] = await Promise.all([
          fetch(`${API_BASE}/organizations/${org.id}/sync-customers`, { method: 'POST', credentials: 'include' }),
          fetch(`${API_BASE}/organizations/${org.id}/sync-items`,    { method: 'POST', credentials: 'include' }),
        ]);
        const [cus, itm] = await Promise.all([
          cusRes.json() as Promise<{ synced?: number }>,
          itmRes.json() as Promise<{ synced?: number }>,
        ]);
        setSyncResult(`✅ ${cus.synced ?? 0} customers · ${itm.synced ?? 0} items synced`);
      } catch {
        setSyncResult('❌ Sync failed');
      }
    });
  }
  const style = statusStyles[org.connectionStatus] ?? statusStyles.disconnected;

  const isConnected = org.connectionStatus === 'active';
  const needsReconnect = org.connectionStatus === 'expired' || org.connectionStatus === 'revoked';

  function handleConnect() {
    startTransition(async () => {
      const resp = await connectZoho(org.id);
      if (resp.authorize_url) window.location.href = resp.authorize_url;
      else alert(resp.error ?? 'Failed to initiate OAuth');
    });
  }

  function handleDisconnect() {
    if (!confirm(`Disconnect Zoho for "${org.name}"? Stored tokens will be cleared.`)) return;
    startTransition(async () => {
      const r = await disconnectZoho(org.id);
      if (r?.ok) router.refresh();
      else alert(r?.error ?? 'Failed');
    });
  }

  function handleTest() {
    setTestResult('…');
    startTransition(async () => {
      const r = await testZohoConnection(org.id);
      setTestResult(
        r.success
          ? `✓ Connection successful — Zoho API responding`
          : `✕ ${r.error}`,
      );
    });
  }

  function handleDelete() {
    if (!confirm(`Soft-delete "${org.name}"? Cannot undo via UI.`)) return;
    startTransition(async () => {
      const r = await deleteOrganization(org.id);
      if (r?.ok) router.refresh();
      else alert(r?.error ?? 'Failed');
    });
  }

  return (
    <div className={cn(
      'border rounded-2xl p-6 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden bg-white',
      org.connectionStatus === 'active' ? 'border-emerald-100/80 bg-gradient-to-br from-white to-emerald-50/10' : 'border-slate-200'
    )}>
      {/* Decorative top-status accent line */}
      <div className={cn(
        'absolute top-0 left-0 right-0 h-1.5',
        org.connectionStatus === 'active' ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 
        needsReconnect ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-slate-300'
      )} />

      <div className="flex flex-col lg:flex-row justify-between items-start gap-6 mt-2">
        <div className="min-w-0 flex-1 space-y-4">
          {/* Header & Status Indicator */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-extrabold text-slate-800 text-lg tracking-tight">{org.name}</span>
            <div className="flex items-center gap-1.5">
              <span className={cn(
                'inline-block w-2.5 h-2.5 rounded-full shadow-sm',
                org.connectionStatus === 'active' ? 'bg-emerald-500 animate-pulse' :
                needsReconnect ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
              )} />
              <span className={cn('text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider', style.badge)}>
                {style.label}
              </span>
            </div>
            {!org.isActive && (
              <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                inactive
              </span>
            )}
          </div>

          {/* Org details Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
            <div>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Zoho Org ID</span>
              <code className="text-xs font-semibold text-slate-700 bg-white border border-slate-200/50 px-2 py-0.5 rounded inline-block mt-0.5">
                {org.zohoOrgId}
              </code>
            </div>
            <div>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Data Center</span>
              <span className="text-xs font-bold text-slate-700 mt-0.5 block">
                {org.dataCenter.toUpperCase()}
              </span>
            </div>
            <div>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Base Currency</span>
              <span className="text-xs font-bold text-slate-700 mt-0.5 block">
                {org.baseCurrency}
              </span>
            </div>
            <div>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Status</span>
              <span className={cn(
                'text-xs font-bold mt-0.5 block',
                org.isActive ? 'text-emerald-600' : 'text-slate-500'
              )}>
                {org.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>

          {org.tokenExpiresAt && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-1 text-[11px] text-slate-400 font-medium">
              <span>🔑 Token Expires: {new Date(org.tokenExpiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: 'short', timeStyle: 'short' })}</span>
              {org.lastSyncAt && (
                <>
                  <span className="hidden sm:inline text-slate-300">|</span>
                  <span>🔄 Last synced: {new Date(org.lastSyncAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: 'short', timeStyle: 'short' })}</span>
                </>
              )}
            </div>
          )}

          {/* Action Logs/Results (Visually polished) */}
          {(testResult || syncResult || cfResult) && (
            <div className="bg-slate-900 text-slate-300 p-3.5 rounded-xl text-xs font-mono border border-slate-800 space-y-1 max-w-2xl shadow-inner">
              {testResult && <div className="flex items-center gap-2"><span className="text-blue-400">► connection_test:</span> {testResult}</div>}
              {syncResult && <div className="flex items-center gap-2"><span className="text-emerald-400">► sync_result:</span> {syncResult}</div>}
              {cfResult && <div className="flex items-center gap-2"><span className="text-violet-400">► custom_fields:</span> {cfResult}</div>}
            </div>
          )}

          <div className="space-y-4 pt-2">
            <OrgEmailConfig
              orgId={org.id}
              currentFromAddress={org.orgSettings?.emailFromAddress}
              currentReplyTo={org.orgSettings?.emailReplyTo}
              currentSmtpUser={org.orgSettings?.smtpUser}
              isSmtpConfigured={org.orgSettings?.isSmtpConfigured ?? false}
            />
            <ItemFieldMapping
              orgId={org.id}
              currentMappings={(() => {
                const meta = (org.orgSettings as Record<string, unknown> | null | undefined)
                  ?.metadata as Record<string, unknown> | undefined;
                return (
                  (meta?.custom_field_mappings as Record<string, unknown> | undefined) ??
                  (meta?.item_field_mappings as Record<string, unknown> | undefined) ??
                  {}
                );
              })()}
            />
          </div>
        </div>

        {/* Action Buttons Panel */}
        <div className="flex flex-row lg:flex-col gap-2 flex-wrap justify-end w-full lg:w-auto shrink-0 border-t lg:border-t-0 pt-4 lg:pt-0 border-slate-100">
          {isConnected && (
            <>
              <button
                type="button"
                onClick={handleTest}
                disabled={isPending}
                className="flex items-center justify-center gap-1.5 text-xs font-semibold border border-slate-200 px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50 active:scale-95 transition-all shadow-sm"
              >
                🔌 Test Link
              </button>
              <button
                type="button"
                onClick={handleSync}
                disabled={isPending}
                className="flex items-center justify-center gap-1.5 text-xs font-semibold border border-blue-200 text-blue-700 px-3.5 py-2.5 rounded-xl bg-blue-50/50 hover:bg-blue-50 disabled:opacity-50 active:scale-95 transition-all shadow-sm"
              >
                🔄 Sync Records
              </button>
              <button
                type="button"
                onClick={handleEnsureCustomFields}
                disabled={isPending || cfSyncing}
                title="Zoho में 4 required custom fields create/verify करो"
                className="flex items-center justify-center gap-1.5 text-xs font-semibold border border-violet-200 text-violet-700 px-3.5 py-2.5 rounded-xl bg-violet-50/50 hover:bg-violet-50 disabled:opacity-50 active:scale-95 transition-all shadow-sm"
              >
                🔧 Custom Fields
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={isPending}
                className="flex items-center justify-center gap-1.5 text-xs font-semibold border border-slate-200 px-3.5 py-2.5 rounded-xl bg-white hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-slate-700 disabled:opacity-50 active:scale-95 transition-all shadow-sm"
              >
                🚫 Disconnect
              </button>
            </>
          )}
          {needsReconnect && (
            <button
              type="button"
              onClick={handleConnect}
              disabled={isPending}
              className="flex items-center justify-center gap-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-xl disabled:opacity-50 shadow-md shadow-amber-500/10 active:scale-95 transition-all"
            >
              🔑 Reconnect Zoho
            </button>
          )}
          {!isConnected && !needsReconnect && (
            <button
              type="button"
              onClick={handleConnect}
              disabled={isPending}
              className="flex items-center justify-center gap-1.5 text-xs font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-4 py-2.5 rounded-xl disabled:opacity-50 shadow-md shadow-blue-500/10 active:scale-95 transition-all"
            >
              ⚡ Connect Zoho
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="flex items-center justify-center gap-1.5 text-xs font-semibold border border-red-200 text-red-600 px-3.5 py-2.5 rounded-xl bg-red-50/30 hover:bg-red-50 disabled:opacity-50 active:scale-95 transition-all"
          >
            🗑️ Delete
          </button>
        </div>
      </div>
    </div>
  );
}
