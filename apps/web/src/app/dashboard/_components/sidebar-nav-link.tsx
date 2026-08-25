'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SidebarNavLinkProps {
  href: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
  collapsed?: boolean;
}

export function SidebarNavLink({ href, label, icon, exact, collapsed }: SidebarNavLinkProps) {
  const pathname = usePathname();
  const isActive = exact
    ? pathname === href
    : href === '/dashboard'
      ? pathname === '/dashboard'
      : pathname === href || pathname.startsWith(href + '/');

  if (collapsed) {
    return (
      <Link
        href={href as never}
        title={label}
        className={`flex items-center justify-center w-10 h-10 mx-auto rounded-lg transition-all duration-200 ${
          isActive
            ? 'bg-green-600 text-white shadow-sm'
            : 'text-slate-400 hover:bg-white/10 hover:text-white'
        }`}
      >
        <span className={isActive ? 'text-white' : ''}>{icon}</span>
      </Link>
    );
  }

  return (
    <Link
      href={href as never}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
        isActive
          ? 'bg-green-600 text-white shadow-sm'
          : 'text-slate-300 hover:bg-white/10 hover:text-white'
      }`}
    >
      <span className={isActive ? 'text-white' : 'text-slate-400'}>{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}
