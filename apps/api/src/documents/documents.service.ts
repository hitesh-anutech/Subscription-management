import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ZohoService, CfRow } from '../zoho/zoho.service';

export type DocType = 'estimates' | 'invoices';

export interface DocumentColumn {
  key: string;            // 'date' | 'total' | 'cf:cf_domain_name' …
  label: string;
  group: 'standard' | 'custom';
  type?: string;          // 'string' | 'number' | 'date' | 'currency' | 'status'
}

export interface DocumentRow {
  id: string;             // estimate_id / invoice_id (also the Zoho deep-link id)
  number: string;         // estimate_number / invoice_number
  fields: Record<string, string | number>;
}

export interface DocumentFilters {
  status?: string;
  dateStart?: string;
  dateEnd?: string;
  customerId?: string;
  referenceNumber?: string;
  businessType?: string;
  expiryFrom?: string;
  expiryTo?: string;
}

export interface SavedDocumentView {
  id: string;
  name: string;
  docType: DocType;
  orgId?: string;
  filters: DocumentFilters;
  columns: string[];      // ordered column keys
  sort?: { key: string; dir: 'asc' | 'desc' } | null;
}

const VIEWS_PREF_KEY = 'zoho_document_views';

/** cf_domain_name → "Domain Name" (fallback when the mapping row has no label). */
function prettify(apiName: string): string {
  return apiName
    .replace(/^cf_/i, '')
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Standard (non-custom) columns available per document type. */
function standardColumns(docType: DocType): DocumentColumn[] {
  const numberLabel = docType === 'estimates' ? 'Quote Number' : 'Invoice Number';
  const common: DocumentColumn[] = [
    { key: 'date',            label: 'Date',            group: 'standard', type: 'date' },
    { key: 'number',          label: numberLabel,       group: 'standard', type: 'string' },
    { key: 'reference_number', label: 'Reference#',     group: 'standard', type: 'string' },
    { key: 'customer_name',   label: 'Customer Name',   group: 'standard', type: 'string' },
    { key: 'company_name',    label: 'Company Name',    group: 'standard', type: 'string' },
    { key: 'status',          label: 'Status',          group: 'standard', type: 'status' },
    { key: 'currency_code',   label: 'Currency',        group: 'standard', type: 'string' },
    { key: 'sub_total',       label: 'Sub Total',       group: 'standard', type: 'currency' },
    { key: 'total',           label: 'Total',           group: 'standard', type: 'currency' },
    { key: 'salesperson_name', label: 'Sales Person',   group: 'standard', type: 'string' },
    { key: 'created_time',    label: 'Created Time',     group: 'standard', type: 'date' },
  ];
  if (docType === 'estimates') {
    common.push({ key: 'expiry_date', label: 'Expiry Date', group: 'standard', type: 'date' });
    // Linked Tax Invoice (the invoice this quote was converted into) + its payment.
    common.push({ key: 'invoice_number', label: 'Invoice# (linked)', group: 'standard', type: 'string' });
    common.push({ key: 'invoice_date',   label: 'Invoice Date',      group: 'standard', type: 'date' });
    common.push({ key: 'invoice_status', label: 'Invoice Status',    group: 'standard', type: 'status' });
    common.push({ key: 'payment_date',   label: 'Payment Date',      group: 'standard', type: 'date' });
  } else {
    common.push({ key: 'due_date', label: 'Due Date', group: 'standard', type: 'date' });
    common.push({ key: 'balance',  label: 'Balance',  group: 'standard', type: 'currency' });
    // Originating quote (the estimate this invoice was created from) + this invoice's payment.
    common.push({ key: 'quote_number', label: 'Quote# (source)', group: 'standard', type: 'string' });
    common.push({ key: 'quote_date',   label: 'Quote Date',      group: 'standard', type: 'date' });
    common.push({ key: 'quote_status', label: 'Quote Status',    group: 'standard', type: 'status' });
    common.push({ key: 'payment_date', label: 'Payment Date',    group: 'standard', type: 'date' });
  }
  return common;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zoho: ZohoService,
  ) {}

  // ------------------------------------------------------------------
  // Document PDF — DB-cached bytes of a Zoho estimate/invoice (0 Zoho calls
  // on repeat opens). Delegates to ZohoService.getDocumentPdf.
  // ------------------------------------------------------------------
  getPdf(
    orgId: string,
    kind: 'estimate' | 'invoice',
    docId: string,
    opts?: { force?: boolean },
  ): Promise<{ data: Buffer; number: string | null }> {
    return this.zoho.getDocumentPdf(orgId, kind, docId, opts);
  }

  // ------------------------------------------------------------------
  // Column catalog — standard + the org's custom fields for the module.
  // ------------------------------------------------------------------
  async getColumns(orgId: string, docType: DocType): Promise<{ columns: DocumentColumn[] }> {
    const columns = standardColumns(docType);

    const orgSettings = await this.prisma.orgSettings.findUnique({ where: { organizationId: orgId } });
    const meta = ((orgSettings?.metadata ?? {}) as Record<string, unknown>);
    const perModule = meta.custom_field_mappings as Record<string, CfRow[]> | undefined;
    const rows = perModule?.[docType] ?? [];

    const seen = new Set<string>();
    for (const row of rows) {
      if (!row.zoho_api_name || seen.has(row.zoho_api_name)) continue;
      seen.add(row.zoho_api_name);
      columns.push({
        key: `cf:${row.zoho_api_name}`,
        label: row.label?.trim() || prettify(row.zoho_api_name),
        group: 'custom',
        type: row.data_type || 'string',
      });
    }
    return { columns };
  }

  // ------------------------------------------------------------------
  // Filtered + paginated live fetch from Zoho (one page at a time).
  // Each row is enriched with a detail call to pull header custom fields.
  // ------------------------------------------------------------------
  async fetchDocuments(
    orgId: string,
    docType: DocType,
    filters: DocumentFilters,
    page = 1,
    perPage = 50,
  ): Promise<{ rows: DocumentRow[]; page: number; perPage: number; hasMore: boolean }> {
    const client = await this.zoho.clientFor(orgId);
    const listPath = docType === 'estimates' ? '/estimates' : '/invoices';
    const cap = Math.min(Math.max(perPage, 1), 100);

    const params: Record<string, unknown> = { page, per_page: cap };
    if (filters.status)          params.status           = filters.status;
    if (filters.dateStart)       params.date_start       = filters.dateStart;
    if (filters.dateEnd)         params.date_end         = filters.dateEnd;
    if (filters.customerId)      params.customer_id      = filters.customerId;
    if (filters.referenceNumber) params.reference_number = filters.referenceNumber;

    const listResp = await client.get<{
      estimates?: Array<{ estimate_id: string }>;
      invoices?: Array<{ invoice_id: string }>;
      page_context?: { has_more_page?: boolean };
    }>(listPath, params);

    const ids = docType === 'estimates'
      ? (listResp.estimates ?? []).map((e) => e.estimate_id)
      : (listResp.invoices ?? []).map((i) => i.invoice_id);

    const kind: 'estimate' | 'invoice' = docType === 'estimates' ? 'estimate' : 'invoice';
    const idField   = docType === 'estimates' ? 'estimate_id' : 'invoice_id';
    const numberField = docType === 'estimates' ? 'estimate_number' : 'invoice_number';

    const rows = await Promise.all(
      ids.map(async (id): Promise<DocumentRow | null> => {
        try {
          // PERF_PLAN #1: short-TTL cached detail — repeat page views cost 0 Zoho calls.
          const d = await this.zoho.getDocDetailCached(orgId, kind, id);
          if (!d) return null;
          const row = this.normalizeRow(d, docType, idField, numberField);
          await this.addLinkedFields(orgId, docType, d, row);
          return row;
        } catch (err) {
          this.logger.warn(`Detail fetch failed for ${docType} ${id}: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      }),
    );

    const filtered = this.postFilter(rows.filter((r): r is DocumentRow => r !== null), filters);

    return {
      rows: filtered,
      page,
      perPage: cap,
      hasMore: listResp.page_context?.has_more_page ?? false,
    };
  }

  /** Flatten a Zoho estimate/invoice detail into a { standard + cf:* } field map. */
  private normalizeRow(
    d: Record<string, unknown>,
    docType: DocType,
    idField: string,
    numberField: string,
  ): DocumentRow {
    const str = (v: unknown): string => (v == null ? '' : String(v));
    const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);

    const fields: Record<string, string | number> = {
      date:             str(d.date),
      number:           str(d[numberField]),
      reference_number: str(d.reference_number),
      customer_name:    str(d.customer_name),
      company_name:     str(d.company_name) || str(d.customer_name),
      status:           str(d.status),
      currency_code:    str(d.currency_code),
      sub_total:        num(d.sub_total),
      total:            num(d.total),
      salesperson_name: str(d.salesperson_name),
      created_time:     str(d.created_time),
    };
    if (docType === 'estimates') {
      fields.expiry_date = str(d.expiry_date);
    } else {
      fields.due_date = str(d.due_date);
      fields.balance  = num(d.balance);
    }

    const cfs = (d.custom_fields as Array<{ api_name?: string; value?: string | number }> | undefined) ?? [];
    for (const cf of cfs) {
      if (cf.api_name) fields[`cf:${cf.api_name}`] = cf.value != null ? cf.value : '';
    }

    return { id: str(d[idField]), number: str(d[numberField]), fields };
  }

  /**
   * Cross-link a row to its counterpart document (one extra Zoho call when a link exists):
   *  - estimates → follow `invoice_id` to the Tax Invoice (number/date/status + payment date)
   *  - invoices  → follow `estimate_id` to the originating quote (number/date/status);
   *                the invoice's own payment date comes from its detail (no extra call).
   * Best-effort: a failed/absent link just leaves those cells blank.
   */
  private async addLinkedFields(
    orgId: string,
    docType: DocType,
    d: Record<string, unknown>,
    row: DocumentRow,
  ): Promise<void> {
    const S = (v: unknown): string => (v == null ? '' : String(v));
    const isoDate = (v: Date | null | undefined): string => (v ? v.toISOString().slice(0, 10) : '');
    const firstPaymentDate = (doc: Record<string, unknown>): string => {
      const payments = doc.payments as Array<{ date?: string }> | undefined;
      return S(doc.last_payment_date) || S(payments?.[0]?.date);
    };

    if (docType === 'estimates') {
      if (S(d.invoice_number)) row.fields.invoice_number = S(d.invoice_number);

      // PERF_PLAN #2: local-first. renewal_history already carries the linked invoice
      // (number/date/status/payment), keyed by quoteId and kept fresh by webhooks — so
      // most rows fill with ZERO extra Zoho calls.
      const estimateId = S(d.estimate_id);
      if (estimateId) {
        const hist = await this.prisma.renewalHistory.findFirst({
          where: { organizationId: orgId, quoteId: estimateId, invoiceId: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { invoiceNumber: true, invoiceDate: true, zohoInvoiceStatus: true, paymentDate: true },
        });
        if (hist?.invoiceNumber) {
          row.fields.invoice_number = hist.invoiceNumber || row.fields.invoice_number || '';
          row.fields.invoice_date   = isoDate(hist.invoiceDate);
          row.fields.invoice_status = hist.zohoInvoiceStatus ?? '';
          row.fields.payment_date   = isoDate(hist.paymentDate);
          return;
        }
      }

      // Fallback: follow the estimate's linked invoice via the cached detail
      // (still 0 Zoho calls on repeat views — see PERF_PLAN #1).
      const invoiceId = S(d.invoice_id);
      if (!invoiceId) return;
      try {
        const inv = await this.zoho.getDocDetailCached(orgId, 'invoice', invoiceId);
        if (inv) {
          row.fields.invoice_number = S(inv.invoice_number) || row.fields.invoice_number || '';
          row.fields.invoice_date   = S(inv.date);
          row.fields.invoice_status = S(inv.status);
          row.fields.payment_date   = firstPaymentDate(inv);
        }
      } catch (err) {
        this.logger.warn(`Linked invoice ${invoiceId} fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // Invoice's own payment info is on its detail already.
      row.fields.payment_date = firstPaymentDate(d);
      const estimateId = S(d.estimate_id);
      if (!estimateId) return;
      // Originating quote number/date aren't stored locally → cached estimate detail
      // (0 Zoho calls on repeat views — see PERF_PLAN #1).
      try {
        const est = await this.zoho.getDocDetailCached(orgId, 'estimate', estimateId);
        if (est) {
          row.fields.quote_number = S(est.estimate_number);
          row.fields.quote_date   = S(est.date);
          row.fields.quote_status = S(est.status);
        }
      } catch (err) {
        this.logger.warn(`Linked estimate ${estimateId} fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * In-app post-filter for Business Type (cf_new_business) and Service-Expiry range
   * (cf_next_invoice_date) — Zoho's raw custom-field query syntax is unreliable, so we
   * filter the fetched page here (same approach as the import wizard).
   */
  private postFilter(rows: DocumentRow[], filters: DocumentFilters): DocumentRow[] {
    const { businessType, expiryFrom, expiryTo } = filters;
    if (!businessType && !expiryFrom && !expiryTo) return rows;

    const toTime = (s: string): number | null => {
      if (!s) return null;
      let dt = new Date(s);
      if (isNaN(dt.getTime()) && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
        const [dd, mm, yy] = s.split('/').map((p) => parseInt(p, 10));
        dt = new Date(yy, mm - 1, dd);
      }
      return isNaN(dt.getTime()) ? null : dt.getTime();
    };
    const from = expiryFrom ? toTime(expiryFrom) : null;
    const to   = expiryTo   ? toTime(expiryTo)   : null;

    return rows.filter((r) => {
      if (businessType) {
        const bt = String(r.fields['cf:cf_new_business'] ?? '').toLowerCase();
        if (bt !== businessType.toLowerCase()) return false;
      }
      if (from != null || to != null) {
        const exp = toTime(String(r.fields['cf:cf_next_invoice_date'] ?? ''));
        if (exp == null) return false;
        if (from != null && exp < from) return false;
        if (to != null && exp > to) return false;
      }
      return true;
    });
  }

  // ------------------------------------------------------------------
  // Saved views — per-user, stored as a JSON array in user_preferences.
  // ------------------------------------------------------------------
  async listViews(userId: string): Promise<SavedDocumentView[]> {
    const pref = await this.prisma.userPreference.findUnique({
      where: { uq_user_preferences: { userId, preferenceKey: VIEWS_PREF_KEY } },
    });
    return ((pref?.preferenceValue as unknown) as SavedDocumentView[] | null) ?? [];
  }

  async saveView(userId: string, view: SavedDocumentView): Promise<SavedDocumentView[]> {
    const views = await this.listViews(userId);
    const id = view.id || randomUUID();
    const next = { ...view, id };
    const idx = views.findIndex((v) => v.id === id);
    if (idx >= 0) views[idx] = next; else views.push(next);
    await this.persistViews(userId, views);
    return views;
  }

  async deleteView(userId: string, viewId: string): Promise<SavedDocumentView[]> {
    const views = (await this.listViews(userId)).filter((v) => v.id !== viewId);
    await this.persistViews(userId, views);
    return views;
  }

  private async persistViews(userId: string, views: SavedDocumentView[]) {
    await this.prisma.userPreference.upsert({
      where:  { uq_user_preferences: { userId, preferenceKey: VIEWS_PREF_KEY } },
      create: { userId, preferenceKey: VIEWS_PREF_KEY, preferenceValue: views as unknown as object },
      update: { preferenceValue: views as unknown as object },
    });
  }
}
