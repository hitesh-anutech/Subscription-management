'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SidebarNavLinkProps {
  href: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
}

export function SidebarNavLink({ href, label, icon, exact }: SidebarNavLinkProps) {
  const pathname = usePathname();
  const isActive = exact 
    ? pathname === href 
    : href === '/dashboard'
      ? pathname === '/dashboard'
      : pathname === href || pathname.startsWith(href + '/');

  return (
    <Link
      href={href as never}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
        isActive
          ? 'bg-blue-50/70 text-blue-600 shadow-sm border-l-4 border-blue-600 font-semibold pl-3'
          : 'text-slate-500 hover:bg-slate-100/50 hover:text-slate-800 border-l-4 border-transparent'
      }`}
    >
      <span className={`transition-transform duration-200 ${isActive ? 'scale-110 text-blue-600' : 'text-slate-400 group-hover:text-slate-600'}`}>
        {icon}
      </span>
      <span>{label}</span>
    </Link>
  );
}

