'use client';

import { useState, useTransition } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

interface ZohoField {
  customfield_id: string; // Zoho's canonical id
  index: number;          // field slot (1-10) — the key Zoho's contacts write API accepts
  api_name: string;
  label: string;
  data_type: string;
  values: string[];       // dropdown option names (for picklist fields)
  is_mandatory: boolean;  // Zoho marks the field required → writes fail if not populated
}

// One mapping row: a Zoho field ← a value source (or a static default)
interface CfRow {
  zoho_api_name: string;
  customfield_id?: string;
  index?: number;
  label?: string;
  data_type?: string;
  source: string;   // value-source key OR 'static'
  default?: string;
}

// Zoho modules we map, in display order. Keys match the API's per-module response.
const MODULES = [
  { key: 'contacts',  label: 'Contact'  },
  { key: 'invoices',  label: 'Invoice'  },
  { key: 'estimates', label: 'Estimate' },
  { key: 'items',     label: 'Item'     },
] as const;

// Value sources the write services can supply (must match the API's `values` keys).
const VALUE_SOURCES = [
  { key: 'static',         label: 'Static value (fixed)' },
  { key: 'domain_name',    label: 'Domain Name' },
  { key: 'business_type',  label: 'Business Type (Fresh/Renewal/Pro-rata)' },
  { key: 'billing_period', label: 'Billing Period (Subs Period)' },
  { key: 'service_expiry', label: 'Service Expiry Date' },
  { key: 'start_date',     label: 'Start Date' },
  { key: 'end_date',       label: 'End Date' },
  { key: 'cost_price',     label: 'Cost Price' },
  { key: 'quantity',       label: 'Quantity / Licences' },
  { key: 'unit_price',     label: 'Unit Price / Rate' },
] as const;

// Zoho dropdown label → our BillingCycle enum value
function normalizeBillingCycle(label: string): string {
  const s = label.trim().toLowerCase();
  if (/month/.test(s))            return 'monthly';
  if (/quart|quater/.test(s))     return 'quarterly';   // handles Zoho's "Quaterly" typo
  if (/half/.test(s))             return 'half_yearly';
  if (/year|annual/.test(s))      return 'annual';
  if (/bienn/.test(s))            return 'biennial';
  if (/trienn/.test(s))           return 'triennial';
  if (/one.?time|onetime/.test(s)) return 'one_time';
  return 'annual'; // safe fallback
}

// Best-guess value source for a Zoho field, by keyword on api_name/label.
function guessSource(f: ZohoField): string {
  const s = `${f.api_name} ${f.label}`.toLowerCase();
  if (/domain/.test(s))                       return 'domain_name';
  if (/business.?type|sale.?type/.test(s))    return 'business_type';
  if (/subs.?period|billing.?period|cycle/.test(s)) return 'billing_period';
  if (/expiry|next.?invoice|renew/.test(s))   return 'service_expiry';
  if (/start/.test(s))                        return 'start_date';
  if (/end/.test(s))                          return 'end_date';
  if (/cost/.test(s))                         return 'cost_price';
  if (/licen|qty|quantity|seats?|users?/.test(s)) return 'quantity';
  if (/price|rate|amount/.test(s))            return 'unit_price';
  return 'static';
}

type FieldsByModule = Record<string, ZohoField[]>;
type MappingsByModule = Record<string, CfRow[]>;

interface Props {
  orgId: string;
  /** Either per-module custom_field_mappings, or legacy flat item_field_mappings. */
  currentMappings: Record<string, unknown>;
}

// Legacy flat item_field_mappings → per-module rows (best-effort migration).
// Each known source key applies to the modules it was historically used on.
const LEGACY_KEY_MODULES: Record<string, string[]> = {
  domain_name:    ['contacts', 'invoices', 'estimates', 'items'],
  business_type:  ['invoices', 'estimates'],
  billing_period: ['invoices', 'estimates'],
  service_expiry: ['invoices', 'estimates'],
  start_date:     ['items'],
  end_date:       ['items'],
  cost_price:     ['items'],
};

