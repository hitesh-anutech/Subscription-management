import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Email Templates — Settings' };

const CATEGORY_LABELS: Record<string, string> = {
  quote:       '📄 Quote',
  subscription:'🔄 Subscription',
  payment:     '💰 Payment',
  customer:    '👤 Customer',
  system:      '⚙️ System',
  admin_alert: '🚨 Admin Alert',
};

interface Template {
  id: string;
  templateKey: string;
  templateName: string;
  category: string;
  subject: string;
  isActive: boolean;
  isSystem: boolean;
  updatedAt: string;
}

export default async function EmailTemplatesPage() {
  const cookieStore = await cookies();
  const serverApi = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let templates: Template[] = [];
  try {
    templates = await serverApi.get<Template[]>('/settings/email/templates');
  } catch {
    // API unreachable — show empty state
  }

  const grouped = templates.reduce<Record<string, Template[]>>((acc, t) => {
    if (!acc[t.category]) acc[t.category] = [];
    acc[t.category].push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Email Templates</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-xl">
            Central App द्वारा भेजी जाने वाली emails का content यहाँ edit करो।
            Zoho-triggered emails (Estimates, Invoices) Zoho Books &rarr; Settings &rarr; Email Notifications में configure होती हैं।
          </p>
        </div>
        <Link
          href="/dashboard/settings/email"
          className="text-sm text-slate-500 hover:text-slate-700 whitespace-nowrap"
        >
          ← Email Settings
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-slate-200 rounded-xl text-slate-400">
          <p className="font-medium">Templates नहीं मिलीं</p>
          <p className="text-sm mt-1">
            Database seed चलाओ:{' '}
            <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
              pnpm db:seed
            </code>
          </p>
        </div>
      ) : (
        Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              {CATEGORY_LABELS[category] ?? category}
            </h2>
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
              {items.map((t) => (
                <div
                  key={t.templateKey}
                  className="flex items-center justify-between px-5 py-3.5"
                >
                  <div className="min-w-0 mr-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">
                        {t.templateName}
                      </span>
                      {!t.isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                          Inactive
                        </span>
                      )}
                      {t.isSystem && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-500">
                          System
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 font-mono truncate">
                      {t.subject}
                    </p>
                  </div>
                  <Link
                    href={`/dashboard/settings/email/templates/${t.templateKey}`}
                    className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Edit
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
