import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'System Health — Settings' };

interface ZohoConnection {
  id: string;
  name: string;
  zohoOrgId: string;
  connectionStatus: string;
  isActive: boolean;
  lastSyncAt: string | null;
  tokenExpiresAt: string | null;
  tokenExpired: boolean | null;
}

interface SystemHealth {
  timestamp: string;
  uptime_seconds: number;
  version: string;
  node_env: string;
  database: {
    status: string;
    counts: Record<string, number>;
  };
  zoho_connections: ZohoConnection[];
  integrations: { email: string };
}

interface BasicHealth {
  status: string;
  checks: Record<string, { ok: boolean; latency_ms?: number; error?: string }>;
}

const STATUS_COLOR: Record<string, string> = {
  active:       'bg-green-100 text-green-700',
  disconnected: 'bg-red-100 text-red-700',
  error:        'bg-red-100 text-red-700',
  expired:      'bg-amber-100 text-amber-700',
  connected:    'bg-green-100 text-green-700',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLOR[status.toLowerCase()] ?? 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export default async function SystemHealthPage() {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let health: SystemHealth | null = null;
  let basic: BasicHealth | null = null;
  let loadError = false;

  try {
    [health, basic] = await Promise.all([
      api.get<SystemHealth>('/health/system'),
      api.get<BasicHealth>('/health'),
    ]);
  } catch {
    loadError = true;
  }

  const dbOk = basic?.checks?.database?.ok ?? false;
  const dbLatency = basic?.checks?.database?.latency_ms;
  const overallOk = basic?.status === 'healthy';

  const TABLE_LABELS: Record<string, string> = {
    organizations:      'Organizations',
    leads:              'Leads',
    quick_quotes:       'Quick Quotes',
    email_templates:    'Email Templates',
    master_data_items:  'Master Data Items',
    users:              'Users',
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">System Health</h1>
        <p className="text-sm text-slate-500 mt-1">
          Application status, Zoho connections, और database overview।
        </p>
      </div>

      {loadError && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          API से connect नहीं हो पाया — server चल रहा है?
        </div>
      )}

      {/* ── Overall Status Banner ── */}
      {basic && (
        <div className={`flex items-center gap-3 px-5 py-4 rounded-xl border ${
          overallOk
            ? 'bg-green-50 border-green-200'
            : 'bg-amber-50 border-amber-200'
        }`}>
          <span className="text-2xl">{overallOk ? '✅' : '⚠️'}</span>
          <div>
            <p className={`font-semibold ${overallOk ? 'text-green-800' : 'text-amber-800'}`}>
              {overallOk ? 'All Systems Operational' : 'Degraded State'}
            </p>
            {health && (
              <p className="text-xs text-slate-500 mt-0.5">
                v{health.version} · {health.node_env} · Uptime: {formatUptime(health.uptime_seconds)} ·{' '}
                Checked: {formatDate(health.timestamp)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Database ── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Database</h2>
          <div className="flex items-center gap-2 text-xs">
            {dbOk ? (
              <span className="text-green-600 font-medium">● Connected</span>
            ) : (
              <span className="text-red-600 font-medium">● Disconnected</span>
            )}
            {dbLatency !== undefined && (
              <span className="text-slate-400">({dbLatency}ms)</span>
            )}
          </div>
        </div>

        {health && (
          <div className="grid grid-cols-3 divide-x divide-y divide-slate-100">
            {Object.entries(health.database.counts).map(([key, count]) => (
              <div key={key} className="px-5 py-4">
                <p className="text-2xl font-bold text-slate-800">{count.toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-0.5">{TABLE_LABELS[key] ?? key}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Zoho Connections ── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">Zoho Books Connections</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Per-org OAuth token status।{' '}
            <a href="/dashboard/settings/organizations" className="text-blue-600 hover:underline">
              Manage in Organizations →
            </a>
          </p>
        </div>

        {!health || health.zoho_connections.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-400 text-center">
            कोई organization connected नहीं।{' '}
            <a href="/dashboard/settings/organizations" className="text-blue-600 hover:underline">
              Add करो
            </a>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {health.zoho_connections.map((conn) => {
              const tokenBad = conn.tokenExpired === true;
              const displayStatus = tokenBad ? 'expired' : conn.connectionStatus;
              return (
                <div key={conn.id} className="flex items-center justify-between px-5 py-3.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 truncate">
                        {conn.name}
                      </span>
                      {!conn.isActive && (
                        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                          inactive
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Org ID: {conn.zohoOrgId} · Last sync: {formatDate(conn.lastSyncAt)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0 ml-4">
                    <StatusBadge status={displayStatus} />
                    {conn.tokenExpiresAt && (
                      <span className={`text-[10px] ${tokenBad ? 'text-red-500' : 'text-slate-400'}`}>
                        Token {tokenBad ? 'expired' : 'expires'}: {formatDate(conn.tokenExpiresAt)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Integrations ── */}
      {health && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">Integrations</h2>
          </div>
          <div className="divide-y divide-slate-100">
            <div className="flex items-center justify-between px-5 py-3.5">
              <div>
                <p className="text-sm font-medium text-slate-800">Email (SendGrid)</p>
                <p className="text-xs text-slate-400">
                  {health.integrations.email === 'configured'
                    ? 'API key configured — emails will be delivered'
                    : 'API key not set — configure in Email Settings'}
                </p>
              </div>
              <StatusBadge
                status={health.integrations.email === 'configured' ? 'active' : 'disconnected'}
              />
            </div>
          </div>
        </div>
      )}

      <div className="text-xs text-slate-400 text-right">
        Page auto-refreshes on next visit · Last loaded: {new Date().toLocaleTimeString('en-IN')}
      </div>
    </div>
  );
}
