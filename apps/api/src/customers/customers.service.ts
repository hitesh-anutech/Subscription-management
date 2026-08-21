import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface CustomerColumn {
  key: string;            // 'displayName' | 'company_name' | 'cf:cf_xxx' | 'active_subscriptions'
  label: string;
  group: 'standard' | 'custom' | 'app';
  type?: string;          // 'string' | 'number' | 'date' | 'currency' | 'status'
}

export interface CustomerRow {
  zohoId: string;
  fields: Record<string, string | number>;
}

export interface SavedCustomerView {
  id: string;
  name: string;
  orgId?: string;
  columns: string[];      // ordered column keys
  sort?: { key: string; dir: 'asc' | 'desc' } | null;
  search?: string;
}

const VIEWS_PREF_KEY = 'zoho_customer_views';

/**
 * Extra-JSON keys that are already exposed as normalized columns (or are noise);
 * skip them so the catalog has no duplicates.
 */
const EXCLUDED_EXTRA_KEYS = new Set<string>([
  'contact_name', 'email', 'phone', 'gst_no', 'gstin', 'contact_id',
]);

/** Curated labels + type hints for well-known Zoho contact list fields. */
const KNOWN_FIELDS: Record<string, { label: string; type?: string }> = {
  company_name:                     { label: 'Company Name' },
  customer_sub_type:                { label: 'Customer Sub-Type' },
  contact_type:                     { label: 'Contact Type' },
  status:                           { label: 'Status', type: 'status' },
  customer_name:                    { label: 'Customer Name' },
  first_name:                       { label: 'First Name' },
  last_name:                        { label: 'Last Name' },
  mobile:                           { label: 'Mobile' },
  currency_code:                    { label: 'Currency' },
  gst_treatment:                    { label: 'GST Treatment' },
  tax_treatment:                    { label: 'Tax Treatment' },
  pan_no:                           { label: 'PAN' },
  place_of_contact:                 { label: 'Place of Supply (State)' },
  contact_number:                   { label: 'Customer #' },
  payment_terms:                    { label: 'Payment Terms (days)', type: 'number' },
  payment_terms_label:              { label: 'Payment Terms' },
  outstanding_receivable_amount:    { label: 'Outstanding', type: 'currency' },
  unused_credits_receivable_amount: { label: 'Unused Credits', type: 'currency' },
  outstanding_payable_amount:       { label: 'Outstanding (Payable)', type: 'currency' },
  notes:                            { label: 'Notes' },
  website:                          { label: 'Website' },
  facebook:                         { label: 'Facebook' },
  twitter:                          { label: 'Twitter' },
  designation:                      { label: 'Designation' },
  department:                       { label: 'Department' },
  created_time:                     { label: 'Created Time', type: 'date' },
  last_modified_time:               { label: 'Last Modified', type: 'date' },
  portal_status:                    { label: 'Portal Status', type: 'status' },
  language_code:                    { label: 'Language' },
};

