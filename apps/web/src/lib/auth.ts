import { cookies } from 'next/headers';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
const SESSION_COOKIE = 'subs_session';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

/**
 * Get current user from session (server-side).
 * Reads cookie and calls /api/auth/me.
 * Returns null if not authenticated.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!token) return null;

    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      cache: 'no-store',
    });

    if (!res.ok) return null;
    const data = await res.json() as { user: AuthUser };
    return data.user;
  } catch {
    return null;
  }
}

/**
 * Login — calls API, response sets the httpOnly cookie via Set-Cookie.
 * Used in the login Server Action.
 */
export async function loginUser(
  email: string,
  password: string,
): Promise<{ user: AuthUser } | { error: string }> {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });

    const data = await res.json() as { user?: AuthUser; error?: { message: string } };

    if (!res.ok) {
      return { error: data.error?.message ?? 'Login failed' };
    }
    return { user: data.user! };
  } catch {
    return { error: 'Cannot connect to server' };
  }
}
