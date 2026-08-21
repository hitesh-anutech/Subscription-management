'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';

export async function createLeadAction(_prev: { error?: string } | null, formData: FormData) {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  const body = {
    company_name:             formData.get('company_name') as string,
    contact_name:             formData.get('contact_name')             || undefined,
    email:                    formData.get('email') as string,
    phone:                    formData.get('phone')                    || undefined,
    designation:              formData.get('designation')              || undefined,
    city:                     formData.get('city')                     || undefined,
    state:                    formData.get('state')                    || undefined,
    state_code:               formData.get('state_code')               || undefined,
    postal_code:              formData.get('postal_code')              || undefined,
    billing_address_line1:    formData.get('billing_address_line1')    || undefined,
    billing_address_line2:    formData.get('billing_address_line2')    || undefined,
    gstin:                    formData.get('gstin')                    || undefined,
    gst_treatment:            formData.get('gst_treatment')            || undefined,
    pan:                      formData.get('pan')                      || undefined,
    primary_domain:           formData.get('primary_domain')           || undefined,
    industry:                 formData.get('industry')                 || undefined,
    lead_source:              formData.get('lead_source')              || undefined,
    estimated_value:          formData.get('estimated_value') ? Number(formData.get('estimated_value')) : undefined,
    estimated_close_date:     formData.get('estimated_close_date')     || undefined,
    notes:                    formData.get('notes')                    || undefined,
    target_organization_id:   formData.get('target_organization_id')   || undefined,
  };

  let leadId: string;
  try {
    const lead = await api.post<{ id: string; leadNumber: string }>('/leads', body);
    revalidatePath('/dashboard/leads');
    leadId = lead.id;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Lead create नहीं हो पाया' };
  }
  // redirect() throws NEXT_REDIRECT by design — must run OUTSIDE the try/catch
  // or the catch swallows it and surfaces "NEXT_REDIRECT" as a form error.
  redirect(`/dashboard/leads/${leadId}`);
}

export async function updateLeadAction(id: string, _prev: { error?: string } | null, formData: FormData) {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  const body: Record<string, unknown> = {};
  const fields = [
    'company_name','contact_name','email','phone','designation',
    'city','state','state_code','postal_code',
    'billing_address_line1','billing_address_line2',
    'gstin','gst_treatment','pan','primary_domain','industry','lead_source',
    'status','notes','lost_reason','target_organization_id',
    'estimated_close_date',
  ];
  for (const f of fields) {
    const v = formData.get(f);
    if (v !== null) body[f] = v || undefined;
  }
  if (formData.get('estimated_value')) {
    body.estimated_value = Number(formData.get('estimated_value'));
  }

  try {
    await api.patch(`/leads/${id}`, body);
    revalidatePath(`/dashboard/leads/${id}`);
    revalidatePath('/dashboard/leads');
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Update नहीं हो पाया' };
  }
}

import { getCurrentUser } from '@/lib/auth';

export async function deleteLeadAction(id: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Admin') {
    throw new Error('Unauthorized — Only Admin can delete a lead');
  }

  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  await api.delete(`/leads/${id}`);
  revalidatePath('/dashboard/leads');
  redirect('/dashboard/leads');
}

export async function syncLeadToZohoAction(id: string) {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  
  try {
    await api.post(`/leads/${id}/sync`, {});
    revalidatePath(`/dashboard/leads/${id}`);
    revalidatePath('/dashboard/leads');
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Zoho sync failed' };
  }
}

export async function deleteMultipleLeadsAction(ids: string[]) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Admin') {
    throw new Error('Unauthorized — Only Admin can delete leads');
  }

  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');
  
  for (const id of ids) {
    await api.delete(`/leads/${id}`);
  }
  revalidatePath('/dashboard/leads');
}
