import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { ZohoService, CfRow } from './zoho.service';
import { WebhookService } from './webhook.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller()
export class ZohoController {
  constructor(
    private readonly zoho: ZohoService,
    private readonly webhook: WebhookService,
    private readonly config: ConfigService,
  ) {}

  /**
   * POST /api/organizations/:id/connect-zoho
   * Returns the Zoho OAuth authorize URL for the frontend to redirect to.
   */
  @Post('organizations/:id/connect-zoho')
  async connect(@Param('id', ParseUUIDPipe) id: string) {
    const authorizeUrl = await this.zoho.buildAuthorizeUrl(id);
    return { authorize_url: authorizeUrl };
  }

  /**
   * POST /api/organizations/:id/reconnect-zoho
   * Same as connect but distinguishes admin intent (e.g. after revoke).
   */
  @Post('organizations/:id/reconnect-zoho')
  async reconnect(@Param('id', ParseUUIDPipe) id: string) {
    const authorizeUrl = await this.zoho.buildAuthorizeUrl(id);
    return { authorize_url: authorizeUrl, reason: 'admin_initiated' };
  }

  /**
   * POST /api/organizations/:id/disconnect-zoho
   */
  @Post('organizations/:id/disconnect-zoho')
  disconnect(@Param('id', ParseUUIDPipe) id: string) {
    return this.zoho.disconnect(id);
  }

  /**
   * POST /api/organizations/:id/test-zoho-connection
   * Hits Zoho's /organizations endpoint with the stored token.
   */
  @Post('organizations/:id/test-zoho-connection')
  test(@Param('id', ParseUUIDPipe) id: string) {
    return this.zoho.testConnection(id);
  }

  /**
   * GET /api/organizations/:id/zoho-custom-fields?modules=Invoices,Contacts
   * Fetch all custom fields from Zoho for given modules.
   */
  @Get('organizations/:id/zoho-custom-fields')
  fetchCustomFields(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('modules') modules = 'Invoices,Contacts,Estimates,Items',
  ) {
    const moduleList = modules.split(',').map((m) => m.trim()).filter(Boolean);
    return this.zoho.fetchZohoCustomFields(id, moduleList);
  }

