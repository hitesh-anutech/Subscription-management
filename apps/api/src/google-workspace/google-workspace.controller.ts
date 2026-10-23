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
import { Public } from '../auth/decorators/public.decorator';

@Controller('google-workspace')
export class GoogleWorkspaceController {
  constructor(
    private readonly google: GoogleWorkspaceService,
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
}
