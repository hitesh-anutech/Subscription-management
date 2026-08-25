import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { SettingsService } from '../settings/settings.service';
import { ZohoApiClient } from './zoho-api.client';

/**
 * One per-module custom-field mapping row.
 * `source` is a value-source key (domain_name, business_type, billing_period,
 * service_expiry, start_date, end_date, cost_price, quantity, unit_price) or "static".
 * `default` is used when source==="static", or as a fallback when the bound source is empty.
 */
export interface CfRow {
  zoho_api_name: string;
  customfield_id?: string;
  index?: number;           // Zoho's field slot (1-10) — the key Zoho's contacts write API accepts
  label?: string;
  data_type?: string;
  source: string;
  default?: string;
}

/** cf_subscription_start_date → "Subscription Start Date" */
function prettifyApiName(apiName: string): string {
  return apiName
    .replace(/^cf_/i, '')
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * ZohoService — owns OAuth lifecycle for all orgs.
 *
 * Public API:
 *   - buildAuthorizeUrl(orgId)          → URL to redirect the admin to
 *   - completeOAuth(code, state)        → after callback, store tokens
 *   - disconnect(orgId)                 → clear tokens
 *   - clientFor(orgId)                  → ZohoApiClient instance (cached)
 *   - testConnection(orgId)             → tries GET /organizations
 *
 * Per Zoho Spec §3 (OAuth) and §12 (Token Refresh).
 */
@Injectable()
export class ZohoService {
  private readonly logger = new Logger(ZohoService.name);
  private readonly clientCache = new Map<string, ZohoApiClient>();

  // ------------------------------------------------------------------
  // In-memory caches (PERF_PLAN #1/#4/#5/#6a). Singleton service → these
  // persist across requests for the process lifetime.
  //  - tokenCache : org → decrypted access token (skips DB read + AES decrypt per call)
  //  - docCache   : org:kind:id → estimate/invoice detail (short TTL; the N+1 killer)
  //  - orgMetaCache: org → org_settings.metadata (memoized; rebuilt on any mapping write)
  // NOTE: process-local (not shared across instances / lost on restart). A DB-backed
  // upgrade (reuse zoho_cache) is the documented follow-up — see PERF_PLAN.md.
  // ------------------------------------------------------------------
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>();
  private readonly docCache = new Map<string, { data: Record<string, unknown>; expiresAt: number }>();
  private readonly orgMetaCache = new Map<string, { meta: Record<string, unknown>; expiresAt: number }>();

  /** Doc-detail cache TTL — documents browser re-hits the same pages a lot. */
  private static readonly DOC_CACHE_TTL_MS = 10 * 60_000;      // 10 min
  /** Org-settings metadata memo TTL — mappings change rarely; write paths invalidate. */
  private static readonly ORG_META_TTL_MS = 60_000;            // 1 min
  /** Full-contact freshness window for the customer detail page. */
  private static readonly CONTACT_TTL_MS = 6 * 60 * 60_000;    // 6 h

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  // ------------------------------------------------------------------
  // Cache helpers
  // ------------------------------------------------------------------

  /**
   * Fetch an estimate/invoice detail with a short-TTL in-memory cache (PERF_PLAN #1).
   * Returns the inner `estimate`/`invoice` object (already unwrapped), or null.
   * A cache hit costs ZERO Zoho calls — this is the single biggest call reducer for
   * the documents browser + import wizard (each did 1 detail call per row).
   */
  async getDocDetailCached<T extends Record<string, unknown> = Record<string, unknown>>(
    orgId: string,
    kind: 'estimate' | 'invoice',
    id: string,
    ttlMs: number = ZohoService.DOC_CACHE_TTL_MS,
  ): Promise<T | null> {
    if (!id) return null;
    const key = `${orgId}:${kind}:${id}`;
    const hit = this.docCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.data as T;

    const client = await this.clientFor(orgId);
    const path = kind === 'estimate' ? `/estimates/${id}` : `/invoices/${id}`;
    const resp = await client.get<Record<string, unknown>>(path);
    const data = resp?.[kind] as T | undefined;
    if (data) this.docCache.set(key, { data: data as Record<string, unknown>, expiresAt: Date.now() + ttlMs });
    return data ?? null;
  }

  /**
   * Lookup a Zoho estimate by its display number (e.g. "EST-000123").
   * Validates that the document belongs to the expected customer contact.
   * Used when manually linking a quote to an imported subscription via the Edit form.
   */
  async lookupEstimateByNumber(
    orgId: string,
    estimateNumber: string,
    expectedContactId: string,
  ): Promise<{ estimateId: string; estimateNumber: string; date: string }> {
    const client = await this.clientFor(orgId);
    const resp = await client.get<{
      estimates: Array<{ estimate_id: string; estimate_number: string; customer_id: string; date: string }>;
    }>('/estimates', { estimate_number: estimateNumber });

    const estimates = resp?.estimates ?? [];
    if (!estimates.length) {
      throw new BadRequestException(`Estimate "${estimateNumber}" Zoho Books mein nahi mila`);
    }
    const est = estimates[0];
    if (est.customer_id !== expectedContactId) {
      throw new BadRequestException(
        `Estimate "${estimateNumber}" is subscription ke customer se match nahi karta`,
      );
    }
    return { estimateId: est.estimate_id, estimateNumber: est.estimate_number, date: est.date };
  }

  /**
   * Lookup a Zoho invoice by its display number (e.g. "INV-000456").
   * Validates that the document belongs to the expected customer contact.
   * Used when manually linking an invoice to an imported subscription via the Edit form.
   */
  async lookupInvoiceByNumber(
    orgId: string,
    invoiceNumber: string,
    expectedContactId: string,
  ): Promise<{ invoiceId: string; invoiceNumber: string; date: string }> {
    const client = await this.clientFor(orgId);
    const resp = await client.get<{
      invoices: Array<{ invoice_id: string; invoice_number: string; customer_id: string; date: string }>;
    }>('/invoices', { invoice_number: invoiceNumber });

    const invoices = resp?.invoices ?? [];
    if (!invoices.length) {
      throw new BadRequestException(`Invoice "${invoiceNumber}" Zoho Books mein nahi mila`);
    }
    const inv = invoices[0];
    if (inv.customer_id !== expectedContactId) {
      throw new BadRequestException(
        `Invoice "${invoiceNumber}" is subscription ke customer se match nahi karta`,
      );
    }
    return { invoiceId: inv.invoice_id, invoiceNumber: inv.invoice_number, date: inv.date };
  }

  /** Drop a cached estimate/invoice detail (called from the webhook path — PERF_PLAN #3). */
  invalidateDocCache(orgId: string | null | undefined, kind: 'estimate' | 'invoice', id: string) {
    if (!id) return;
    if (orgId) { this.docCache.delete(`${orgId}:${kind}:${id}`); return; }
    // Org unknown (webhooks may omit it): clear any org's entry for this id.
    for (const k of this.docCache.keys()) {
      if (k.endsWith(`:${kind}:${id}`)) this.docCache.delete(k);
    }
  }

  /**
   * Fetch an estimate/invoice PDF, backed by a DB cache (`zoho_document_pdf`).
   * A cache hit costs ZERO Zoho calls; a miss fetches `GET /{kind}s/{id}?accept=pdf`,
   * stores the bytes, and returns them. `force` bypasses the cache (re-fetch + refresh).
   * The webhook path invalidates the stored row when the doc changes (see
   * `invalidateDocPdf`), so stored PDFs never go stale silently.
   */
  async getDocumentPdf(
    orgId: string,
    kind: 'estimate' | 'invoice',
    docId: string,
    opts?: { force?: boolean },
  ): Promise<{ data: Buffer; number: string | null }> {
    if (!docId) throw new BadRequestException('Document id required');

    if (!opts?.force) {
      const cached = await this.prisma.zohoDocumentPdf.findUnique({
        where: { uq_zoho_document_pdf: { organizationId: orgId, entityType: kind, zohoDocId: docId } },
      });
      if (cached) return { data: Buffer.from(cached.pdfData), number: cached.zohoDocNumber };
    }

    const client = await this.clientFor(orgId);
    const path = kind === 'estimate' ? `/estimates/${docId}` : `/invoices/${docId}`;
    const data = await client.getBinary(path, { accept: 'pdf' });

    // Doc number for the filename — from the short-TTL detail cache (usually 0 extra calls).
    let number: string | null = null;
    try {
      const detail = await this.getDocDetailCached(orgId, kind, docId);
      const field = kind === 'estimate' ? 'estimate_number' : 'invoice_number';
      number = detail ? String(detail[field] ?? '') || null : null;
    } catch { /* filename falls back to the id */ }

    await this.prisma.zohoDocumentPdf.upsert({
      where: { uq_zoho_document_pdf: { organizationId: orgId, entityType: kind, zohoDocId: docId } },
      create: { organizationId: orgId, entityType: kind, zohoDocId: docId, zohoDocNumber: number, pdfData: data, byteSize: data.length },
      update: { pdfData: data, byteSize: data.length, zohoDocNumber: number, fetchedAt: new Date() },
    });

    return { data, number };
  }

  /** Drop a stored PDF (called from the webhook path when the doc changes). */
  async invalidateDocPdf(orgId: string | null | undefined, kind: 'estimate' | 'invoice', id: string) {
    if (!id) return;
    try {
      await this.prisma.zohoDocumentPdf.deleteMany({
        where: orgId ? { organizationId: orgId, entityType: kind, zohoDocId: id } : { entityType: kind, zohoDocId: id },
      });
    } catch (err) {
      this.logger.warn(`invalidateDocPdf failed for ${kind} ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** org_settings.metadata with a short-TTL memo (PERF_PLAN #6a). */
  private async getOrgMeta(orgId: string): Promise<Record<string, unknown>> {
    const hit = this.orgMetaCache.get(orgId);
    if (hit && hit.expiresAt > Date.now()) return hit.meta;
    const orgSettings = await this.prisma.orgSettings.findUnique({ where: { organizationId: orgId } });
    const meta = ((orgSettings?.metadata ?? {}) as Record<string, unknown>);
    this.orgMetaCache.set(orgId, { meta, expiresAt: Date.now() + ZohoService.ORG_META_TTL_MS });
    return meta;
  }

  /** Invalidate the org-meta memo (called after any mapping/settings write). */
  private invalidateOrgMeta(orgId: string) {
    this.orgMetaCache.delete(orgId);
  }

  /**
   * Get Zoho Client ID — DB first, then .env fallback.
   */
  private async getClientId(): Promise<string> {
    const fromDb = await this.settings.get('zoho', 'client_id');
    const fromEnv = this.config.get<string>('ZOHO_CLIENT_ID', '');
    const value = fromDb || fromEnv;
    if (!value) throw new BadRequestException(
      'Zoho Client ID not configured. Go to Settings → Zoho App Credentials to set it.',
    );
    return value;
  }

  /**
   * Get Zoho Client Secret — DB first, then .env fallback.
   */
  private async getClientSecret(): Promise<string> {
    const fromDb = await this.settings.get('zoho', 'client_secret');
    const fromEnv = this.config.get<string>('ZOHO_CLIENT_SECRET', '');
    const value = fromDb || fromEnv;
    if (!value) throw new BadRequestException(
      'Zoho Client Secret not configured. Go to Settings → Zoho App Credentials to set it.',
    );
    return value;
  }

  /**
   * Build the Zoho OAuth authorize URL.
   * State carries the org id so we know which org to attach tokens to on callback.
   */
  async buildAuthorizeUrl(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException(`Organization ${orgId} not found`);

    // DB-first, .env fallback
    const clientId = await this.getClientId();
    const accountsUrl = this.config.get<string>('ZOHO_ACCOUNTS_URL', 'https://accounts.zoho.in');
    const redirectUri = this.config.get<string>('ZOHO_REDIRECT_URI')!;

    const state = this.crypto.randomToken(24);
    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        // Reuse metadata JSONB for transient OAuth state (10 min TTL enforced at consume time)
        metadata: {
          ...((org.metadata as Record<string, unknown>) ?? {}),
          oauth_state: state,
          oauth_state_issued_at: new Date().toISOString(),
        },
      },
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'ZohoBooks.fullaccess.all,ZohoBooks.settings.READ',
      redirect_uri: redirectUri,
      state,
      access_type: 'offline',
      prompt: 'consent',
    });

    return `${accountsUrl}/oauth/v2/auth?${params.toString()}`;
  }

  /**
   * Exchange authorization code → access + refresh tokens, store encrypted.
   * Looks up the org by matching the state value.
   */
  async completeOAuth(code: string, state: string) {
    if (!code || !state) {
      throw new BadRequestException('Missing code or state');
    }

    // Find the org whose pending state matches
    const orgs = await this.prisma.organization.findMany({
      where: { metadata: { path: ['oauth_state'], equals: state } },
    });
    if (orgs.length === 0) {
      throw new UnauthorizedException('Unknown or expired OAuth state');
    }
    const org = orgs[0];

    // State TTL check: 10 minutes
    const issuedAtStr = (org.metadata as Record<string, unknown>)?.oauth_state_issued_at as string | undefined;
    if (issuedAtStr) {
      const ageMs = Date.now() - new Date(issuedAtStr).getTime();
      if (ageMs > 10 * 60 * 1000) {
        throw new UnauthorizedException('OAuth state expired (>10 min). Please retry.');
      }
    }

    const accountsUrl = this.config.get<string>('ZOHO_ACCOUNTS_URL')!;
    const clientId = await this.getClientId();
    const clientSecret = await this.getClientSecret();
    const redirectUri = this.config.get<string>('ZOHO_REDIRECT_URI')!;

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    });

    let resp: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope?: string;
      api_domain?: string;
    };
    try {
      const { data } = await axios.post(
        `${accountsUrl}/oauth/v2/token`,
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 },
      );
      resp = data;
    } catch (err) {
      this.logger.error('Zoho OAuth token exchange failed', err instanceof Error ? err.stack : err);
      throw new UnauthorizedException('Zoho token exchange failed — check client credentials');
    }

    if (!resp.access_token || !resp.refresh_token) {
      throw new UnauthorizedException(`Zoho response missing tokens: ${JSON.stringify(resp)}`);
    }

    const expiresAt = new Date(Date.now() + resp.expires_in * 1000);

    // Clear the consumed state
    const newMetadata = { ...((org.metadata as Record<string, unknown>) ?? {}) };
    delete newMetadata.oauth_state;
    delete newMetadata.oauth_state_issued_at;

    await this.prisma.organization.update({
      where: { id: org.id },
      data: {
        accessTokenEncrypted: this.crypto.encrypt(resp.access_token),
        refreshTokenEncrypted: this.crypto.encrypt(resp.refresh_token),
        tokenExpiresAt: expiresAt,
        scopes: resp.scope ?? null,
        connectionStatus: 'active',
        metadata: newMetadata as Record<string, string>,
      },
    });

    // Invalidate cached client + token (forces fresh token next call)
    this.clientCache.delete(org.id);
    this.tokenCache.delete(org.id);

    this.logger.log(`✓ Zoho connected for org "${org.name}" (expires ${expiresAt.toISOString()})`);

    return { organization_id: org.id, name: org.name, connected_at: new Date(), expires_at: expiresAt };
  }

  // ------------------------------------------------------------------
  // Custom Fields — Fetch from Zoho (admin maps them in App)
  // ------------------------------------------------------------------

  /**
   * Fetch all custom fields for given modules from Zoho.
   * Returns raw field list — admin maps them to our internal keys in the UI.
   * Tries both document-level and line-item level fields.
   */
  async fetchZohoCustomFields(orgId: string, modules: string[]): Promise<
    Record<string, Array<{ customfield_id: string; index: number; api_name: string; label: string; data_type: string; is_active: boolean; is_mandatory: boolean; values: string[] }>>
  > {
    const client = await this.clientFor(orgId);
    const result: Record<string, Array<{ customfield_id: string; index: number; api_name: string; label: string; data_type: string; is_active: boolean; is_mandatory: boolean; values: string[] }>> = {};

    // Zoho Books expects a SINGULAR, lowercase `entity` query param
    // (e.g. entity=invoice / entity=item) — NOT `module=Invoices`.
    const entityMap: Record<string, string> = {
      invoices:  'invoice',
      estimates: 'estimate',
      items:     'item',
      contacts:  'contact',
    };

    // The modern Zoho Books endpoint is `/settings/fields` (returns a `fields` array).
    // `/settings/customfields` is a legacy path; try fields first, fall back.
    const endpoints = ['/settings/fields', '/settings/customfields'];

    for (const module of modules) {
      const key    = module.toLowerCase();
      const entity = entityMap[key] ?? key.replace(/s$/, '');
      let fetched: Array<{ customfield_id: string; index: number; api_name: string; label: string; data_type: string; is_active: boolean; is_mandatory: boolean; values: string[] }> = [];

      for (const path of endpoints) {
        try {
          const resp = await client.get<{
            customfields?: Array<Record<string, unknown>>;
            custom_fields?: Array<Record<string, unknown>>;
            fields?: Array<Record<string, unknown>>;
          }>(path, { entity, filter_custom_fields: true });

          const raw = resp.fields ?? resp.customfields ?? resp.custom_fields ?? [];
          const mapped = raw
            .map((f) => {
              const apiName = String(f.api_name ?? f.placeholder ?? '');
              // Prefer Zoho's friendly label; fall back to a prettified api_name
              const rawLabel = String(f.label ?? f.field_name_formatted ?? '');
              const label = rawLabel && !/^cf_/i.test(rawLabel)
                ? rawLabel
                : prettifyApiName(apiName);
              // Dropdown option names (for fields like Subs Period / Billing Period)
              const rawValues = (f.values ?? f.values_formatted) as Array<Record<string, unknown>> | undefined;
              const values = (rawValues ?? [])
                .map((v) => String(v.name ?? v.value ?? '').trim())
                .filter(Boolean);
              return {
                customfield_id: String(f.customfield_id ?? f.field_id ?? ''),
                index:        Number(f.index ?? 0),
                api_name:     apiName,
                label,
                data_type:    String(f.data_type ?? 'text'),
                is_active:    f.is_active !== false && String(f.status ?? '').toLowerCase() !== 'inactive',
                is_mandatory: f.is_mandatory === true,
                values,
              };
            })
            .filter((f) => f.api_name && f.is_active && /^cf_/i.test(f.api_name));

          if (mapped.length) {
            fetched = mapped;
            this.logger.debug(`Fetched ${mapped.length} custom fields for entity=${entity} via ${path}`);
            break; // success — stop trying other endpoints
          }
        } catch (err) {
          this.logger.warn(`customfields fetch failed (${path}, entity=${entity}): ${String(err)}`);
        }
      }

      result[key] = fetched;
    }

    return result;
  }

  async saveCustomFieldMappings(
    orgId: string,
    mappings: Record<string, Record<string, string>>,
    mappingKey: 'custom_field_mappings' | 'item_field_mappings' = 'custom_field_mappings',
  ) {
    const existing = await this.prisma.orgSettings.findUnique({ where: { organizationId: orgId } });
    const meta = ((existing?.metadata ?? {}) as Record<string, unknown>);
    const updated = { ...meta, [mappingKey]: mappings } as Parameters<typeof this.prisma.orgSettings.upsert>[0]['create']['metadata'];
    await this.prisma.orgSettings.upsert({
      where:  { organizationId: orgId },
      create: { organizationId: orgId, metadata: updated },
      update: { metadata: updated },
    });
    this.invalidateOrgMeta(orgId);
  }

  /**
   * Save per-module custom field mappings (Zoho-style: each module has its own
   * list of rows, each row maps a Zoho api_name to a value source or a static default).
   * Stored in org_settings.metadata.custom_field_mappings, keyed by module
   * (contacts / invoices / estimates / items).
   *
   * Also derives + stores billing_period_options and business_type_options
   * (the quote builder + getBusinessTypeLabel depend on these), and writes a
   * flat item_field_mappings shadow (from the Items module) for back-compat.
   */
  async saveItemFieldMappings(
    orgId: string,
    customFieldMappings: Record<string, CfRow[]>,
    billingOptions: Array<{ value: string; label: string }>,
    businessOptions: string[] = [],
  ) {
    const existing = await this.prisma.orgSettings.findUnique({ where: { organizationId: orgId } });
    const meta = ((existing?.metadata ?? {}) as Record<string, unknown>);

    // Flat shadow: { source → api_name } from the Items module (subscription import reads this).
    const itemRows = customFieldMappings.items ?? [];
    const itemFieldShadow: Record<string, string> = {};
    for (const row of itemRows) {
      if (row.source && row.source !== 'static' && row.zoho_api_name) {
        itemFieldShadow[row.source] = row.zoho_api_name;
      }
    }

    const updated = {
      ...meta,
      custom_field_mappings:   customFieldMappings,
      item_field_mappings:     itemFieldShadow,
      billing_period_options:  billingOptions,
      business_type_options:   businessOptions,
    } as unknown as Prisma.InputJsonObject;
    await this.prisma.orgSettings.upsert({
      where:  { organizationId: orgId },
      create: { organizationId: orgId, metadata: updated },
      update: { metadata: updated },
    });
    this.invalidateOrgMeta(orgId);
    return { ok: true };
  }

  /** Return the org's billing-period options (value=BillingCycle enum, label=Zoho label). */
  async getBillingOptions(orgId: string): Promise<{ options: Array<{ value: string; label: string }> }> {
    const meta = await this.getOrgMeta(orgId);
    const options = (meta.billing_period_options as Array<{ value: string; label: string }> | undefined) ?? [];
    return { options };
  }

  /**
   * Resolve our business-type concept (Fresh / Renewal / Pro-rata) to the org's
   * exact Zoho dropdown label, so the written value matches Zoho's picklist.
   * Falls back to the concept itself if no stored options / no match.
   */
  async getBusinessTypeLabel(orgId: string, concept: 'Fresh' | 'Renewal' | 'Pro-rata'): Promise<string> {
    const meta = await this.getOrgMeta(orgId);
    const options = (meta.business_type_options as string[] | undefined) ?? [];
    const needle = concept.replace(/[^a-z]/gi, '').toLowerCase(); // "pro-rata" → "prorata"
    const match = options.find((o) => o.replace(/[^a-z]/gi, '').toLowerCase() === needle);
    return match ?? concept;
  }

  // ------------------------------------------------------------------
  // Invoice Import — fetch invoices with line items for subscription import
  // ------------------------------------------------------------------

  /**
   * Fetch invoices from Zoho with all line items + custom fields.
   * Used for bulk subscription import.
   */
  async fetchInvoicesForImport(orgId: string, filters: {
    dateStart?: string;
    dateEnd?: string;
    status?: string;
    customerId?: string;
    referenceNumber?: string;
    businessType?: string;
    expiryFrom?: string;
    expiryTo?: string;
    page?: number;
    perPage?: number;
  }) {
    const client  = await this.clientFor(orgId);
    const params: Record<string, unknown> = {
      page:     filters.page ?? 1,
      per_page: filters.perPage ?? 50,
    };
    if (filters.dateStart)       params.date_start       = filters.dateStart;
    if (filters.dateEnd)         params.date_end         = filters.dateEnd;
    if (filters.status)          params.status           = filters.status;
    if (filters.customerId)      params.customer_id      = filters.customerId;
    if (filters.referenceNumber) params.reference_number = filters.referenceNumber;

    const listResp = await client.get<{
      invoices: Array<{
        invoice_id: string;
        invoice_number: string;
        customer_id: string;
        customer_name: string;
        date: string;
        total: number;
        status: string;
      }>;
      page_context?: { has_more_page: boolean };
    }>('/invoices', params);

    const invoices = listResp.invoices ?? [];

    // Fetch line items for each invoice (parallel, capped at 50)
    const enriched = await Promise.all(
      invoices.slice(0, 50).map(async (inv) => {
        try {
          const detail = await client.get<{
            invoice: {
              invoice_id: string;
              invoice_number: string;
              customer_id: string;
              customer_name: string;
              date: string;
              total: number;
              status: string;
              currency_code?: string;
              exchange_rate?: number;
              // Originating estimate/quote this invoice was created from (Track B.2).
              estimate_id?: string;
              reference_number?: string;
              // Header custom fields (Business Type, Service Expiry Date, etc.) — used for post-filtering.
              custom_fields?: Array<{ api_name: string; label: string; value: string | number }>;
              line_items: Array<{
                item_id?: string;
                name: string;
                description?: string;
                quantity: number;
                rate: number;
                item_total: number;
                // Item-master custom fields land here (Start/End/Cost/Domain), NOT in custom_fields
                item_custom_fields?: Array<{ api_name: string; label: string; value: string | number }>;
                custom_fields?: Array<{ api_name: string; label: string; value: string | number }>;
              }>;
            };
          }>(`/invoices/${inv.invoice_id}`);
          return detail.invoice;
        } catch {
          return { ...inv, line_items: [] as never[] };
        }
      }),
    );

    // Resolve each unique linked estimate ONCE to get its number/date/status,
    // so the wizard can carry the originating quote into renewal history.
    const estimateIds = Array.from(
      new Set(enriched.map((e) => (e as { estimate_id?: string }).estimate_id).filter((x): x is string => !!x)),
    ).slice(0, 60);

    const quoteById = new Map<string, { number?: string; date?: string; status?: string }>();
    await Promise.all(
      estimateIds.map(async (eid) => {
        try {
          const r = await client.get<{
            estimate: { estimate_id: string; estimate_number?: string; date?: string; status?: string };
          }>(`/estimates/${eid}`);
          quoteById.set(eid, { number: r.estimate?.estimate_number, date: r.estimate?.date, status: r.estimate?.status });
        } catch {
          /* estimate deleted / not accessible — invoice still imports without quote link */
        }
      }),
    );

    const withQuotes = enriched.map((e) => {
      const eid = (e as { estimate_id?: string }).estimate_id;
      const q = eid ? quoteById.get(eid) : undefined;
      return {
        ...e,
        doc_type:     'invoice' as const,
        quote_id:     eid,
        quote_number: q?.number,
        quote_date:   q?.date,
        quote_status: q?.status,
      };
    });

    return {
      invoices: this.postFilterImportDocs(withQuotes, filters),
      has_more: listResp.page_context?.has_more_page ?? false,
    };
  }

  /**
   * Fetch Zoho ESTIMATES (quotes/proformas) for the import wizard, normalized to the
   * same shape as invoices so the web grouping logic is unchanged. Each doc is marked
   * doc_type:'estimate' and its quote_* fields point at itself (there is no invoice).
   */
  async fetchEstimatesForImport(orgId: string, filters: {
    dateStart?: string;
    dateEnd?: string;
    status?: string;
    customerId?: string;
    referenceNumber?: string;
    businessType?: string;
    expiryFrom?: string;
    expiryTo?: string;
    page?: number;
    perPage?: number;
  }) {
    const client = await this.clientFor(orgId);
    const params: Record<string, unknown> = { page: filters.page ?? 1, per_page: filters.perPage ?? 50 };
    if (filters.dateStart)       params.date_start       = filters.dateStart;
    if (filters.dateEnd)         params.date_end         = filters.dateEnd;
    if (filters.status)          params.status           = filters.status;
    if (filters.customerId)      params.customer_id      = filters.customerId;
    if (filters.referenceNumber) params.reference_number = filters.referenceNumber;

    const listResp = await client.get<{
      estimates: Array<{ estimate_id: string; estimate_number: string; customer_id: string; customer_name: string; date: string; total: number; status: string }>;
      page_context?: { has_more_page: boolean };
    }>('/estimates', params);

    const estimates = listResp.estimates ?? [];

    const enriched = await Promise.all(
      estimates.slice(0, 50).map(async (est) => {
        try {
          const detail = await client.get<{
            estimate: {
              estimate_id: string; estimate_number: string; customer_id: string; customer_name: string;
              date: string; total: number; status: string; reference_number?: string;
              currency_code?: string; exchange_rate?: number;
              custom_fields?: Array<{ api_name: string; label: string; value: string | number }>;
              line_items: Array<{
                item_id?: string; name: string; description?: string; quantity: number; rate: number; item_total: number;
                item_custom_fields?: Array<{ api_name: string; label: string; value: string | number }>;
                custom_fields?: Array<{ api_name: string; label: string; value: string | number }>;
              }>;
            };
          }>(`/estimates/${est.estimate_id}`);
          const e = detail.estimate;
          // Normalize to the invoice-shaped object the web expects.
          return {
            invoice_id:     e.estimate_id,
            invoice_number: e.estimate_number,
            customer_id:    e.customer_id,
            customer_name:  e.customer_name,
            date:           e.date,
            total:          e.total,
            status:         e.status,
            currency_code:  e.currency_code,
            exchange_rate:  e.exchange_rate,
            reference_number: e.reference_number,
            custom_fields:  e.custom_fields,
            line_items:     e.line_items,
            doc_type:       'estimate' as const,
            // The quote IS this document.
            quote_id:       e.estimate_id,
            quote_number:   e.estimate_number,
            quote_date:     e.date,
            quote_status:   e.status,
          };
        } catch {
          return {
            invoice_id: est.estimate_id, invoice_number: est.estimate_number,
            customer_id: est.customer_id, customer_name: est.customer_name,
            date: est.date, total: est.total, status: est.status,
            line_items: [] as never[], doc_type: 'estimate' as const,
            quote_id: est.estimate_id, quote_number: est.estimate_number, quote_date: est.date, quote_status: est.status,
          };
        }
      }),
    );

    return {
      invoices: this.postFilterImportDocs(enriched, filters),
      has_more: listResp.page_context?.has_more_page ?? false,
    };
  }

  /** Read a header custom-field value by api_name from a fetched doc. */
  private cfHeaderVal(
    doc: { custom_fields?: Array<{ api_name: string; value: string | number }> },
    apiName: string,
  ): string {
    const f = doc.custom_fields?.find((c) => c.api_name === apiName);
    return f?.value != null ? String(f.value) : '';
  }

  /**
   * Post-filter fetched invoices/estimates by Business Type (cf_new_business) and
   * Service Expiry Date range (cf_next_invoice_date) — done in-app because Zoho's raw
   * custom-field query syntax is unreliable. Operates on the ≤50 fetched docs.
   */
  private postFilterImportDocs<T extends { custom_fields?: Array<{ api_name: string; value: string | number }> }>(
    docs: T[],
    filters: { businessType?: string; expiryFrom?: string; expiryTo?: string },
  ): T[] {
    const { businessType, expiryFrom, expiryTo } = filters;
    if (!businessType && !expiryFrom && !expiryTo) return docs;

    const toDate = (s: string): number | null => {
      if (!s) return null;
      // Zoho stores cf date value as ISO (YYYY-MM-DD); fall back to DD/MM/YYYY.
      let d = new Date(s);
      if (isNaN(d.getTime()) && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
        const [dd, mm, yy] = s.split('/').map((p) => parseInt(p, 10));
        d = new Date(yy, mm - 1, dd);
      }
      return isNaN(d.getTime()) ? null : d.getTime();
    };
    const from = expiryFrom ? toDate(expiryFrom) : null;
    const to   = expiryTo   ? toDate(expiryTo)   : null;

    return docs.filter((doc) => {
      if (businessType && this.cfHeaderVal(doc, 'cf_new_business') !== businessType) return false;
      if (from !== null || to !== null) {
        const exp = toDate(this.cfHeaderVal(doc, 'cf_next_invoice_date'));
        if (exp === null) return false;
        if (from !== null && exp < from) return false;
        if (to !== null && exp > to) return false;
      }
      return true;
    });
  }

  /**
   * Get the flat { source → api_name } mapping for a module's custom fields.
   * Defaults to the Items module (subscription import reads item line-item fields).
   * Reads per-module custom_field_mappings; falls back to the legacy flat item_field_mappings.
   * Keys: domain_name, start_date, end_date, cost_price, billing_period, ...
   */
  async getItemFieldMappings(orgId: string, module = 'items'): Promise<Record<string, string>> {
    const meta = await this.getOrgMeta(orgId);
    const perModule = meta.custom_field_mappings as Record<string, CfRow[]> | undefined;
    if (perModule) {
      const flat: Record<string, string> = {};
      for (const row of perModule[module] ?? []) {
        if (row.source && row.source !== 'static' && row.zoho_api_name) {
          flat[row.source] = row.zoho_api_name;
        }
      }
      return flat;
    }
    // Legacy fallback
    return (meta.item_field_mappings as Record<string, string> | undefined) ?? {};
  }

  /**
   * Build Zoho custom_fields array for a module using the org's per-module mapping.
   *
   * Reads org_settings.metadata.custom_field_mappings[module] — a list of rows, each
   * mapping a Zoho api_name to a value source. For each row the value is resolved as:
   *   - if source is a bound key (domain_name, billing_period, quantity, ...) → values[source]
   *   - else (or if that's empty) → row.default
   * Only rows that resolve to a non-empty value are emitted.
   *
   * `values` is keyed by the value-source catalog. Passing extra keys is safe —
   * unmapped sources are simply ignored.
   *
   * Back-compat: if custom_field_mappings is absent but the legacy flat
   * item_field_mappings exists, fall back to the old key→api_name behavior.
   */
  async buildCustomFields(
    orgId: string,
    module: 'estimates' | 'invoices' | 'contacts' | 'items',
    values: Record<string, string>,
  ): Promise<Array<{ customfield_id?: string; index?: number; api_name?: string; value: string }>> {
    const meta = await this.getOrgMeta(orgId);
    const perModule = meta.custom_field_mappings as Record<string, CfRow[]> | undefined;

    // Legacy fallback — flat key→api_name applied identically across modules.
    if (!perModule) {
      const mappings = (meta.item_field_mappings as Record<string, string> | undefined) ?? {};
      return Object.entries(values)
        .filter(([key, val]) => mappings[key] && val)
        .map(([key, val]) => ({ api_name: mappings[key], value: val }));
    }

    const rows = perModule[module] ?? [];
    const out: Array<{ customfield_id?: string; index?: number; api_name?: string; value: string }> = [];
    const present = new Set<string>();
    for (const row of rows) {
      if (!row.zoho_api_name || present.has(row.zoho_api_name)) continue;
      const bound = row.source && row.source !== 'static' ? values[row.source] : undefined;
      const value = (bound && bound !== '' ? bound : row.default) ?? '';
      if (value === '') continue;
      // Key custom fields by `api_name` for every module EXCEPT contacts.
      // Verified against the live Zoho API (estimates + line items): api_name reliably
      // populates dropdown AND number fields, whereas `index` silently stores 0 for
      // number fields (e.g. cf_total_licences) — it only happens to work for dropdowns.
      // We use api_name over customfield_id because the stored id can belong to the wrong
      // entity (the Item master vs Invoice Item slot share an api_name but have different ids).
      // Contacts is the sole exception: its write API rejects entries that carry
      // api_name/customfield_id ("Invalid value passed for Customer Name"), so it needs index.
      if (module === 'contacts' && row.index && row.index > 0) {
        out.push({ index: row.index, value });
      } else {
        out.push({ api_name: row.zoho_api_name, value });
      }
      present.add(row.zoho_api_name);
    }
    return out;
  }

  /**
   * Disconnect: nullify stored tokens, mark status.
   * Does NOT call Zoho's revoke endpoint — admins can revoke manually in Zoho if needed.
   */
  async disconnect(orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException(`Organization ${orgId} not found`);

    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        tokenExpiresAt: null,
        scopes: null,
        connectionStatus: 'disconnected',
      },
    });

    this.clientCache.delete(orgId);
    this.tokenCache.delete(orgId);
    this.logger.log(`Disconnected Zoho for org id=${orgId}`);
    return { organization_id: orgId, disconnected_at: new Date() };
  }

  /**
   * Returns a ready-to-use ZohoApiClient for the org, with auto token refresh.
   * Uses the org's Zoho org ID (not our internal UUID) for the organization_id param.
   */
  async clientFor(orgId: string): Promise<ZohoApiClient> {
    let client = this.clientCache.get(orgId);
    if (!client) {
      const org = await this.prisma.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { zohoOrgId: true },
      });
      client = new ZohoApiClient({
        apiBaseUrl: this.config.get<string>('ZOHO_API_BASE_URL')!,
        organizationId: org.zohoOrgId,
        getAccessToken: () => this.getValidAccessToken(orgId),
        onTokenExpired: () => this.refreshToken(orgId),
      });
      this.clientCache.set(orgId, client);
    }
    return client;
  }

  /**
   * Test connection by calling a lightweight Zoho Books endpoint that requires organization_id.
   * Used by "Test Connection" button on Settings → Organizations.
   */
  async testConnection(orgId: string) {
    try {
      const client = await this.clientFor(orgId);
      // GET /contacts?per_page=1 is lightweight and validates both token + org ID.
      await client.get('/contacts', { per_page: 1 });
      return { success: true };
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response
          ? `${err.response.status}: ${JSON.stringify(err.response.data)}`
          : err instanceof Error
            ? err.message
            : String(err);
      return { success: false, error: message };
    }
  }

  // ------------------------------------------------------------------
  // Cache sync — customers and items
  // ------------------------------------------------------------------

  async syncCustomers(orgId: string) {
    const client = await this.clientFor(orgId);
    let page = 1;
    let hasMore = true;
    let synced = 0;

    while (hasMore) {
      const data = await client.get<{ contacts: Array<Record<string, unknown>>; page_context?: { has_more_page: boolean } }>(
        '/contacts', { contact_type: 'customer', page, per_page: 200 },
      );

      const contacts: Array<Record<string, unknown>> = data.contacts ?? [];
      if (contacts.length === 0) break;

      for (const c of contacts) {
        await this.prisma.zohoCache.upsert({
          where: { uq_zoho_cache_entity: { organizationId: orgId, entityType: 'customer', zohoId: String(c['contact_id']) } },
          create: {
            organizationId: orgId,
            entityType: 'customer',
            zohoId: String(c['contact_id']),
            displayName: c['contact_name'] as string,
            email: c['email'] as string,
            phone: c['phone'] as string,
            gstin: (c['gst_no'] ?? c['gstin']) as string,
            extra: c as Prisma.InputJsonValue,
          },
          update: {
            displayName: c['contact_name'] as string,
            email: c['email'] as string,
            phone: c['phone'] as string,
            gstin: (c['gst_no'] ?? c['gstin']) as string,
            extra: c as Prisma.InputJsonValue,
            lastSyncedAt: new Date(),
          },
        });
        synced++;
      }

      hasMore = data.page_context?.has_more_page ?? false;
      page++;
    }

    this.logger.log(`Synced ${synced} customers for org ${orgId}`);
    return { synced };
  }

  async syncSingleCustomer(orgId: string, zohoId: string) {
    const client = await this.clientFor(orgId);
    
    try {
      const { contact } = await client.get<{ contact: Record<string, unknown> }>(`/contacts/${zohoId}`);
      
      await this.prisma.zohoCache.upsert({
        where: { uq_zoho_cache_entity: { organizationId: orgId, entityType: 'customer', zohoId } },
        create: {
          organizationId: orgId,
          entityType: 'customer',
          zohoId,
          displayName: contact['contact_name'] as string,
          email: contact['email'] as string,
          phone: contact['phone'] as string,
          gstin: (contact['gst_no'] ?? contact['gstin']) as string,
          extra: contact as Prisma.InputJsonValue,
        },
        update: {
          displayName: contact['contact_name'] as string,
          email: contact['email'] as string,
          phone: contact['phone'] as string,
          gstin: (contact['gst_no'] ?? contact['gstin']) as string,
          extra: contact as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
        },
      });
      return { success: true };
    } catch (err) {
      this.logger.error(`Failed to sync single customer ${zohoId}`, err instanceof Error ? err.stack : err);
      throw err;
    }
  }

  async syncItems(orgId: string) {
    const client = await this.clientFor(orgId);
    let page = 1;
    let hasMore = true;
    let synced = 0;

    while (hasMore) {
      const data = await client.get<{ items: Array<Record<string, unknown>>; page_context?: { has_more_page: boolean } }>(
        '/items', { page, per_page: 200 },
      );

      const items: Array<Record<string, unknown>> = data.items ?? [];
      if (items.length === 0) break;

      for (const item of items) {
        await this.prisma.zohoCache.upsert({
          where: { uq_zoho_cache_entity: { organizationId: orgId, entityType: 'item', zohoId: String(item['item_id']) } },
          create: {
            organizationId: orgId,
            entityType: 'item',
            zohoId: String(item['item_id']),
            displayName: item['name'] as string,
            extra: item as Prisma.InputJsonValue,
          },
          update: {
            displayName: item['name'] as string,
            extra: item as Prisma.InputJsonValue,
            lastSyncedAt: new Date(),
          },
        });
        synced++;
      }

      hasMore = data.page_context?.has_more_page ?? false;
      page++;
    }

    this.logger.log(`Synced ${synced} items for org ${orgId}`);
    return { synced };
  }

  async searchCache(orgId: string, entityType: 'customer' | 'item', query: string, limit = 20) {
    return this.prisma.zohoCache.findMany({
      where: {
        organizationId: orgId,
        entityType,
        ...(query && {
          OR: [
            { displayName: { contains: query, mode: 'insensitive' } },
            { email: { contains: query } },
            { gstin: { contains: query } },
          ],
        }),
      },
      orderBy: { displayName: 'asc' },
      take: limit,
    });
  }

  /**
   * Cross-org cached-customer search — powers the quote builder's
   * existing-customer picker: the user picks a customer first and the
   * quote's org auto-derives (and locks) from the pick, so a quote can
   * never carry another org's customer ID (BUG-017 prevention).
   */
  async searchCustomersAllOrgs(query: string, limit = 10) {
    return this.prisma.zohoCache.findMany({
      where: {
        entityType: 'customer',
        organization: { isActive: true },
        ...(query && {
          OR: [
            { displayName: { contains: query, mode: 'insensitive' } },
            { email: { contains: query } },
            { gstin: { contains: query } },
          ],
        }),
      },
      select: {
        id: true, zohoId: true, displayName: true, email: true, phone: true, gstin: true,
        organizationId: true,
        organization: { select: { name: true } },
      },
      orderBy: { displayName: 'asc' },
      take: limit,
    });
  }

  /**
   * Customer detail: the cached Zoho customer + all app records linked to it
   * (by zohoCustomerId) — subscriptions, domains, quotes. Customer is the Zoho
   * master; we just surface what the app knows about them.
   */
  async getCustomerDetail(orgId: string, zohoId: string) {
    const customer = await this.prisma.zohoCache.findUnique({
      where: { uq_zoho_cache_entity: { organizationId: orgId, entityType: 'customer', zohoId } },
    });

    // The cached summary lacks billing_address / contact_persons / contact_number,
    // so pull the full Zoho contact and merge it into `extra` for the detail view.
    // Non-fatal: on failure we fall back to whatever is cached.
    let customerOut = customer;
    if (customer) {
      // PERF_PLAN #5: skip the live Zoho contact fetch when the cached copy is both
      // COMPLETE (a full-contact sync stored billing_address; the list-sync doesn't)
      // and FRESH (within CONTACT_TTL). Otherwise fetch once and persist it back to
      // zoho_cache so subsequent page views are served from cache (0 Zoho calls).
      const extra = (customer.extra ?? {}) as Record<string, unknown>;
      const hasFull = !!extra.billing_address;
      const ageMs = Date.now() - new Date(customer.lastSyncedAt).getTime();
      const fresh = hasFull && ageMs < ZohoService.CONTACT_TTL_MS;

      if (!fresh) {
        try {
          const client = await this.clientFor(orgId);
          const resp = await client.get<{ contact?: Record<string, unknown> }>(`/contacts/${zohoId}`);
          const full = resp.contact;
          if (full) {
            const merged = {
              displayName: (full.contact_name as string) ?? customer.displayName,
              email:       (full.email as string) || customer.email,
              phone:       (full.phone as string) || (full.mobile as string) || customer.phone,
              gstin:       (full.gst_no as string) ?? customer.gstin,
            };
            // Persist the full contact so the next view is a cache hit.
            await this.prisma.zohoCache.update({
              where: { uq_zoho_cache_entity: { organizationId: orgId, entityType: 'customer', zohoId } },
              data:  { ...merged, extra: full as Prisma.InputJsonValue, lastSyncedAt: new Date() },
            }).catch((e) => this.logger.warn(`Contact cache write failed for ${zohoId}: ${String(e)}`));
            customerOut = { ...customer, ...merged, extra: full as Prisma.JsonValue };
          }
        } catch (err) {
          this.logger.warn(`Full contact fetch failed for ${zohoId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    const [subscriptions, quotes] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { organizationId: orgId, zohoCustomerId: zohoId },
        orderBy: { endDate: 'asc' },
        select: {
          id: true,
          subscriptionNumber: true,
          lifecycleStatus: true,
          processStatus: true,
          zohoItemName: true,
          quantity: true,
          subscriptionPrice: true,
          billingCycle: true,
          startDate: true,
          endDate: true,
          lastInvoiceId: true,
          lastInvoiceNumber: true,
          lastInvoiceDate: true,
          lastQuoteId: true,
          lastQuoteNumber: true,
          lastQuoteDate: true,
          domain: { select: { id: true, domainName: true, createdAt: true } },
        },
      }),
      this.prisma.quickQuote.findMany({
        where: { targetOrganizationId: orgId, zohoCustomerId: zohoId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true, quoteNumber: true, status: true,
          totalAmount: true, quoteDate: true,
          // Pushed quotes carry their Zoho invoice (field reused for invoice id/number);
          // pushedToZohoAt doubles as the invoice date.
          zohoEstimateId: true, zohoEstimateNumber: true, pushedToZohoAt: true,
        },
      }),
    ]);

    // Derive unique domains from subscriptions rather than querying the domains table
    // by zohoCustomerId — this correctly handles transferred subscriptions whose
    // domainId still points to a domain record owned by the previous customer.
    const domainMap = new Map<string, { id: string; domainName: string; createdAt: Date }>();
    for (const sub of subscriptions) {
      if (sub.domain && !domainMap.has(sub.domain.domainName)) {
        domainMap.set(sub.domain.domainName, {
          id:         sub.domain.id,
          domainName: sub.domain.domainName,
          createdAt:  sub.domain.createdAt,
        });
      }
    }
    const domains = [...domainMap.values()].sort((a, b) => a.domainName.localeCompare(b.domainName));

    // Per-domain active subscription count
    const domainSubCounts: Record<string, number> = {};
    for (const sub of subscriptions) {
      if (sub.domain) {
        const key = sub.domain.domainName;
        domainSubCounts[key] = (domainSubCounts[key] ?? 0) + (sub.lifecycleStatus === 'Active' ? 1 : 0);
      }
    }

    // Recent invoices aggregated from subscriptions — GROUPED by invoice, so a
    // multi-subscription invoice shows once (amount = Σ qty×price of its subs,
    // domains combined as "first +N more").
    const invoiceGroups = new Map<string, {
      invoiceId: string; invoiceNumber: string; invoiceDate: Date | null;
      domains: string[]; amount: number; subscriptionId: string; subCount: number;
    }>();
    for (const s of subscriptions) {
      if (!s.lastInvoiceId || !s.lastInvoiceNumber) continue;
      const g = invoiceGroups.get(s.lastInvoiceId) ?? {
        invoiceId: s.lastInvoiceId, invoiceNumber: s.lastInvoiceNumber,
        invoiceDate: s.lastInvoiceDate, domains: [], amount: 0,
        subscriptionId: s.id, subCount: 0,
      };
      g.amount += Number(s.subscriptionPrice) * Number(s.quantity);
      g.subCount++;
      const dn = s.domain?.domainName;
      if (dn && !g.domains.includes(dn)) g.domains.push(dn);
      invoiceGroups.set(s.lastInvoiceId, g);
    }
    const recentInvoices = [...invoiceGroups.values()]
      .map(g => ({
        invoiceId: g.invoiceId,
        invoiceNumber: g.invoiceNumber,
        invoiceDate: g.invoiceDate,
        domain: g.domains.length > 1 ? `${g.domains[0]} +${g.domains.length - 1} more` : g.domains[0] ?? null,
        amount: String(g.amount),
        subscriptionId: g.subscriptionId,
        subCount: g.subCount,
      }))
      .sort((a, b) => {
        const aDate = a.invoiceDate ? new Date(a.invoiceDate).getTime() : 0;
        const bDate = b.invoiceDate ? new Date(b.invoiceDate).getTime() : 0;
        return bDate - aDate;
      })
      .slice(0, 5);

    // Build recent document pairs (quote + invoice) from subscription data.
    // Deduplicated by quoteNumber (or invoiceNumber), sorted newest-doc-first, capped at 5.
    const docMap = new Map<string, {
      quoteId: string | null; quoteNumber: string | null; quoteDate: string | null;
      invoiceId: string | null; invoiceNumber: string | null; invoiceDate: string | null;
      domain: string | null;
    }>();
    const subsByRecent = [...subscriptions].sort((a, b) => {
      const ad = (a.lastInvoiceDate ?? a.lastQuoteDate ?? a.endDate) as Date | string;
      const bd = (b.lastInvoiceDate ?? b.lastQuoteDate ?? b.endDate) as Date | string;
      return new Date(bd).getTime() - new Date(ad).getTime();
    });
    for (const sub of subsByRecent) {
      const key = (sub.lastQuoteNumber ?? sub.lastInvoiceNumber) as string | null;
      if (!key || docMap.has(key)) continue;
      docMap.set(key, {
        quoteId:       (sub.lastQuoteId   as string | null) ?? null,
        quoteNumber:   (sub.lastQuoteNumber as string | null) ?? null,
        quoteDate:     sub.lastQuoteDate   ? (sub.lastQuoteDate as Date).toISOString() : null,
        invoiceId:     (sub.lastInvoiceId  as string | null) ?? null,
        invoiceNumber: (sub.lastInvoiceNumber as string | null) ?? null,
        invoiceDate:   sub.lastInvoiceDate ? (sub.lastInvoiceDate as Date).toISOString() : null,
        domain:        sub.domain?.domainName ?? null,
      });
    }
    const recentDocuments = [...docMap.values()].slice(0, 5);

    // At a Glance stats
    const activeSubs = subscriptions.filter(s => s.lifecycleStatus === 'Active').length;

    const atAGlance = {
      activeSubs,
      domainsMapped: domains.length,
    };

    return {
      customer: customerOut,
      subscriptions,
      domains,
      quotes,
      recentInvoices,
      recentDocuments,
      domainSubCounts,
      atAGlance,
    };
  }

  /**
   * Fetch all Zoho quotes (estimates) + invoices for a specific customer,
   * pair them (primary: invoice.estimate_id; secondary: "invoiced" estimate + same-total standalone
   * invoice within 90 days), annotate with any linked subscription in our DB,
   * and persist/upsert every row into zoho_customer_docs for offline cache.
   */
  async getCustomerZohoDocs(orgId: string, zohoCustomerId: string) {
    const client = await this.clientFor(orgId);

    // Load field mappings to resolve business_type CF name per module
    const [estFm, invFm] = await Promise.all([
      this.getItemFieldMappings(orgId, 'estimates'),
      this.getItemFieldMappings(orgId, 'invoices'),
    ]);
    const estBtCf = estFm.business_type as string | undefined;
    const invBtCf = invFm.business_type as string | undefined;

    type CfEntry = { api_name: string; value: string | number };
    const cfStr = (cfs: CfEntry[] | undefined, key: string | undefined): string | null => {
      if (!key || !cfs?.length) return null;
      const f = cfs.find(c => c.api_name === key);
      return f?.value != null ? String(f.value) : null;
    };

    type EstItem = {
      estimate_id: string; estimate_number: string; date: string; status: string; total: number;
      custom_fields?: CfEntry[];
    };
    type InvItem = {
      invoice_id: string; invoice_number: string; date: string; status: string; total: number;
      estimate_id?: string; custom_fields?: CfEntry[];
    };

    const [estRes, invRes] = await Promise.allSettled([
      client.get<{ estimates: EstItem[] }>('/estimates', {
        customer_id: zohoCustomerId, sort_column: 'created_time', sort_order: 'D', per_page: 100,
      }),
      client.get<{ invoices: InvItem[] }>('/invoices', {
        customer_id: zohoCustomerId, sort_column: 'created_time', sort_order: 'D', per_page: 100,
      }),
    ]);

    const estimates = estRes.status === 'fulfilled' ? (estRes.value?.estimates ?? []) : [];
    const invoices  = invRes.status  === 'fulfilled' ? (invRes.value?.invoices  ?? []) : [];

    // ── Primary pairing: invoice.estimate_id → estimate ──────────────────
    const invByEstId = new Map<string, InvItem>();
    for (const inv of invoices) {
      if (inv.estimate_id) invByEstId.set(inv.estimate_id, inv);
    }

    // ── Secondary pairing: "invoiced" estimates + standalone invoices by total+date ──
    // Covers cases where Zoho didn't set estimate_id on the converted invoice
    // (e.g. invoice created manually after the estimate was marked invoiced).
    const primaryPairedInvIds = new Set([...invByEstId.values()].map(i => i.invoice_id));
    const standaloneInvoices  = invoices.filter(inv => !inv.estimate_id && !primaryPairedInvIds.has(inv.invoice_id));
    const usedSecondaryInvIds = new Set<string>();

    for (const est of estimates) {
      if (invByEstId.has(est.estimate_id)) continue; // already paired
      if (est.status !== 'invoiced') continue;       // only pair "invoiced" estimates

      const estDate = new Date(est.date).getTime();
      const candidates = standaloneInvoices
        .filter(inv =>
          !usedSecondaryInvIds.has(inv.invoice_id) &&
          Math.abs((inv.total ?? 0) - (est.total ?? 0)) < 1 &&           // same amount
          Math.abs(new Date(inv.date).getTime() - estDate) < 90 * 86_400_000, // within 90 days
        )
        .sort((a, b) =>
          Math.abs(new Date(a.date).getTime() - estDate) - Math.abs(new Date(b.date).getTime() - estDate),
        );

      if (candidates.length > 0) {
        invByEstId.set(est.estimate_id, candidates[0]);
        usedSecondaryInvIds.add(candidates[0].invoice_id);
      }
    }

    // ── Build final docs array ────────────────────────────────────────────
    type DocRow = {
      quoteId: string | null; quoteNumber: string | null; quoteDate: string | null;
      quoteStatus: string | null; quoteTotal: number | null;
      invoiceId: string | null; invoiceNumber: string | null; invoiceDate: string | null;
      invoiceStatus: string | null; invoiceTotal: number | null;
      businessType: string | null;
    };

    const pairedInvIds = new Set<string>();
    const docs: DocRow[] = [];

    for (const est of estimates) {
      const inv = invByEstId.get(est.estimate_id) ?? null;
      if (inv) pairedInvIds.add(inv.invoice_id);
      // Business type: prefer estimate CF, fall back to invoice CF
      const businessType =
        cfStr(est.custom_fields, estBtCf) ??
        (inv ? cfStr(inv.custom_fields, invBtCf) : null);
      docs.push({
        quoteId:       est.estimate_id,      quoteNumber: est.estimate_number,
        quoteDate:     est.date,             quoteStatus: est.status,
        quoteTotal:    est.total ?? null,
        invoiceId:     inv?.invoice_id   ?? null, invoiceNumber: inv?.invoice_number ?? null,
        invoiceDate:   inv?.date         ?? null, invoiceStatus: inv?.status         ?? null,
        invoiceTotal:  inv?.total        ?? null,
        businessType,
      });
    }

    // Invoices not paired with any estimate
    for (const inv of invoices) {
      if (!pairedInvIds.has(inv.invoice_id)) {
        docs.push({
          quoteId: null, quoteNumber: null, quoteDate: null, quoteStatus: null, quoteTotal: null,
          invoiceId:    inv.invoice_id,    invoiceNumber: inv.invoice_number,
          invoiceDate:  inv.date,          invoiceStatus: inv.status,
          invoiceTotal: inv.total ?? null,
          businessType: cfStr(inv.custom_fields, invBtCf),
        });
      }
    }

    docs.sort((a, b) =>
      (b.quoteDate ?? b.invoiceDate ?? '').localeCompare(a.quoteDate ?? a.invoiceDate ?? ''));

    // ── Persist to DB (upsert — never delete, additive) ───────────────────
    const now = new Date();
    await Promise.allSettled(docs.map(doc => {
      const docKey = doc.quoteId ?? doc.invoiceId!;
      return this.prisma.zohoCustomerDoc.upsert({
        where: { uq_zoho_customer_doc: { organizationId: orgId, zohoCustomerId, docKey } },
        create: { organizationId: orgId, zohoCustomerId, docKey, ...doc, syncedAt: now },
        update: { ...doc, syncedAt: now },
      });
    }));

    // ── Annotate with DB-linked subscriptions ─────────────────────────────
    return { docs: await this.annotateWithLinkedSubs(orgId, zohoCustomerId, docs), fromCache: false };
  }

  /**
   * Return cached Zoho docs from DB (instant, no Zoho call). Used for initial
   * page load — client calls this first, then optionally Re-syncs from Zoho.
   */
  async getCachedZohoDocs(orgId: string, zohoCustomerId: string) {
    const cached = await this.prisma.zohoCustomerDoc.findMany({
      where: { organizationId: orgId, zohoCustomerId },
    });

    if (cached.length === 0) return { docs: [], fromCache: true, syncedAt: null };

    cached.sort((a, b) =>
      (b.quoteDate ?? b.invoiceDate ?? '').localeCompare(a.quoteDate ?? a.invoiceDate ?? ''));

    const syncedAt = cached.reduce(
      (max, d) => (d.syncedAt > max ? d.syncedAt : max),
      cached[0].syncedAt,
    ).toISOString();

    const rows = cached.map(d => ({
      quoteId: d.quoteId, quoteNumber: d.quoteNumber, quoteDate: d.quoteDate,
      quoteStatus: d.quoteStatus, quoteTotal: d.quoteTotal,
      invoiceId: d.invoiceId, invoiceNumber: d.invoiceNumber, invoiceDate: d.invoiceDate,
      invoiceStatus: d.invoiceStatus, invoiceTotal: d.invoiceTotal,
      businessType: d.businessType,
    }));

    return { docs: await this.annotateWithLinkedSubs(orgId, zohoCustomerId, rows), fromCache: true, syncedAt };
  }

  /** Shared: annotate doc rows with their currently linked DB subscription. */
  private async annotateWithLinkedSubs<T extends {
    invoiceNumber: string | null; quoteNumber: string | null;
  }>(orgId: string, zohoCustomerId: string, docs: T[]) {
    const invNums = docs.map(d => d.invoiceNumber).filter((n): n is string => !!n);
    const qNums   = docs.map(d => d.quoteNumber).filter((n): n is string => !!n);

    type SubInfo = {
      id: string; subscriptionNumber: string; zohoItemName: string | null;
      lastInvoiceNumber: string | null; lastQuoteNumber: string | null;
      domain: { domainName: string } | null;
    };

    let linkedSubs: SubInfo[] = [];
    if (invNums.length || qNums.length) {
      const orClauses: Prisma.SubscriptionWhereInput[] = [];
      if (invNums.length) orClauses.push({ lastInvoiceNumber: { in: invNums } });
      if (qNums.length)   orClauses.push({ lastQuoteNumber:   { in: qNums } });
      linkedSubs = await this.prisma.subscription.findMany({
        where: { organizationId: orgId, zohoCustomerId, OR: orClauses },
        select: {
          id: true, subscriptionNumber: true, zohoItemName: true,
          lastInvoiceNumber: true, lastQuoteNumber: true,
          domain: { select: { domainName: true } },
        },
      });
    }

    const subByInv = new Map<string, SubInfo>();
    const subByQ   = new Map<string, SubInfo>();
    for (const sub of linkedSubs) {
      if (sub.lastInvoiceNumber) subByInv.set(sub.lastInvoiceNumber, sub);
      if (sub.lastQuoteNumber)   subByQ.set(sub.lastQuoteNumber, sub);
    }

    return docs.map(doc => ({
      ...doc,
      linkedSub: (doc.invoiceNumber && subByInv.get(doc.invoiceNumber))
        || (doc.quoteNumber && subByQ.get(doc.quoteNumber))
        || null,
    }));
  }

  /**
   * Create or update RenewalHistory entries from Zoho document line-item mappings.
   *
   * Called by "📋 Create History" in the Zoho Docs panel. Each mapping supplies
   * the line-item dates/qty/rate + the target subscription ID. The method:
   *   1. Loads each subscription (domainId, billingCycle, currency, exchangeRate)
   *   2. Maps business type string → BusinessType enum
   *   3. Maps invoice status → RenewalStatus (paid→Paid · sent/overdue→Invoiced · quote-only→Quoted)
   *   4. Upserts by (subscriptionId + invoiceNumber) or (subscriptionId + quoteNumber)
   */
  async createDocHistory(
    orgId: string,
    body: {
      quoteId?: string; quoteNumber?: string; quoteDate?: string; quoteStatus?: string;
      invoiceId?: string; invoiceNumber?: string; invoiceDate?: string; invoiceStatus?: string;
      businessType?: string;
      mappings: Array<{ subId: string; startDate: string; endDate: string; qty: number; rate: number }>;
    },
  ) {
    const { quoteId, quoteNumber, quoteDate, invoiceId, invoiceNumber, invoiceDate, invoiceStatus, businessType, mappings } = body;

    // Resolve BusinessType enum
    const btKey = (businessType ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const btEnum =
      btKey === 'fresh'   ? 'Fresh' :
      btKey === 'prorata' ? 'ProRata' :
                            'Renewal';

    // Resolve RenewalStatus from Zoho invoice status
    const invStatus = (invoiceStatus ?? '').toLowerCase();
    const renewalStatus =
      invStatus === 'paid' || invStatus === 'partially_paid' ? 'Paid' :
      invoiceId ? 'Invoiced' :
      'Quoted';

    // Load subscriptions in one query
    const subIds = [...new Set(mappings.map(m => m.subId))];
    const subs = await this.prisma.subscription.findMany({
      where: { id: { in: subIds }, organizationId: orgId },
      select: { id: true, domainId: true, billingCycle: true, currency: true, exchangeRate: true },
    });
    const subById = new Map(subs.map(s => [s.id, s]));

    const results: Array<{ subId: string; action: 'created' | 'updated' | 'skipped'; error?: string }> = [];

    for (const m of mappings) {
      const sub = subById.get(m.subId);
      if (!sub) { results.push({ subId: m.subId, action: 'skipped', error: 'subscription not found' }); continue; }

      const startDate = m.startDate ? new Date(m.startDate) : null;
      const endDate   = m.endDate   ? new Date(m.endDate)   : null;
      const qty       = m.qty  > 0  ? m.qty  : null;
      const rate      = m.rate > 0  ? m.rate : null;

      const data = {
        subscriptionId:   m.subId,
        organizationId:   orgId,
        domainId:         sub.domainId,
        businessType:     btEnum as 'Renewal' | 'ProRata' | 'Fresh',
        billingCycle:     sub.billingCycle,
        serviceStartDate: startDate,
        serviceEndDate:   endDate,
        quantity:         qty != null ? qty : undefined,
        sellingPrice:     rate != null ? rate : undefined,
        subtotalAmount:   qty != null && rate != null ? qty * rate : undefined,
        currency:         sub.currency,
        exchangeRate:     sub.exchangeRate,
        renewalStatus:    renewalStatus as 'Quoted' | 'Invoiced' | 'Paid',
        quoteId:          quoteId   ?? null,
        quoteNumber:      quoteNumber ?? null,
        quoteDate:        quoteDate   ? new Date(quoteDate)   : null,
        invoiceId:        invoiceId   ?? null,
        invoiceNumber:    invoiceNumber ?? null,
        invoiceDate:      invoiceDate  ? new Date(invoiceDate) : null,
      };

      try {
        // Upsert: find existing by subscriptionId + invoiceNumber (or quoteNumber)
        const existing = await this.prisma.renewalHistory.findFirst({
          where: {
            subscriptionId: m.subId,
            ...(invoiceNumber ? { invoiceNumber } : { quoteNumber }),
          },
          select: { id: true },
        });

        if (existing) {
          await this.prisma.renewalHistory.update({ where: { id: existing.id }, data });
          results.push({ subId: m.subId, action: 'updated' });
        } else {
          await this.prisma.renewalHistory.create({ data });
          results.push({ subId: m.subId, action: 'created' });
        }
      } catch (err) {
        results.push({ subId: m.subId, action: 'skipped', error: err instanceof Error ? err.message : 'unknown' });
      }
    }

    return { results };
  }

  /**
   * Fetch line items for a single Zoho document (invoice or estimate).
   *
   * DB-first: if the document's line items are already in zoho_customer_doc_lines,
   * return them immediately (0 Zoho calls). On first call (or cache miss), fetch
   * from Zoho, save to DB, then return. Always re-runs the subscription auto-match
   * so suggestions reflect current DB state.
   *
   * Matching priority: domain → closest end date (within 90 days) → closest quantity.
   * Greedy: each subscription assigned at most once across line items.
   */
  async getZohoDocLineItems(orgId: string, kind: 'estimate' | 'invoice', docId: string) {
    type LineItemOut = {
      name: string; qty: number; rate: number;
      domain: string; startDate: string; endDate: string;
      suggestedSub: { id: string; subscriptionNumber: string; zohoItemName: string | null; domain: { domainName: string } | null } | null;
    };

    // ── 1. Check DB cache ───────────────────────────────────────────
    const cachedDoc = await this.prisma.zohoCustomerDoc.findFirst({
      where: {
        organizationId: orgId,
        OR: [{ quoteId: docId }, { invoiceId: docId }],
      },
      include: { lines: { orderBy: { lineOrder: 'asc' } } },
    });

    let rawLines: Array<{ name: string; qty: number; rate: number; domain: string; startDate: string; endDate: string }>;

    if (cachedDoc && cachedDoc.lines.length > 0) {
      // Cache hit — use DB rows directly
      rawLines = cachedDoc.lines.map(l => ({
        name:      l.name,
        qty:       l.qty,
        rate:      l.rate,
        domain:    l.domain    ?? '',
        startDate: l.startDate ?? '',
        endDate:   l.endDate   ?? '',
      }));
    } else {
      // ── 2. Cache miss → fetch from Zoho ──────────────────────────
      const [fm, doc] = await Promise.all([
        this.getItemFieldMappings(orgId, 'items'),
        this.getDocDetailCached<{
          line_items: Array<{
            item_id?: string; name: string; quantity: number; rate: number;
            item_custom_fields?: Array<{ api_name: string; value: string | number }>;
            custom_fields?:      Array<{ api_name: string; value: string | number }>;
          }>;
        }>(orgId, kind, docId),
      ]);

      if (!doc) return { lineItems: [], fromCache: false };

      const domainCf    = fm.domain_name ?? 'cf_domain_name';
      const startDateCf = fm.start_date  ?? 'cf_subscription_start_date';
      const endDateCf   = fm.end_date    ?? 'cf_subscription_end_date';

      const cfVal = (cfs: Array<{ api_name: string; value: string | number }> | undefined, key: string) => {
        const f = cfs?.find(c => c.api_name === key);
        return f?.value != null ? String(f.value) : '';
      };
      const parseDate = (val: string) => {
        if (!val || /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
        const p = val.split('/');
        return p.length === 3 ? `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}` : val;
      };

      rawLines = doc.line_items.map(li => {
        const cfs       = li.item_custom_fields ?? li.custom_fields ?? [];
        return {
          name:      li.name,
          qty:       li.quantity,
          rate:      li.rate,
          domain:    cfVal(cfs, domainCf),
          startDate: parseDate(cfVal(cfs, startDateCf)),
          endDate:   parseDate(cfVal(cfs, endDateCf)),
        };
      });

      // ── 3. Persist to DB (fire-and-forget; don't block the response) ──
      if (cachedDoc) {
        void this.prisma.$transaction(async (tx) => {
          await tx.zohoCustomerDocLine.deleteMany({ where: { docId: cachedDoc.id } });
          if (rawLines.length > 0) {
            await tx.zohoCustomerDocLine.createMany({
              data: rawLines.map((l, idx) => ({
                docId:     cachedDoc.id,
                lineOrder: idx,
                name:      l.name,
                qty:       l.qty,
                rate:      l.rate,
                domain:    l.domain    || null,
                startDate: l.startDate || null,
                endDate:   l.endDate   || null,
              })),
            });
          }
        }).catch(err => this.logger.warn(`Line-item DB save failed for ${docId}: ${String(err)}`));
      }
    }

    // ── 4. Build output with subscription auto-match ────────────────
    const lineItems: LineItemOut[] = rawLines.map(l => ({ ...l, suggestedSub: null }));

    const domains = [...new Set(lineItems.map(l => l.domain).filter(Boolean))];
    if (domains.length > 0) {
      const subs = await this.prisma.subscription.findMany({
        where: { organizationId: orgId, domain: { domainName: { in: domains } } },
        select: {
          id: true, subscriptionNumber: true, zohoItemName: true, quantity: true, endDate: true,
          domain: { select: { domainName: true } },
        },
      });

      const usedIds = new Set<string>();
      for (const li of lineItems) {
        if (!li.domain) continue;
        let candidates = subs.filter(s => s.domain?.domainName === li.domain && !usedIds.has(s.id));
        if (candidates.length === 0) continue;

        if (li.endDate) {
          const liEnd = new Date(li.endDate).getTime();
          const byDate = candidates.filter(
            s => Math.abs(new Date(s.endDate).getTime() - liEnd) < 90 * 86_400_000,
          );
          if (byDate.length > 0) {
            candidates = byDate.sort(
              (a, b) => Math.abs(new Date(a.endDate).getTime() - liEnd) - Math.abs(new Date(b.endDate).getTime() - liEnd),
            );
          }
        }

        if (candidates.length > 1) {
          candidates = [...candidates].sort(
            (a, b) => Math.abs(Number(a.quantity) - li.qty) - Math.abs(Number(b.quantity) - li.qty),
          );
        }

        li.suggestedSub = candidates[0];
        usedIds.add(candidates[0].id);
      }
    }

    return { lineItems, fromCache: cachedDoc?.lines.length ? true : false };
  }

  // ------------------------------------------------------------------
  // Write Operations
  // ------------------------------------------------------------------

  /**
   * Update contact details in Zoho Books (e.g. GSTIN, PAN, Address).
   * Note: payload must be flat (e.g. no nested objects, use top-level keys like billing_address).
   */
  async updateContactDetails(orgId: string, contactId: string, payload: Record<string, unknown>) {
    const client = await this.clientFor(orgId);
    try {
      const resp = await client.put<{ contact: Record<string, unknown> }>(`/contacts/${contactId}`, payload);
      
      // Update local cache if present
      await this.prisma.zohoCache.updateMany({
        where: { organizationId: orgId, entityType: 'customer', zohoId: contactId },
        data: {
          ...(payload.contact_name ? { displayName: String(payload.contact_name) } : {}),
          ...(payload.email ? { email: String(payload.email) } : {}),
          ...(payload.phone ? { phone: String(payload.phone) } : {}),
          ...(payload.gst_no ? { gstin: String(payload.gst_no) } : {}),
          ...(payload.gst_treatment ? { extra: resp.contact as Prisma.InputJsonValue } : {}),
          lastSyncedAt: new Date(),
        }
      });
      
      return { success: true, contact: resp.contact };
    } catch (err) {
      this.logger.error(`Failed to update Zoho contact ${contactId}`, err instanceof Error ? err.stack : err);
      throw err;
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Returns a valid access token — refreshes if expired/expiring within 60s.
   */
  private async getValidAccessToken(orgId: string): Promise<string> {
    const skewMs = 60_000;

    // PERF_PLAN #4: serve from the in-memory token cache when still valid —
    // avoids a DB read + AES decrypt on EVERY Zoho request.
    const cached = this.tokenCache.get(orgId);
    if (cached && cached.expiresAt > Date.now() + skewMs) {
      return cached.token;
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { accessTokenEncrypted: true, tokenExpiresAt: true },
    });
    if (!org?.accessTokenEncrypted) {
      throw new UnauthorizedException(`Org ${orgId} not connected to Zoho`);
    }

    const expiresAt = org.tokenExpiresAt?.getTime() ?? 0;
    if (expiresAt < Date.now() + skewMs) {
      return this.refreshToken(orgId);
    }

    const decrypted = this.crypto.decrypt(org.accessTokenEncrypted);
    if (!decrypted) throw new UnauthorizedException('Token decryption failed');
    this.tokenCache.set(orgId, { token: decrypted, expiresAt });
    return decrypted;
  }

  /**
   * Refresh the access token using the stored refresh token.
   * Per Zoho Spec §12 — refresh tokens don't expire unless revoked.
   */
  private async refreshToken(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { refreshTokenEncrypted: true },
    });
    if (!org?.refreshTokenEncrypted) {
      await this.prisma.organization.update({
        where: { id: orgId },
        data: { connectionStatus: 'revoked' },
      });
      throw new UnauthorizedException(`No refresh token for org ${orgId} — reconnect required`);
    }

    const refreshToken = this.crypto.decrypt(org.refreshTokenEncrypted)!;
    const accountsUrl = this.config.get<string>('ZOHO_ACCOUNTS_URL')!;
    const [clientId, clientSecret] = await Promise.all([
      this.getClientId(),
      this.getClientSecret(),
    ]);
    const params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    });

    try {
      const { data } = await axios.post<{
        access_token: string;
        expires_in: number;
      }>(`${accountsUrl}/oauth/v2/token`, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
      });

      const expiresAt = new Date(Date.now() + data.expires_in * 1000);
      await this.prisma.organization.update({
        where: { id: orgId },
        data: {
          accessTokenEncrypted: this.crypto.encrypt(data.access_token),
          tokenExpiresAt: expiresAt,
          connectionStatus: 'active',
        },
      });

      // PERF_PLAN #4: keep the in-memory token cache in step with the fresh token.
      this.tokenCache.set(orgId, { token: data.access_token, expiresAt: expiresAt.getTime() });

      this.logger.log(`Refreshed token for org id=${orgId} (expires ${expiresAt.toISOString()})`);
      return data.access_token;
    } catch (err) {
      this.logger.error(
        `Refresh failed for org ${orgId} — marking revoked`,
        err instanceof Error ? err.stack : err,
      );
      await this.prisma.organization.update({
        where: { id: orgId },
        data: { connectionStatus: 'revoked' },
      });
      this.tokenCache.delete(orgId);
      throw new UnauthorizedException('Refresh token revoked — admin must reconnect');
    }
  }
}
