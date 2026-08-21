import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { LeadSettingsForm } from './_components/lead-settings-form';
import { EditableList, type ListItem } from './_components/editable-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lead Management — Settings' };

interface SettingRow { key: string; value: string; isSensitive: boolean }

export default async function LeadManagementPage() {
  const cookieStore = await cookies();
  const api = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let settings: SettingRow[] = [];
  let leadSources: ListItem[] = [];
  let industries: ListItem[] = [];
  let lostReasons: ListItem[] = [];

  try {
    const [settingsData, sourcesData, industriesData, lostReasonsData] = await Promise.allSettled([
      api.get<{ settings: SettingRow[] }>('/settings/lead'),
      api.get<ListItem[]>('/master-data/lead_source'),
      api.get<ListItem[]>('/master-data/industry'),
      api.get<ListItem[]>('/master-data/lost_reason'),
    ]);

    if (settingsData.status === 'fulfilled') settings = settingsData.value.settings ?? [];
    if (sourcesData.status === 'fulfilled')   leadSources = sourcesData.value ?? [];
    if (industriesData.status === 'fulfilled') industries = industriesData.value ?? [];
    if (lostReasonsData.status === 'fulfilled') lostReasons = lostReasonsData.value ?? [];
  } catch {
    // show page with empty state
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Lead Management</h1>
        <p className="text-sm text-slate-500 mt-1">
          Lead behavior rules और editable dropdown lists — lead lifecycle configure करो।
        </p>
      </div>

      <LeadSettingsForm settings={settings} />

      <EditableList
        listType="lead_source"
        title="Lead Sources"
        description="कहाँ से leads आती हैं — quote form में dropdown।"
        items={leadSources}
      />

      <EditableList
        listType="industry"
        title="Industries"
        description="Lead/Customer industry — segmentation के लिए।"
        items={industries}
      />

      <EditableList
        listType="lost_reason"
        title="Lost Reasons"
        description="Deal lost होने पर reason — analysis के लिए।"
        items={lostReasons}
      />
    </div>
  );
}