  /**
   * PUT /api/organizations/:id/item-field-mappings
   * Save per-module custom field mappings (Zoho-style: each module — contacts/invoices/
   * estimates/items — has its own list of rows mapping a Zoho api_name to a value source
   * or a static default), plus the normalized billing-period and business-type options.
   */
  @Put('organizations/:id/item-field-mappings')
  @HttpCode(HttpStatus.OK)
  saveItemFieldMappings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: {
      customFieldMappings: Record<string, CfRow[]>;
      billingOptions?: Array<{ value: string; label: string }>;
      businessOptions?: string[];
    },
  ) {
    return this.zoho.saveItemFieldMappings(
      id, body.customFieldMappings ?? {}, body.billingOptions ?? [], body.businessOptions ?? [],
    );
  }

  /**
   * GET /api/organizations/:id/billing-options
   * Returns the org's billing-period options (value=BillingCycle enum, label=Zoho label).
   */
  @Get('organizations/:id/billing-options')
  getBillingOptions(@Param('id', ParseUUIDPipe) id: string) {
    return this.zoho.getBillingOptions(id);
  }

  /**
   * GET /api/organizations/:id/invoices-preview
   * Fetch invoices from Zoho for subscription import preview.
   */
  @Get('organizations/:id/invoices-preview')
  fetchInvoicesForImport(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('date_start') dateStart?: string,
    @Query('date_end')   dateEnd?: string,
    @Query('status')     status?: string,
    @Query('customer_id') customerId?: string,
    @Query('reference_number') referenceNumber?: string,
    @Query('business_type') businessType?: string,
    @Query('service_expiry_from') expiryFrom?: string,
    @Query('service_expiry_to')   expiryTo?: string,
    @Query('page')       page?: string,
  ) {
    return this.zoho.fetchInvoicesForImport(id, {
      dateStart, dateEnd, status, customerId, referenceNumber,
      businessType, expiryFrom, expiryTo, page: page ? Number(page) : 1,
    });
  }

  /**
   * GET /api/organizations/:id/estimates-preview
   * Fetch estimates (quotes) from Zoho for subscription import preview.
   */
  @Get('organizations/:id/estimates-preview')
  fetchEstimatesForImport(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('date_start') dateStart?: string,
    @Query('date_end')   dateEnd?: string,
    @Query('status')     status?: string,
    @Query('customer_id') customerId?: string,
    @Query('reference_number') referenceNumber?: string,
    @Query('business_type') businessType?: string,
    @Query('service_expiry_from') expiryFrom?: string,
    @Query('service_expiry_to')   expiryTo?: string,
    @Query('page')       page?: string,
  ) {
    return this.zoho.fetchEstimatesForImport(id, {
      dateStart, dateEnd, status, customerId, referenceNumber,
      businessType, expiryFrom, expiryTo, page: page ? Number(page) : 1,
    });
  }

  /** POST /api/organizations/:id/sync-customers — pull all customers into cache */
  @Post('organizations/:id/sync-customers')
  @HttpCode(HttpStatus.OK)
  syncCustomers(@Param('id', ParseUUIDPipe) id: string) {
    return this.zoho.syncCustomers(id);
  }

  /** POST /api/organizations/:id/sync-items — pull all items into cache */
  @Post('organizations/:id/sync-items')
  @HttpCode(HttpStatus.OK)
  syncItems(@Param('id', ParseUUIDPipe) id: string) {
    return this.zoho.syncItems(id);
  }

  /** GET /api/organizations/:id/cache/customers?q=... — search cached customers */
  @Get('organizations/:id/cache/customers')
  searchCustomers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('q') q = '',
    @Query('limit') limit?: string,
  ) {
    return this.zoho.searchCache(id, 'customer', q, limit ? parseInt(limit, 10) : 20);
  }

  /** GET /api/customers/cross-org-search?q=... — search cached customers across ALL active orgs (with org name) */
  @Get('customers/cross-org-search')
  searchCustomersAllOrgs(@Query('q') q = '', @Query('limit') limit?: string) {
    return this.zoho.searchCustomersAllOrgs(q, limit ? parseInt(limit, 10) : 10);
  }

  /** GET /api/organizations/:id/customers/:zohoId — customer detail + linked subs/domains/quotes */
  @Get('organizations/:id/customers/:zohoId')
  customerDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('zohoId') zohoId: string,
  ) {
    return this.zoho.getCustomerDetail(id, zohoId);
  }

  /** GET /api/organizations/:id/customers/:zohoId/zoho-documents — live Zoho quote+invoice list, paired + linked-sub annotation + DB persist */
  @Get('organizations/:id/customers/:zohoId/zoho-documents')
  getCustomerZohoDocs(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('zohoId') zohoId: string,
  ) {
    return this.zoho.getCustomerZohoDocs(id, zohoId);
  }

  /** GET /api/organizations/:id/customers/:zohoId/zoho-documents-cached — instant load from DB cache */
  @Get('organizations/:id/customers/:zohoId/zoho-documents-cached')
  getCachedZohoDocs(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('zohoId') zohoId: string,
  ) {
    return this.zoho.getCachedZohoDocs(id, zohoId);
  }

  /**
   * POST /api/organizations/:id/create-doc-history
   * Create / upsert RenewalHistory rows from Zoho document line-item mappings.
   */
  @Post('organizations/:id/create-doc-history')
  @HttpCode(HttpStatus.OK)
  createDocHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: {
      quoteId?: string; quoteNumber?: string; quoteDate?: string; quoteStatus?: string;
      invoiceId?: string; invoiceNumber?: string; invoiceDate?: string; invoiceStatus?: string;
      businessType?: string;
      mappings: Array<{ subId: string; startDate: string; endDate: string; qty: number; rate: number }>;
    },
  ) {
    return this.zoho.createDocHistory(id, body);
  }

  /** GET /api/organizations/:id/zoho-doc-line-items?kind=invoice|estimate&doc_id=... */
  @Get('organizations/:id/zoho-doc-line-items')
  getZohoDocLineItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('kind') kind: 'estimate' | 'invoice',
    @Query('doc_id') docId: string,
  ) {
    return this.zoho.getZohoDocLineItems(id, kind, docId);
  }

  /** POST /api/organizations/:id/customers/:zohoId/sync — pull single customer */
  @Post('organizations/:id/customers/:zohoId/sync')
  @HttpCode(HttpStatus.OK)
  syncSingleCustomer(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('zohoId') zohoId: string,
  ) {
    return this.zoho.syncSingleCustomer(id, zohoId);
  }

  /** GET /api/organizations/:id/cache/items?q=... — search cached items */
  @Get('organizations/:id/cache/items')
  searchItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('q') q = '',
    @Query('limit') limit?: string,
  ) {
    return this.zoho.searchCache(id, 'item', q, limit ? parseInt(limit, 10) : 20);
  }

  /**
   * POST /api/zoho/webhook
   * Receives Zoho Books webhook events. Public — Zoho sends no auth header.
   * Idempotency handled in WebhookService via event_hash.
   */
  @Public()
  @Post('zoho/webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Query('org_id') orgId: string | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.webhook.ingest(orgId ?? null, payload);
  }

  /**
   * GET /api/auth/zoho/callback
   * Browser redirect from Zoho — must be Public (unauthenticated browser redirect).
   */
  @Public()
  @Get('auth/zoho/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const webBase = this.config.get<string>('WEB_BASE_URL', 'http://localhost:3000');

    if (error) {
      return res.redirect(`${webBase}/dashboard/settings/organizations?zoho_error=${encodeURIComponent(error)}`);
    }

    try {
      const result = await this.zoho.completeOAuth(code, state);
      return res.redirect(
        `${webBase}/dashboard/settings/organizations?zoho_connected=${encodeURIComponent(result.organization_id)}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OAuth callback failed';
      return res.redirect(`${webBase}/dashboard/settings/organizations?zoho_error=${encodeURIComponent(message)}`);
    }
  }
}
