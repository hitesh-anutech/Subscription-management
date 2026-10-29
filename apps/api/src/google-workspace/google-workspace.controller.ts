import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { GoogleWorkspaceService } from './google-workspace.service';
import { GoogleResellerSubsService } from './google-reseller-subs.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('google-workspace')
export class GoogleWorkspaceController {
  constructor(
    private readonly google: GoogleWorkspaceService,
    private readonly resellerSubs: GoogleResellerSubsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * GET /api/google-workspace/status
   * Returns connection status for both reseller slots.
   */
  @Get('status')
  status() {
    return this.google.getStatus();
  }

  /**
   * GET /api/google-workspace/auth/url?slot=1|2
   * Returns the Google OAuth authorization URL for the given slot.
   */
  @Get('auth/url')
  async authUrl(@Query('slot') slot: string) {
    return { authorize_url: await this.google.buildAuthorizeUrl(slot === '2' ? 2 : 1) };
  }

  /**
   * GET /api/google-workspace/auth/callback  (Public — Google redirects here)
   * state query param carries the slot number (1 or 2).
   */
  @Public()
  @Get('auth/callback')
  async authCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const slot = state === '2' ? 2 : 1;
    const webBase = this.config.get<string>('NEXT_PUBLIC_WEB_BASE_URL', 'http://localhost:3000');
    try {
      await this.google.completeOAuth(code, slot);
      return res.redirect(`${webBase}/dashboard/settings/google?connected=${slot}`);
    } catch {
      return res.redirect(`${webBase}/dashboard/settings/google?error=1`);
    }
  }

  /**
   * DELETE /api/google-workspace/auth?slot=1|2
   */
  @Delete('auth')
  @HttpCode(HttpStatus.OK)
  disconnect(@Query('slot') slot: string) {
    return this.google.disconnect(slot === '2' ? 2 : 1);
  }

  /**
   * POST /api/google-workspace/customers/fetch
   * Tries both reseller slots automatically.
   * Body: { domainId: string }
   */
  @Post('customers/fetch')
  async fetchCustomer(@Body('domainId') domainId: string) {
    if (!domainId) return { error: 'domainId required' };
    return this.google.fetchAndSaveCustomer(domainId);
  }

  /**
   * POST /api/google-workspace/customers/fetch-bulk
   * Starts a background sync job. Returns { jobId, total } immediately.
   */
  @Post('customers/fetch-bulk')
  async fetchCustomersBulk(@Body() body: { domainIds?: string[]; syncAll?: boolean }) {
    return this.google.startBulkSync({
      domainIds: body.domainIds,
      syncAll: body.syncAll ?? false,
    });
  }

  /**
   * GET /api/google-workspace/customers/sync-job/:jobId
   * Poll progress of a background bulk sync job.
   */
  @Get('customers/sync-job/:jobId')
  getSyncJobStatus(@Param('jobId') jobId: string) {
    const job = this.google.getSyncJobStatus(jobId);
    if (!job) return { status: 'not_found' };
    return job;
  }

  /**
   * GET /api/google-workspace/customers/:domainId
   * Return stored Google data for a domain (no live API call).
   */
  @Get('customers/:domainId')
  async getCustomer(@Param('domainId', ParseUUIDPipe) domainId: string) {
    return this.google.getDomainGoogleData(domainId);
  }

  /**
   * GET /api/google-workspace/customers/:domainId/subscriptions
   */
  @Get('customers/:domainId/subscriptions')
  async listSubscriptions(@Param('domainId', ParseUUIDPipe) domainId: string) {
    return this.google.listSubscriptionsForDomain(domainId);
  }

  // ====================================================================
  // Reseller Subscriptions Reconciliation endpoints
  // ====================================================================

  /**
   * GET /api/google-workspace/reseller-subs
   * Paginated list with filters.
   */
  @Get('reseller-subs')
  listResellerSubs(
    @Query('reconciliationStatus') reconciliationStatus?: string,
    @Query('googleStatus') googleStatus?: string,
    @Query('resellerSlot') resellerSlot?: string,
    @Query('skuName') skuName?: string,
    @Query('hasFlag') hasFlag?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('orgId') orgId?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    return this.resellerSubs.list({
      orgId,
      reconciliationStatus,
      googleStatus,
      resellerSlot: resellerSlot ? Number(resellerSlot) : undefined,
      skuName,
      hasFlag,
      search,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      sortBy,
      sortDir: sortDir === 'desc' ? 'desc' : 'asc',
    });
  }

  /**
   * GET /api/google-workspace/reseller-subs/sku-names
   * Distinct SKU names for filter dropdown.
   */
  @Get('reseller-subs/sku-names')
  listSkuNames(@Query('orgId') orgId?: string) {
    return this.resellerSubs.listSkuNames(orgId);
  }