/** cf_support_status → "Support Status" (fallback label when none is provided). */
function prettify(apiName: string): string {
  return apiName
    .replace(/^cf_/i, '')
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Infer a display type from the field name / value when it isn't curated. */
function inferType(key: string, value: unknown): string {
  if (/_time$|_date$|_at$/.test(key)) return 'date';
  if (/_amount$/.test(key)) return 'currency';
  if (typeof value === 'number') return 'number';
  return 'string';
}

/** Coerce any JSON scalar into a table-friendly value. */
function scalar(v: unknown): string | number {
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Column catalog — built dynamically from what's actually cached, so
  // we never offer a column that has no data. Groups:
  //   standard : normalized columns + scalar keys found in `extra`
  //   custom   : Zoho custom fields present in `extra.custom_fields[]`
  //   app      : counts joined from our own tables (subscriptions/domains)
  // ------------------------------------------------------------------
  async getColumns(orgId: string): Promise<{ columns: CustomerColumn[] }> {
    const columns: CustomerColumn[] = [
      { key: 'displayName', label: 'Name',  group: 'standard', type: 'string' },
      { key: 'email',       label: 'Email', group: 'standard', type: 'string' },
      { key: 'phone',       label: 'Phone', group: 'standard', type: 'string' },
      { key: 'gstin',       label: 'GSTIN', group: 'standard', type: 'string' },
    ];

    const sample = await this.prisma.zohoCache.findMany({
      where: { organizationId: orgId, entityType: 'customer' },
      select: { extra: true },
      take: 500,
    });

    const seenScalar = new Set<string>([...EXCLUDED_EXTRA_KEYS, 'displayName', 'email', 'phone', 'gstin']);
    const seenCf = new Set<string>();
    const cfCols: CustomerColumn[] = [];

    for (const r of sample) {
      const extra = (r.extra ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(extra)) {
        if (k === 'custom_fields') {
          const cfs = v as Array<{ api_name?: string; label?: string }> | undefined;
          for (const cf of cfs ?? []) {
            if (!cf?.api_name || seenCf.has(cf.api_name)) continue;
            seenCf.add(cf.api_name);
            cfCols.push({
              key: `cf:${cf.api_name}`,
              label: cf.label?.trim() || prettify(cf.api_name),
              group: 'custom',
              type: 'string',
            });
          }
          continue;
        }
        if (seenScalar.has(k) || v == null) continue;
        const t = typeof v;
        if (t !== 'string' && t !== 'number' && t !== 'boolean') continue; // skip nested objects/arrays
        seenScalar.add(k);
        const meta = KNOWN_FIELDS[k];
        columns.push({
          key: k,
          label: meta?.label ?? prettify(k),
          group: 'standard',
          type: meta?.type ?? inferType(k, v),
        });
      }
    }

    columns.push({ key: 'lastSyncedAt', label: 'Last Synced', group: 'standard', type: 'date' });
    columns.push(...cfCols);
    columns.push({ key: 'active_subscriptions',  label: 'Active Subscriptions',  group: 'app', type: 'number' });
    columns.push({ key: 'expired_subscriptions', label: 'Expired Subscriptions', group: 'app', type: 'number' });
    columns.push({ key: 'domains_mapped',        label: 'Domains Mapped',        group: 'app', type: 'number' });
    columns.push({ key: 'last_quote_number',    label: 'Last Quote #',         group: 'app', type: 'string' });
    columns.push({ key: 'last_quote_date',      label: 'Last Quote Date',      group: 'app', type: 'date' });
    columns.push({ key: 'last_invoice_number',  label: 'Last Invoice #',       group: 'app', type: 'string' });
    columns.push({ key: 'last_invoice_date',    label: 'Last Invoice Date',    group: 'app', type: 'date' });

    return { columns };
  }

  // ------------------------------------------------------------------
  // Paginated rows from the local cache (instant — no live Zoho call).
  // App-aggregate columns are filled with ONE batched groupBy per metric
  // over just this page's customers.
  // ------------------------------------------------------------------
  async getRows(
    orgId: string,
    params: { q?: string; page?: number; limit?: number },
  ): Promise<{ rows: CustomerRow[]; total: number; page: number; limit: number }> {
    const q = params.q?.trim() ?? '';
    const page = Math.max(params.page ?? 1, 1);
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const skip = (page - 1) * limit;

    const where = {
      organizationId: orgId,
      entityType: 'customer' as const,
      ...(q && {
        OR: [
          { displayName: { contains: q, mode: 'insensitive' as const } },
          { email: { contains: q } },
          { gstin: { contains: q } },
        ],
      }),
    };

    const [records, total] = await Promise.all([
      this.prisma.zohoCache.findMany({ where, orderBy: { displayName: 'asc' }, skip, take: limit }),
      this.prisma.zohoCache.count({ where }),
    ]);

    const zohoIds = records.map((r) => r.zohoId);

    const [subStatusGroups, domGroups, invSubs, quoteRows] = zohoIds.length
      ? await Promise.all([
          // One query groups by (customer, status) — derive active + expired counts from it.
          this.prisma.subscription.groupBy({
            by: ['zohoCustomerId', 'lifecycleStatus'],
            where: { organizationId: orgId, zohoCustomerId: { in: zohoIds } },
            _count: { _all: true },
          }),
          this.prisma.domain.groupBy({
            by: ['zohoCustomerId'],
            where: { organizationId: orgId, zohoCustomerId: { in: zohoIds } },
            _count: { _all: true },
          }),
          // Latest invoice per customer — from each subscription's last-invoice fields.
          this.prisma.subscription.findMany({
            where: { organizationId: orgId, zohoCustomerId: { in: zohoIds }, lastInvoiceId: { not: null } },
            select: { zohoCustomerId: true, lastInvoiceNumber: true, lastInvoiceDate: true },
          }),
          // Latest quote per customer — from Quick Quotes targeted at this org.
          this.prisma.quickQuote.findMany({
            where: { targetOrganizationId: orgId, zohoCustomerId: { in: zohoIds } },
            select: { zohoCustomerId: true, quoteNumber: true, quoteDate: true },
          }),
        ])
      : [[], [], [], []];

    // Build per-customer counts keyed by zohoCustomerId.
    const subCount        = new Map<string, number>();
    const expiredSubCount = new Map<string, number>();
    for (const g of subStatusGroups) {
      if (!g.zohoCustomerId) continue;
      const status = g.lifecycleStatus as string;
      if (status === 'Active' || status === 'Expiring_Soon') {
        subCount.set(g.zohoCustomerId, (subCount.get(g.zohoCustomerId) ?? 0) + g._count._all);
      } else if (status === 'Expired') {
        expiredSubCount.set(g.zohoCustomerId, (expiredSubCount.get(g.zohoCustomerId) ?? 0) + g._count._all);
      }
    }
    const domCount = new Map(domGroups.map((g) => [g.zohoCustomerId, g._count._all]));

    // Reduce to the single most-recent invoice / quote per customer (by date).
    type Latest = { number: string; date: Date | null; t: number };
    const reduceLatest = <T>(
      list: T[],
      cid: (x: T) => string | null,
      num: (x: T) => string | null,
      dt: (x: T) => Date | null,
    ): Map<string, Latest> => {
      const m = new Map<string, Latest>();
      for (const x of list) {
        const id = cid(x);
        if (!id) continue;
        const d = dt(x);
        const t = d ? new Date(d).getTime() : 0;
        const cur = m.get(id);
        if (!cur || t > cur.t) m.set(id, { number: num(x) ?? '', date: d, t });
      }
      return m;
    };
    const lastInvoice = reduceLatest(invSubs, (s) => s.zohoCustomerId, (s) => s.lastInvoiceNumber, (s) => s.lastInvoiceDate);
    const lastQuote   = reduceLatest(quoteRows, (q) => q.zohoCustomerId, (q) => q.quoteNumber, (q) => q.quoteDate);

    const rows = records.map((r) => {
      const extra = (r.extra ?? {}) as Record<string, unknown>;
      const fields: Record<string, string | number> = {
        displayName:  r.displayName ?? '',
        email:        r.email ?? '',
        phone:        r.phone ?? '',
        gstin:        r.gstin ?? '',
        lastSyncedAt: r.lastSyncedAt ? r.lastSyncedAt.toISOString() : '',
      };

      for (const [k, v] of Object.entries(extra)) {
        if (k === 'custom_fields') {
          const cfs = v as Array<{ api_name?: string; value?: unknown }> | undefined;
          for (const cf of cfs ?? []) {
            if (cf?.api_name) fields[`cf:${cf.api_name}`] = scalar(cf.value);
          }
          continue;
        }
        const t = typeof v;
        if (t === 'string' || t === 'number' || t === 'boolean') fields[k] = scalar(v);
      }

      fields.active_subscriptions  = subCount.get(r.zohoId) ?? 0;
      fields.expired_subscriptions = expiredSubCount.get(r.zohoId) ?? 0;
      fields.domains_mapped        = domCount.get(r.zohoId) ?? 0;

      const inv = lastInvoice.get(r.zohoId);
      const qt  = lastQuote.get(r.zohoId);
      fields.last_invoice_number = inv?.number ?? '';
      fields.last_invoice_date   = inv?.date ? inv.date.toISOString() : '';
      fields.last_quote_number   = qt?.number ?? '';
      fields.last_quote_date     = qt?.date ? qt.date.toISOString() : '';

      return { zohoId: r.zohoId, fields };
    });

    return { rows, total, page, limit };
  }

  // ------------------------------------------------------------------
  // Saved views — per-user, stored as a JSON array in user_preferences.
  // Mirrors DocumentsService, keyed by `zoho_customer_views`.
  // ------------------------------------------------------------------
  async listViews(userId: string): Promise<SavedCustomerView[]> {
    const pref = await this.prisma.userPreference.findUnique({
      where: { uq_user_preferences: { userId, preferenceKey: VIEWS_PREF_KEY } },
    });
    return ((pref?.preferenceValue as unknown) as SavedCustomerView[] | null) ?? [];
  }

  async saveView(userId: string, view: SavedCustomerView): Promise<SavedCustomerView[]> {
    const views = await this.listViews(userId);
    const id = view.id || randomUUID();
    const next = { ...view, id };
    const idx = views.findIndex((v) => v.id === id);
    if (idx >= 0) views[idx] = next; else views.push(next);
    await this.persistViews(userId, views);
    return views;
  }

  async deleteView(userId: string, viewId: string): Promise<SavedCustomerView[]> {
    const views = (await this.listViews(userId)).filter((v) => v.id !== viewId);
    await this.persistViews(userId, views);
    return views;
  }

  private async persistViews(userId: string, views: SavedCustomerView[]) {
    await this.prisma.userPreference.upsert({
      where:  { uq_user_preferences: { userId, preferenceKey: VIEWS_PREF_KEY } },
      create: { userId, preferenceKey: VIEWS_PREF_KEY, preferenceValue: views as unknown as object },
      update: { preferenceValue: views as unknown as object },
    });
  }
}