function seedMappings(current: Record<string, unknown>): MappingsByModule {
  const out: MappingsByModule = { contacts: [], invoices: [], estimates: [], items: [] };
  // Per-module shape already?
  const perModule = current as Record<string, CfRow[] | undefined>;
  const looksPerModule = MODULES.some((m) => Array.isArray(perModule[m.key]));
  if (looksPerModule) {
    for (const m of MODULES) out[m.key] = Array.isArray(perModule[m.key]) ? perModule[m.key]! : [];
    return out;
  }
  // Legacy flat { source → api_name }
  const flat = current as Record<string, string>;
  for (const [source, apiName] of Object.entries(flat)) {
    if (!apiName || typeof apiName !== 'string') continue;
    const mods = LEGACY_KEY_MODULES[source] ?? ['invoices'];
    for (const mod of mods) {
      out[mod].push({ zoho_api_name: apiName, source });
    }
  }
  return out;
}

export function ItemFieldMapping({ orgId, currentMappings }: Props) {
  const [open,    setOpen]    = useState(false);
  const [fieldsByModule, setFieldsByModule] = useState<FieldsByModule>({});
  const [fetched, setFetched] = useState(false);
  const [mappings, setMappings] = useState<MappingsByModule>(() => seedMappings(currentMappings ?? {}));
  const [activeModule, setActiveModule] = useState<string>('invoices');
  const [saving,  setSaving]  = useState(false);
  const [msg,     setMsg]     = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const totalRows = Object.values(mappings).reduce((n, rows) => n + rows.length, 0);

  const fetchFields = () => {
    startTransition(async () => {
      setMsg('⏳ Contacts, Invoices, Estimates, Items से custom fields fetch हो रहे हैं…');
      try {
        const res = await fetch(
          `${API_BASE}/organizations/${orgId}/zoho-custom-fields?modules=Invoices,Estimates,Items,Contacts`,
          { credentials: 'include' },
        );
        if (!res.ok) { setMsg('❌ Fetch failed — Zoho connected है?'); return; }
        type RawField = { customfield_id?: string; index?: number; api_name: string; label: string; data_type: string; values?: string[]; is_mandatory?: boolean };
        const data = await res.json() as Record<string, RawField[] | undefined>;

        const byModule: FieldsByModule = {};
        for (const m of MODULES) {
          byModule[m.key] = (data[m.key] ?? []).map((f) => ({
            customfield_id: f.customfield_id ?? '',
            index:        f.index ?? 0,
            api_name:     f.api_name,
            label:        f.label,
            data_type:    f.data_type,
            values:       f.values ?? [],
            is_mandatory: f.is_mandatory === true,
          }));
        }
        setFieldsByModule(byModule);
        setFetched(true);

        // Backfill customfield_id + index into already-saved rows (matched by api_name)
        // so a plain Fetch → Save upgrades old mappings without re-picking every field.
        setMappings((prev) => {
          const next: MappingsByModule = {};
          for (const m of MODULES) {
            next[m.key] = (prev[m.key] ?? []).map((row) => {
              if (!row.zoho_api_name || (row.customfield_id && row.index)) return row;
              const f = byModule[m.key].find((x) => x.api_name === row.zoho_api_name);
              return f ? { ...row, customfield_id: f.customfield_id, index: f.index } : row;
            });
          }
          return next;
        });

        const counts = MODULES.map((m) => `${m.label}:${byModule[m.key].length}`).join(' · ');
        setMsg(`✅ Fetched (${counts})`);
      } catch {
        setMsg('❌ Server से connect नहीं हो पाया');
      }
    });
  };

  // --- Row mutators (scoped per module) ---
  const setRows = (mod: string, rows: CfRow[]) =>
    setMappings((prev) => ({ ...prev, [mod]: rows }));

  const addRow = (mod: string) =>
    setRows(mod, [...(mappings[mod] ?? []), { zoho_api_name: '', source: 'static', default: '' }]);

  const updateRow = (mod: string, idx: number, patch: Partial<CfRow>) => {
    const rows = [...(mappings[mod] ?? [])];
    rows[idx] = { ...rows[idx], ...patch };
    setRows(mod, rows);
  };

  const removeRow = (mod: string, idx: number) =>
    setRows(mod, (mappings[mod] ?? []).filter((_, i) => i !== idx));

  // When the Zoho field changes, carry its label/data_type onto the row.
  const onPickField = (mod: string, idx: number, apiName: string) => {
    const f = (fieldsByModule[mod] ?? []).find((x) => x.api_name === apiName);
    updateRow(mod, idx, {
      zoho_api_name:  apiName,
      customfield_id: f?.customfield_id,
      index:          f?.index,
      label:     f?.label,
      data_type: f?.data_type,
    });
  };

  // Add a row for every mandatory Zoho field in the module not yet mapped.
  const autoAddMandatory = (mod: string) => {
    const mapped = new Set((mappings[mod] ?? []).map((r) => r.zoho_api_name).filter(Boolean));
    const toAdd = (fieldsByModule[mod] ?? []).filter((f) => f.is_mandatory && !mapped.has(f.api_name));
    if (!toAdd.length) return;
    const newRows: CfRow[] = toAdd.map((f) => ({
      zoho_api_name:  f.api_name,
      customfield_id: f.customfield_id,
      index:          f.index,
      label:     f.label,
      data_type: f.data_type,
      source:    guessSource(f),
      default:   '',
    }));
    setRows(mod, [...(mappings[mod] ?? []), ...newRows]);
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      // Derive billing-period options from whichever mapped billing_period field has values.
      // Prefer Invoice, then Estimate, then any module.
      const findFieldBySource = (source: string): ZohoField | undefined => {
        for (const mod of ['invoices', 'estimates', 'items', 'contacts']) {
          const row = (mappings[mod] ?? []).find((r) => r.source === source && r.zoho_api_name);
          if (row) {
            const f = (fieldsByModule[mod] ?? []).find((x) => x.api_name === row.zoho_api_name);
            if (f?.values.length) return f;
          }
        }
        return undefined;
      };
      const bpField = findFieldBySource('billing_period');
      const billingOptions = (bpField?.values ?? []).map((label) => ({
        value: normalizeBillingCycle(label),
        label,
      }));
      const businessOptions = findFieldBySource('business_type')?.values ?? [];

      // Drop empty rows (no Zoho field chosen) before saving.
      const clean: MappingsByModule = {};
      for (const m of MODULES) {
        clean[m.key] = (mappings[m.key] ?? []).filter((r) => r.zoho_api_name);
      }

      const res = await fetch(`${API_BASE}/organizations/${orgId}/item-field-mappings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ customFieldMappings: clean, billingOptions, businessOptions }),
      });
      const saved = Object.values(clean).reduce((n, r) => n + r.length, 0);
      setMsg(res.ok
        ? `✅ Saved! ${saved} field mapping(s)${billingOptions.length ? ` · ${billingOptions.length} billing options` : ''}`
        : '❌ Save failed');
    } catch {
      setMsg('❌ Server से connect नहीं हो पाया');
    } finally {
      setSaving(false);
    }
  };

  const moduleFields  = fieldsByModule[activeModule] ?? [];
  const moduleRows    = mappings[activeModule] ?? [];
  const mappedApiSet  = new Set(moduleRows.map((r) => r.zoho_api_name).filter(Boolean));
  const unmappedMandatory = moduleFields.filter((f) => f.is_mandatory && !mappedApiSet.has(f.api_name));
  const activeLabel = MODULES.find((m) => m.key === activeModule)?.label ?? activeModule;

  return (
    <div className="mt-3 pt-3 border-t border-slate-200">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1.5"
      >
        <span>{open ? '▾' : '▸'}</span>
        🗂️ Custom Field Mapping (per module)
        {totalRows > 0 ? (
          <span className="ml-1 text-green-600 text-xs">({totalRows} mapped)</span>
        ) : (
          <span className="ml-1 text-amber-500 text-xs">not configured</span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-500">
            Zoho Books की तरह — हर module (<strong>Contact, Invoice, Estimate, Item</strong>) के लिए
            custom field add करो और Zoho field से map करो। हर field की value किसी app data source से
            आएगी या एक fixed (static) value होगी। यह values Zoho पर write (conversion/renewal) के समय भेजी जाएँगी।
          </p>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={fetchFields}
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              ↓ Fetch Custom Fields from Zoho
            </button>
            {msg && <span className="text-xs text-slate-600">{msg}</span>}
          </div>

          {/* Module tabs */}
          <div className="flex items-center gap-1 border-b border-slate-200">
            {MODULES.map((m) => {
              const count = (mappings[m.key] ?? []).filter((r) => r.zoho_api_name).length;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setActiveModule(m.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${
                    activeModule === m.key
                      ? 'bg-violet-50 text-violet-700 border-b-2 border-violet-600'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {m.label}
                  {count > 0 && <span className="ml-1 text-green-600">({count})</span>}
                </button>
              );
            })}
          </div>

          {/* Rows for the active module */}
          <div className="space-y-2">
            {moduleRows.length === 0 && (
              <p className="text-xs text-slate-400 italic">कोई field नहीं — नीचे “+ Add field” से जोड़ो।</p>
            )}

            {moduleRows.map((row, idx) => {
              const selField = moduleFields.find((f) => f.api_name === row.zoho_api_name);
              const isPicklist = (selField?.values.length ?? 0) > 0;
              const isStatic = row.source === 'static';
              return (
                <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                  {/* Zoho field */}
                  {fetched && moduleFields.length > 0 ? (
                    <select
                      value={row.zoho_api_name}
                      onChange={(e) => onPickField(activeModule, idx, e.target.value)}
                      className="px-2 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                    >
                      <option value="">— Zoho field चुनो —</option>
                      {moduleFields.map((f) => (
                        <option key={f.api_name} value={f.api_name}>
                          {f.is_mandatory ? '★ ' : ''}{f.label} · {f.api_name}
                          {f.data_type !== 'text' && f.data_type !== 'string' ? ` (${f.data_type})` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={row.zoho_api_name}
                      onChange={(e) => updateRow(activeModule, idx, { zoho_api_name: e.target.value })}
                      placeholder="cf_api_name"
                      className="px-2 py-1.5 border border-slate-300 rounded text-xs font-mono bg-white"
                    />
                  )}

                  {/* Value source */}
                  <select
                    value={row.source}
                    onChange={(e) => updateRow(activeModule, idx, { source: e.target.value })}
                    className="px-2 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                  >
                    {VALUE_SOURCES.map((s) => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </select>

                  {/* Value / default */}
                  {isStatic ? (
                    isPicklist ? (
                      <select
                        value={row.default ?? ''}
                        onChange={(e) => updateRow(activeModule, idx, { default: e.target.value })}
                        className="px-2 py-1.5 border border-slate-300 rounded text-xs bg-white"
                      >
                        <option value="">— value चुनो —</option>
                        {selField!.values.map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={row.default ?? ''}
                        onChange={(e) => updateRow(activeModule, idx, { default: e.target.value })}
                        placeholder="fixed value"
                        className="px-2 py-1.5 border border-slate-300 rounded text-xs bg-white"
                      />
                    )
                  ) : (
                    <div className="px-2 py-1.5 text-xs text-slate-400 italic truncate">
                      ← {VALUE_SOURCES.find((s) => s.key === row.source)?.label ?? row.source} से
                    </div>
                  )}

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => removeRow(activeModule, idx)}
                    className="px-2 py-1 text-slate-400 hover:text-red-600 text-sm"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => addRow(activeModule)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors"
            >
              + Add field
            </button>
            {fetched && unmappedMandatory.length > 0 && (
              <button
                type="button"
                onClick={() => autoAddMandatory(activeModule)}
                className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-medium rounded-lg transition-colors"
              >
                ⚡ Auto-add {unmappedMandatory.length} mandatory
              </button>
            )}
          </div>

          {/* Health-check: mandatory Zoho fields not yet mapped in this module */}
          {fetched && unmappedMandatory.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-xs text-red-700">
              <p className="font-semibold">
                ⚠️ {activeLabel} के ये mandatory fields अभी map नहीं हुए:
              </p>
              <ul className="mt-1 space-y-0.5">
                {unmappedMandatory.map((f) => (
                  <li key={f.api_name} className="font-mono">{f.label} · {f.api_name}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-red-600">
                इन्हें map नहीं किया तो conversion/renewal के समय Zoho इस module का document <strong>reject</strong> कर सकता है।
              </p>
            </div>
          )}

          {(fetched || totalRows > 0) && (
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : 'Save Mapping'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
