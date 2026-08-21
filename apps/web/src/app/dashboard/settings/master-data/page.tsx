import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { MasterList, type ListItem } from './_components/master-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Master Data — Settings' };

export default async function MasterDataPage() {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let billingCycles: ListItem[] = [];
  let subCategories: ListItem[] = [];
  let tags: ListItem[] = [];

  try {
    const [cyclesData, catsData, tagsData] = await Promise.allSettled([
      api.get<ListItem[]>('/master-data/billing_cycle'),
      api.get<ListItem[]>('/master-data/subscription_category'),
      api.get<ListItem[]>('/master-data/tag'),
    ]);

    if (cyclesData.status === 'fulfilled') billingCycles = cyclesData.value ?? [];
    if (catsData.status === 'fulfilled')   subCategories = catsData.value ?? [];
    if (tagsData.status === 'fulfilled')   tags = tagsData.value ?? [];
  } catch {
    // empty state
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Master Data & Lists</h1>
        <p className="text-sm text-slate-500 mt-1">
          Application-wide dropdown options manage करो — billing cycles, subscription categories, और tags।
        </p>
      </div>

      <MasterList
        listType="billing_cycle"
        title="Billing Cycles"
        description="Subscription billing frequency options — quote line items में use होती हैं।"
        items={billingCycles}
        addPlaceholderValue="half_yearly"
        addPlaceholderLabel="Half-Yearly"
      />

      <MasterList
        listType="subscription_category"
        title="Subscription Categories"
        description="Subscription classify करने के लिए — e.g., Cloud Services, Email, Backup।"
        items={subCategories}
        addPlaceholderValue="cloud_services"
        addPlaceholderLabel="Cloud Services"
      />

      <MasterList
        listType="tag"
        title="Tags"
        description="Leads, quotes, और subscriptions पर custom tags लगाने के लिए।"
        items={tags}
        addPlaceholderValue="priority_account"
        addPlaceholderLabel="Priority Account"
      />

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-500">
        <p className="font-medium text-slate-600 mb-1">Read-Only Lists</p>
        <p className="text-xs">
          GST Rates, Indian States, और Currencies system-seeded हैं और यहाँ editable नहीं हैं।
          Tax &amp; GST settings में GST rates configure होती हैं।
        </p>
      </div>
    </div>
  );
}