  /**
   * POST /api/google-workspace/reseller-subs/fetch-subscriptions
   * Starts a background job. Returns { jobId } immediately.
   * Poll GET /reseller-subs/job/:jobId for progress.
   */
  @Post('reseller-subs/fetch-subscriptions')
  fetchResellerSubscriptions(@Body() body: { slot?: number; orgId?: string }) {
    return this.resellerSubs.fetchAllSubscriptions({
      slot: body.slot === 1 ? 1 : body.slot === 2 ? 2 : undefined,
      orgId: body.orgId,
    });
  }

  /**
   * POST /api/google-workspace/reseller-subs/:id/fetch-subscription
   * Refresh a single row's subscription data from Google API.
   */
  @Post('reseller-subs/:id/fetch-subscription')
  refreshResellerSubscription(@Param('id', ParseUUIDPipe) id: string) {
    return this.resellerSubs.refreshSubscription(id);
  }

  /**
   * POST /api/google-workspace/reseller-subs/fetch-customers
   * Starts a background job with concurrent fetch pool. Returns { jobId, total }.
   * Poll GET /reseller-subs/job/:jobId for progress.
   */
  @Post('reseller-subs/fetch-customers')
  fetchResellerCustomers(@Body() body: { forceRefresh?: boolean; orgId?: string }) {
    return this.resellerSubs.startCustomerFetch({
      forceRefresh: body.forceRefresh ?? false,
      orgId: body.orgId,
    });
  }

  /**
   * POST /api/google-workspace/reseller-subs/:id/fetch-customer
   * Refresh a single row's customer data synchronously.
   */
  @Post('reseller-subs/:id/fetch-customer')
  refreshResellerCustomer(@Param('id', ParseUUIDPipe) id: string) {
    return this.resellerSubs.fetchCustomerData({ id });
  }

  /**
   * GET /api/google-workspace/reseller-subs/job/:jobId
   * Poll progress of a background reseller job (fetch_subscriptions or fetch_customers).
   */
  @Get('reseller-subs/job/:jobId')
  getResellerJobStatus(@Param('jobId') jobId: string) {
    const job = this.resellerSubs.getJobStatus(jobId);
    if (!job) return { status: 'not_found' };
    return job;
  }

  /**
   * POST /api/google-workspace/reseller-subs/reconcile
   * Run reconciliation for all rows (or pass id for single row).
   * Body: { orgId?: string }
   */
  @Post('reseller-subs/reconcile')
  reconcileAll(@Body() body: { orgId?: string; domainNames?: string[]; onlyNotMatched?: boolean }) {
    return this.resellerSubs.reconcile({ orgId: body.orgId, domainNames: body.domainNames, onlyNotMatched: body.onlyNotMatched });
  }

  /**
   * POST /api/google-workspace/reseller-subs/:id/reconcile
   * Reconcile a single row.
   */
  @Post('reseller-subs/:id/reconcile')
  reconcileOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.resellerSubs.reconcile({ id });
  }

  /**
   * POST /api/google-workspace/reseller-subs/:id/additional-domains
   * Update the additional domains list for a row.
   * Body: { domains: string[] }
   */
  @Post('reseller-subs/:id/additional-domains')
  updateAdditionalDomains(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('domains') domains: string[],
  ) {
    return this.resellerSubs.updateAdditionalDomains(id, domains ?? []);
  }

  /**
   * POST /api/google-workspace/reseller-subs/:id/exclude
   * Mark a row as excluded from reconciliation.
   * Body: { excluded: boolean }
   */
  @Post('reseller-subs/:id/exclude')
  @HttpCode(HttpStatus.OK)
  setExcluded(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('excluded') excluded: boolean,
  ) {
    return this.resellerSubs.setExcluded(id, excluded ?? true);
  }

  /**
   * POST /api/google-workspace/reseller-subs/import-customer-uid
   * Bulk-import Customer UIDs from Google Console CSV.
   * Body: { items: { customerId: string; customerUid: string }[]; orgId?: string }
   */
  @Post('reseller-subs/import-customer-uid')
  importCustomerUids(
    @Body() body: { items: Array<{ customerId: string; customerUid: string }>; orgId?: string },
  ) {
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return { updated: 0, notFound: 0, total: 0, notFoundIds: [] };
    }
    return this.resellerSubs.importCustomerUids(body.items, body.orgId);
  }

  /**
   * POST /api/google-workspace/reseller-subs/:id/customer-uid
   * Update Customer UID for a single row.
   * Body: { customerUid: string }
   */
  @Post('reseller-subs/:id/customer-uid')
  updateCustomerUid(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('customerUid') customerUid: string,
  ) {
    return this.resellerSubs.updateCustomerUid(id, customerUid ?? '');
  }
}
