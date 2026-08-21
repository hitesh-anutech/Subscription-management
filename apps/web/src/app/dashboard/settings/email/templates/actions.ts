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

export async function saveTemplateAction(
  templateKey: string,
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const subject = (formData.get('subject') as string | null)?.trim();
  const bodyHtml = (formData.get('body_html') as string | null)?.trim();

  if (!subject) return { error: 'Subject required है' };
  if (!bodyHtml) return { error: 'Body HTML required है' };

  try {
    const res = await fetch(`${API_BASE}/settings/email/templates/${templateKey}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthHeader()),
      },
      body: JSON.stringify({ subject, bodyHtml }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const err = (await res.json()) as { error?: { message: string } };
      return { error: err.error?.message ?? 'Save failed' };
    }

    revalidatePath('/dashboard/settings/email/templates');
    revalidatePath(`/dashboard/settings/email/templates/${templateKey}`);
    return { success: true };
  } catch {
    return { error: 'Server से connect नहीं हो पाया' };
  }
}
