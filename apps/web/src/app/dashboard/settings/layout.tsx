import Link from 'next/link';

const sections = [
  { href: '/dashboard/settings/organizations', label: '🏢 Organizations & Zoho', mvp: true },
  { href: '/dashboard/settings/email', label: '📧 Email Configuration', mvp: true },
  { href: '/dashboard/settings/zoho', label: '🔑 Zoho App Credentials', mvp: true },
  { href: '/dashboard/settings/quick-quote', label: '📄 Quick Quote Settings', mvp: true },
  { href: '/dashboard/settings/pdf-branding', label: '🎨 PDF Branding', mvp: true },
  { href: '/dashboard/settings/subscription-lifecycle', label: '🔄 Subscription Lifecycle', mvp: true },
  { href: '/dashboard/settings/lead-management', label: '🎯 Lead Management', mvp: true },
  { href: '/dashboard/settings/tax', label: '💰 Tax & GST', mvp: true },
  { href: '/dashboard/settings/notifications', label: '🔔 Notifications', mvp: true },
  { href: '/dashboard/settings/master-data', label: '📋 Master Data', mvp: true },
  { href: '/dashboard/settings/system-health', label: '🩺 System Health', mvp: true },
  { href: '/dashboard/settings/users', label: '👥 Users & Roles', mvp: false },
  { href: '/dashboard/settings/security', label: '🛡️ Security & Audit', mvp: false },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-6">
      <aside className="w-60 shrink-0">
        <h2 className="text-sm font-semibold text-slate-500 mb-3 uppercase tracking-wide">Settings</h2>
        <nav className="space-y-1">
          {sections.map((s) => (
            <Link
              key={s.label}
              href={s.disabled ? '#' : (s.href as never)}
              className={
                s.disabled
                  ? 'block px-3 py-2 rounded text-sm text-slate-400'
                  : 'block px-3 py-2 rounded text-sm text-slate-700 hover:bg-slate-100'
              }
            >
              {s.label}
              {!s.mvp && (
                <span className="ml-2 text-[10px] text-slate-400">Phase 2</span>
              )}
              {s.disabled && s.mvp && (
                <span className="ml-2 text-[10px] text-slate-400">soon</span>
              )}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
