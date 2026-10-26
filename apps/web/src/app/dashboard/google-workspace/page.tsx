import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { ResellerSubsTable } from './_components/reseller-subs-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Google Workspace Reconciliation' };

export type ResellerSubRow = {
  id: string;
  googleSubscriptionId: string;
  customerId: string;
  customerUid: string | null;
  customerDomain: string;
  skuId: string;
  skuName: string | null;
  googleStatus: string;
  planName: string | null;
  isCommitmentPlan: boolean | null;
  seatsLicensed: number | null;
  seatsMaximum: number | null;
  renewalType: string | null;
  isInTrial: boolean | null;
  trialEndTime: string | null;
  googleCreationTime: string | null;
  suspensionReasons: string[];
  resellerSlot: number;
  resellerEmail: string | null;
  subscriptionFetchedAt: string | null;
  orgName: string | null;
  contactName: string | null;
  alternateEmail: string | null;
  countryCode: string | null;
  customerCreationTime: string | null;
  resourceUiUrl: string | null;
  customerFetchedAt: string | null;
  additionalDomains: string[];
  reconciliationStatus: string;
  reconciliationFlags: string[];
  matchedDomainId: string | null;
  matchedSubscriptionId: string | null;
  matchedDomainName: string | null;
  appSeats: number | null;
  reconciledAt: string | null;
  createdAt: string;
  updatedAt: string;
  matchedDomain: { id: string; domainName: string } | null;
  matchedSubscription: {
    id: string;
    subscriptionNumber: string;
    zohoItemName: string | null;
    lifecycleStatus: string;
  } | null;
};

type ListResponse = {
  rows: ResellerSubRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: { matched: number; notMatched: number; excluded: number; all: number };
};

export default async function GoogleWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{
    reconciliationStatus?: string;
    googleStatus?: string;
    resellerSlot?: string;
    skuName?: string;
    hasFlag?: string;
    search?: string;
    page?: string;
    limit?: string;
    sortBy?: string;
    sortDir?: string;
  }>;
}) {
  const sp = await searchParams;
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  const page = Number(sp.page ?? 1);
  const limit = [25, 50, 100, 200].includes(Number(sp.limit)) ? Number(sp.limit) : 50;

  const params = new URLSearchParams();
  if (sp.reconciliationStatus) params.set('reconciliationStatus', sp.reconciliationStatus);
  if (sp.googleStatus)         params.set('googleStatus', sp.googleStatus);
  if (sp.resellerSlot)         params.set('resellerSlot', sp.resellerSlot);
  if (sp.skuName)              params.set('skuName', sp.skuName);
  if (sp.hasFlag)              params.set('hasFlag', sp.hasFlag);
  if (sp.search)               params.set('search', sp.search);
  if (sp.sortBy)               params.set('sortBy', sp.sortBy);
  if (sp.sortDir)              params.set('sortDir', sp.sortDir);
  params.set('page', String(page));
  params.set('limit', String(limit));

  let data: ListResponse = {
    rows: [], total: 0, page: 1, limit: 50, totalPages: 0,
    summary: { matched: 0, notMatched: 0, excluded: 0, all: 0 },
  };
  let skuNames: string[] = [];
  let resellerNames: { 1: string; 2: string } = { 1: 'Slot 1', 2: 'Slot 2' };

  try {
    const [listData, skuData, status] = await Promise.all([
      api.get<ListResponse>(`/google-workspace/reseller-subs?${params.toString()}`),
      api.get<string[]>('/google-workspace/reseller-subs/sku-names'),
      api.get<{ slot1?: { name?: string | null }; slot2?: { name?: string | null } }>('/google-workspace/status'),
    ]);
    data = listData;
    skuNames = skuData;
    resellerNames = {
      1: status.slot1?.name || 'Slot 1',
      2: status.slot2?.name || 'Slot 2',
    };
  } catch {
    // Show empty table if API is unavailable
  }

  return (
    <div className="flex flex-col px-6 pt-5 pb-2 gap-3 overflow-hidden" style={{ height: 'calc(100vh - 56px)' }}>
      <div className="flex-shrink-0">
        <h1 className="text-xl font-semibold text-gray-900">Google Workspace Reconciliation</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Google Reseller Console के subscriptions और app subscriptions के बीच match करें
        </p>
      </div>

      <ResellerSubsTable
        rows={data.rows}
        total={data.total}
        page={page}
        limit={limit}
        totalPages={data.totalPages}
        summary={data.summary}
        skuNames={skuNames}
        resellerNames={resellerNames}
        filters={{
          reconciliationStatus: sp.reconciliationStatus,
          googleStatus: sp.googleStatus,
          resellerSlot: sp.resellerSlot,
          skuName: sp.skuName,
          hasFlag: sp.hasFlag,
          search: sp.search,
          sortBy: sp.sortBy,
          sortDir: sp.sortDir,
        }}
      />
    </div>
  );
}
