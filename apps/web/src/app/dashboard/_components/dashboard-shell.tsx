'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard, ListChecks, Target, FileText, FileSpreadsheet,
  Globe, Users, Settings, ShieldCheck, History, Bug,
  ChevronsLeft, ChevronsRight,
  type LucideIcon,
} from 'lucide-react';
import { LogoutButton } from './logout-button';
import { GlobalSearch } from './global-search';
import { SidebarNavLink } from './sidebar-nav-link';
import { BugReporter } from '@/components/bug-reporter';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  subItems?: { href: string; label: string }[];
};

const navItems: NavItem[] = [
  { href: '/dashboard',                               label: 'Dashboard',         icon: LayoutDashboard, exact: true },
  { href: '/dashboard/leads',                         label: 'Leads',             icon: Target },
  { href: '/dashboard/quick-quotes',                  label: 'Quick Quotes',      icon: FileText },
  { href: '/dashboard/documents',                     label: 'Quotes & Invoices', icon: FileSpreadsheet },
  { href: '/dashboard/customers',                     label: 'Customers',         icon: Users },
  { href: '/dashboard/subscriptions',                 label: 'Subscriptions',     icon: ListChecks, exact: true },
  { href: '/dashboard/subscriptions/billing-history', label: 'Billing History',   icon: History },
  { href: '/dashboard/domains',                       label: 'Domains',           icon: Globe },
  { href: '/dashboard/admin/users',                   label: 'User Access',       icon: ShieldCheck },
  { href: '/dashboard/admin/bug-reports',             label: 'Bug Reports',       icon: Bug },
];

type Props = {
  initials: string;
  displayName: string;
  children: React.ReactNode;
};

export function DashboardShell({ initials, displayName, children }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('sidebar_collapsed');
    if (stored !== null) setCollapsed(stored === 'true');
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      localStorage.setItem('sidebar_collapsed', String(!prev));
      return !prev;
    });
  };

  return (
    <div className="h-screen flex flex-col bg-slate-50/50 overflow-hidden">
      {/* Top bar */}
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

        <div className="flex items-center gap-3 text-sm">
          <BugReporter />
          <div className="flex items-center gap-2.5 bg-slate-100/80 px-3 py-1.5 rounded-xl border border-slate-200/30">
            <span className="w-6 h-6 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shadow-sm">
              {initials}
            </span>
            <span className="text-slate-700 font-medium text-xs hidden sm:inline-block">
              {displayName}
            </span>
          </div>
          <LogoutButton />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — dark theme like Zoho Books */}
        <aside
          className={`hidden md:flex flex-col bg-[#1a2332] shrink-0 transition-all duration-200 ${
            collapsed ? 'w-14' : 'w-60'
          }`}
        >
          {/* Nav items */}
          <div className="flex-1 overflow-y-auto py-4 space-y-0.5">
            {!collapsed && (
              <div className="px-4 mb-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Main Menu</span>
              </div>
            )}

            {navItems.map((item) => (
              <div key={item.href} className={collapsed ? 'px-1' : 'px-2'}>
                <SidebarNavLink
                  href={item.href}
                  label={item.label}
                  icon={<item.icon size={18} />}
                  exact={item.exact}
                  collapsed={collapsed}
                />
                {!collapsed && item.subItems && (
                  <div className="ml-7 mt-0.5 space-y-0.5">
                    {item.subItems.map((sub) => (
                      <Link
                        key={sub.href}
                        href={sub.href as never}
                        className="block px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-white/10 hover:text-white font-medium transition-colors"
                      >
                        {sub.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div className={`border-t border-white/10 my-3 ${collapsed ? 'mx-2' : 'mx-4'}`} />

            {!collapsed && (
              <div className="px-4 mb-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Configuration</span>
              </div>
            )}

            <div className={collapsed ? 'px-1' : 'px-2'}>
              <SidebarNavLink
                href="/dashboard/settings/organizations"
                label="Settings"
                icon={<Settings size={18} />}
                collapsed={collapsed}
              />
            </div>
          </div>

          {/* Toggle button — bottom of sidebar, like Zoho Books */}
          <div className={`border-t border-white/10 p-2 flex ${collapsed ? 'justify-center' : 'justify-end'}`}>
            <button
              onClick={toggle}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="flex items-center justify-center w-9 h-9 rounded-lg border border-white/20 bg-white/5 text-slate-400 hover:bg-white/15 hover:text-white transition-all"
            >
              {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            </button>
          </div>
        </aside>

        {/* Main Workspace */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto bg-slate-50/50">
          {children}
        </main>
      </div>
    </div>
  );
}
