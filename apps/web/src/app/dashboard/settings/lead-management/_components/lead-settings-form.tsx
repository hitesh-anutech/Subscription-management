'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { saveLeadSettingsAction } from '../actions';

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold transition-colors">
      {pending ? 'Saving…' : 'Save Settings'}
    </button>
  );
}

interface SettingRow { key: string; value: string }

function val(settings: SettingRow[], key: string, fallback = '') {
  return settings.find((s) => s.key === key)?.value ?? fallback;
}

interface Props {
  settings: SettingRow[];
}

export function LeadSettingsForm({ settings }: Props) {
  const [state, action] = useFormState(
    async (_prev: { success?: boolean; error?: string } | null, fd: FormData) =>
      saveLeadSettingsAction(fd),
    null,
  );

  return (
    <form action={action} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
      <h2 className="text-base font-semibold text-slate-800">Lead Behavior Settings</h2>

      {state?.error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {state.error}
        </div>
      )}
      {state?.success && (
        <div className="px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
          ✅ Settings save हो गईं!
        </div>
      )}

      <div className="grid grid-cols-2 gap-5">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Auto-Archive After (days)
          </label>
          <input
            name="auto_archive_days"
            type="number"
            min={30}
            max={730}
            defaultValue={val(settings, 'auto_archive_days', '180')}
            className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-slate-400 mt-1">
            इतने दिन inactive रहने पर lead auto-archived।
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Assignment Method
          </label>
          <select
            name="assignment_method"
            defaultValue={val(settings, 'assignment_method', 'manual')}
            className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="manual">Manual (sales खुद assign करे)</option>
            <option value="round_robin">Round Robin (auto-rotate)</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Duplicate Detection
        </label>
        <select
          name="duplicate_detection"
          defaultValue={val(settings, 'duplicate_detection', 'warn')}
          className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="warn">Warn (allow करो लेकिन warning दो)</option>
          <option value="block">Block (same email पर duplicate lead नहीं बनने देना)</option>
          <option value="allow">Allow (कोई check नहीं)</option>
        </select>
        <p className="text-xs text-slate-400 mt-1">
          Same email address से new lead create करने पर behavior।
        </p>
      </div>

      <div className="flex justify-end pt-1">
        <SaveBtn />
      </div>
    </form>
  );
}
