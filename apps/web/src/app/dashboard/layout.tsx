import Link from 'next/link';
import {
  LayoutDashboard,
  ListChecks,
  Target,
  FileText,
  FileSpreadsheet,
  Globe,
  Users,
  Settings,
  ShieldCheck,
  History,
  type LucideIcon,
} from 'lucide-react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { LogoutButton } from './_components/logout-button';
import { GlobalSearch } from './_components/global-search';
import { SidebarNavLink } from './_components/sidebar-nav-link';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  subItems?: { href: string; label: string }[];
};

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/leads', label: 'Leads', icon: Target },
  { href: '/dashboard/quick-quotes', label: 'Quick Quotes', icon: FileText },
  { href: '/dashboard/documents', label: 'Quotes & Invoices', icon: FileSpreadsheet },
  { href: '/dashboard/customers', label: 'Customers', icon: Users },
  { href: '/dashboard/subscriptions', label: 'Subscriptions', icon: ListChecks, exact: true },
  { href: '/dashboard/subscriptions/billing-history', label: 'Billing History', icon: History },
  { href: '/dashboard/domains', label: 'Domains', icon: Globe },
  { href: '/dashboard/admin/users', label: 'User Access', icon: ShieldCheck },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const initials = (user.name ?? user.email)
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50">
      {/* Top bar (Glassmorphic & sticky) */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md px-6 py-3.5 flex items-center justify-between border-b border-slate-200/60 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-md shadow-blue-500/10">
            <span className="text-white text-base font-black">E</span>
          </div>
          <span className="font-extrabold text-slate-800 tracking-tight">ExcelTech Subscriptions</span>
          <span className="text-slate-300 text-sm">|</span>
          <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[10px] font-bold uppercase tracking-wider">
            MVP
          </span>
        </div>
        
        <div className="flex-1 max-w-xl mx-8">
          <GlobalSearch />
        </div>
        
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2.5 bg-slate-100/80 px-3 py-1.5 rounded-xl border border-slate-200/30">
            <span className="w-6 h-6 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shadow-sm">
              {initials}
            </span>
            <span className="text-slate-700 font-medium text-xs hidden sm:inline-block">
              {user.name ?? user.email}
            </span>
          </div>
          <LogoutButton />
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="w-60 bg-white border-r border-slate-200/60 p-4 space-y-1.5 hidden md:block shrink-0">
          <div className="px-3 mb-4">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Main Menu</span>
          </div>
          {navItems.map((item) => (
            <div key={item.href}>
              <SidebarNavLink href={item.href} label={item.label} icon={<item.icon size={16} />} exact={item.exact} />
              {item.subItems && (
                <div className="ml-7 mt-0.5 space-y-0.5">
                  {item.subItems.map((sub) => (
                    <Link
                      key={sub.href}
                      href={sub.href as never}
                      className="block px-3 py-1.5 rounded-lg text-xs hover:bg-slate-50 text-slate-500 font-medium transition-colors"
                    >
                      {sub.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="border-t border-slate-100 my-4" />
          <div className="px-3 mb-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Configuration</span>
          </div>
          <SidebarNavLink href="/dashboard/settings/organizations" label="Settings" icon={<Settings size={16} />} />
        </aside>

        {/* Main Workspace */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto bg-slate-50/50">
          {children}
        </main>
      </div>
    </div>
  );
}

