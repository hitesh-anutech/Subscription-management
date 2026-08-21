'use client';

import { logoutAction } from '@/app/login/actions';

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded hover:bg-slate-700 transition-colors"
      >
        Logout
      </button>
    </form>
  );
}
