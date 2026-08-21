'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
const SESSION_COOKIE = 'subs_session';

export async function loginAction(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Email और password दोनों जरूरी हैं' };
  }

  let responseData: { user?: { id: string; email: string; name: string | null; role: string }; error?: { message: string } };
  let setCookieHeader: string | null = null;

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });

    // Capture Set-Cookie from API response
    setCookieHeader = res.headers.get('set-cookie');
    responseData = await res.json() as typeof responseData;

    if (!res.ok) {
      return { error: responseData.error?.message ?? 'Login failed' };
    }
  } catch {
    return { error: 'Server से connect नहीं हो पाया। API running है?' };
  }

  // Extract token from Set-Cookie header and set it in Next.js cookies
  if (setCookieHeader) {
    const tokenMatch = setCookieHeader.match(/subs_session=([^;]+)/);
    if (tokenMatch) {
      const cookieStore = await cookies();
      cookieStore.set(SESSION_COOKIE, tokenMatch[1], {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60, // 30 days
        path: '/',
      });
    }
  }

  redirect('/dashboard');
}

export async function logoutAction() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    // Tell API to destroy the session
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE}=${token}` },
        cache: 'no-store',
      });
    } catch {
      // Best-effort — clear cookie anyway
    }
  }

  cookieStore.delete(SESSION_COOKIE);
  redirect('/login');
}
