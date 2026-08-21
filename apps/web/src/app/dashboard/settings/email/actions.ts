'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
const SESSION_COOKIE = 'subs_session';

async function getAuthHeader() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? '';
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

export async function saveEmailSettingsAction(formData: FormData) {
  const smtpUser = formData.get('smtp_user') as string;
  const smtpPass = formData.get('smtp_password') as string;
  const fromAddress = formData.get('from_address') as string;
  const fromName = formData.get('from_name') as string;
  const replyTo = (formData.get('reply_to') as string | null) ?? '';

  const settings = [
    { key: 'from_address', value: fromAddress, sensitive: false, description: 'Default "From" email address' },
    { key: 'from_name', value: fromName, sensitive: false, description: 'Default "From" display name' },
    { key: 'reply_to', value: replyTo, sensitive: false, description: 'Reply-to address (optional)' },
  ];

  // Gmail address — not sensitive
  if (smtpUser) {
    settings.push({ key: 'smtp_user', value: smtpUser, sensitive: false, description: 'Gmail address (SMTP username)' });
  }
  // App password — sensitive, only update if a new value entered (not masked dots)
  if (smtpPass && !smtpPass.includes('•')) {
    settings.push({ key: 'smtp_password', value: smtpPass, sensitive: true, description: 'Gmail App Password (encrypted)' });
  }

  try {
    const res = await fetch(`${API_BASE}/settings/email`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeader()),
      },
      body: JSON.stringify({ settings }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const err = await res.json() as { error?: { message: string } };
      return { error: err.error?.message ?? 'Save failed' };
    }

    revalidatePath('/dashboard/settings/email');
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}

export async function sendTestEmailAction(formData: FormData) {
  const to = formData.get('test_email') as string;
  if (!to) return { error: 'Email address required' };

  try {
    const res = await fetch(`${API_BASE}/settings/email/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeader()),
      },
      body: JSON.stringify({ to }),
      cache: 'no-store',
    });

    const data = await res.json() as { success: boolean; message: string };
    return data;
  } catch {
    return { success: false, message: 'Server से connect नहीं हो पाया' };
  }
}
