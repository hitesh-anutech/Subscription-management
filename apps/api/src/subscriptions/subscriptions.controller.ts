import {
  Body, Controller, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors,
  Delete, HttpCode, HttpStatus, ForbiddenException, BadRequestException
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { SubscriptionsService } from './subscriptions.service';
import {
  CreateSubscriptionDto, UpdateSubscriptionDto,
  RenewalQuoteDto, ProrataQuoteDto, StartSubscriptionDto,
  ImportSubscriptionsBatchDto, BulkUpdatePriceDto, BulkRenewalQuoteDto,
  CombinedRenewalQuoteDto, BulkCreateFromQuoteDto,
} from './dto/subscriptions.dto';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly service: SubscriptionsService) {}

  /** GET /api/subscriptions */
  @Get()
  list(
    @Query('org_id')        orgId?: string,
    @Query('status')        status?: string,
    @Query('expiring_days') expiringDays?: string,
    @Query('billing_cycle') billingCycle?: string,
    @Query('search')        search?: string,
    @Query('ids')           ids?: string,
    @Query('page')          page?: string,
    @Query('limit')         limit?: string,
  ) {
    return this.service.list({
      orgId,
      status,
      billingCycle,
      expiringDays: expiringDays ? Number(expiringDays) : undefined,
      search,
      ids: ids ? ids.split(',').filter(Boolean) : undefined,
      page:  page  ? Number(page)  : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  /** GET /api/subscriptions/export-csv */
  @Get('export-csv')
  async exportCsv(
    @Res() res: Response,
    @Query('org_id')        orgId?: string,
    @Query('status')        status?: string,
    @Query('expiring_days') expiringDays?: string,
    @Query('billing_cycle') billingCycle?: string,
    @Query('search')        search?: string,
  ) {
    const csvData = await this.service.exportCsv({
      orgId,
      status,
      billingCycle,
      expiringDays: expiringDays ? Number(expiringDays) : undefined,
      search,
    });
    res.header('Content-Type', 'text/csv');
    res.attachment('subscriptions_export.csv');
    return res.send(csvData);
  }

  /** GET /api/subscriptions/import-logs — recent CSV import runs (static route, must precede :id) */
  @Get('import-logs')
  listImportLogs(@Query('limit') limit?: string) {
    return this.service.listImportLogs(limit ? Number(limit) : 20);
  }

  /** GET /api/subscriptions/import-logs/:logId — full detail of one import run */
  @Get('import-logs/:logId')
  getImportLog(@Param('logId') logId: string) {
    return this.service.getImportLog(logId);
  }

  /** GET /api/subscriptions/import-logs/:logId/errors-csv — download skipped/error rows to fix & re-upload */
  @Get('import-logs/:logId/errors-csv')
  async getImportLogErrorsCsv(@Param('logId') logId: string, @Res() res: Response) {
    const csv = await this.service.getImportLogErrorsCsv(logId);
    res.header('Content-Type', 'text/csv');
    res.attachment(`import_${logId}_errors.csv`);
    return res.send(csv);
  }

  /** GET /api/subscriptions/billing-history — unified billing history (all single and bulk quotes/invoices) */
  @Get('billing-history')
  getBillingHistory(
    @Query('page')   page?: string,
    @Query('limit')  limit?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('cycle') cycle?: string,
    @Query('quoteStatus') quoteStatus?: string,
    @Query('invoiceStatus') invoiceStatus?: string,
  ) {
    return this.service.getBillingHistory({
      page:  page  ? Number(page)  : 1,
      limit: limit ? Number(limit) : 20,
      search,
      type,
      cycle,
      quoteStatus,
      invoiceStatus,
    });
  }

  /** GET /api/subscriptions/billing-history/:id/activity */
  @Get('billing-history/:id/activity')
  async getActivity(@Param('id') id: string) {
    return this.service.getBillingHistoryActivity(id);
  }

  /** GET /api/subscriptions/renewal-batches — list all bulk renewal runs */
  @Get('renewal-batches')
  listRenewalBatches(
    @Query('page')   page?: string,
    @Query('limit')  limit?: string,
    @Query('search') search?: string,
    @Query('ids')    ids?: string,
  ) {
    return this.service.listRenewalBatches({
      page:  page  ? Number(page)  : 1,
      limit: limit ? Number(limit) : 20,
      search,
      ids: ids ? ids.split(',').filter(Boolean) : undefined,
    });
  }

  /** GET /api/subscriptions/renewal-batches/:batchId/email-preview — Zoho email content for the batch's estimate */
  @Get('renewal-batches/:batchId/email-preview')
  getBatchEmailPreview(
    @Param('batchId') batchId: string,
    @Query('template_id') templateId?: string,
  ) {
    return this.service.getBatchEmailPreview(batchId, templateId);
  }

  /** POST /api/subscriptions/renewal-batches/:batchId/send — email the batch's estimate (Zoho default template, or compose override) */
  @Post('renewal-batches/:batchId/send')
  sendBatch(
    @Param('batchId') batchId: string,
    @Body() dto: { toMailIds?: string[]; ccMailIds?: string[]; bccMailIds?: string[]; subject?: string; body?: string },
  ) {
    return this.service.sendBatch(batchId, dto);
  }

  /** POST /api/subscriptions/renewal-batches/:batchId/refresh — sync the batch's estimate/invoice status from Zoho */
  @Post('renewal-batches/:batchId/refresh')
  refreshBatch(@Param('batchId') batchId: string) {
    return this.service.refreshBatch(batchId);
  }

  /** GET /api/subscriptions/prefill-renewal-quote — prefill a quote from existing subscriptions */
  @Get('prefill-renewal-quote')
  prefillRenewalQuote(@Query('ids') ids: string) {
    if (!ids) {
      throw new BadRequestException('Query parameter "ids" is required');
    }
    const idList = ids.split(',').filter(Boolean);
    return this.service.prefillRenewalQuote(idList);
  }

  /** GET /api/subscriptions/:id */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  /** POST /api/subscriptions */
  @Post()
  create(@Body() dto: CreateSubscriptionDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  /** POST /api/subscriptions/bulk-update-price */
  @Post('bulk-update-price')
  bulkUpdatePrice(@Body() dto: BulkUpdatePriceDto, @CurrentUser() user: AuthUser) {
    return this.service.bulkUpdatePrice(dto, user);
  }

  /** POST /api/subscriptions/bulk-renewal-quote */
  @Post('bulk-renewal-quote')
  bulkRenewalQuote(@Body() dto: BulkRenewalQuoteDto) {
    return this.service.bulkRenewalQuote(dto);
  }

  /** POST /api/subscriptions/combined-renewal-quote — one multi-line quote per customer */
  @Post('combined-renewal-quote')
  combinedRenewalQuote(@Body() dto: CombinedRenewalQuoteDto) {
    return this.service.combinedRenewalQuote(dto);
  }

  /** POST /api/subscriptions/bulk-update-status */
  @Post('bulk-update-status')
  bulkUpdateStatus(@Body() dto: { subscriptionIds: string[], status: string }, @CurrentUser() user: AuthUser) {
    return this.service.bulkUpdateStatus(dto, user);
  }

  /** POST /api/subscriptions/import-csv — bulk UPDATE existing subs (matched by ID column) */
  @Post('import-csv')
  @UseInterceptors(FileInterceptor('file'))
  async importCsv(@UploadedFile() file: Express.Multer.File, @CurrentUser() user?: AuthUser) {
    if (!file) {
      throw new Error('No file provided');
    }
    return this.service.importCsv(file.buffer, file.originalname, user?.email);
  }

  /** POST /api/subscriptions/import-create-csv — bulk CREATE subscriptions from a CSV */
  @Post('import-create-csv')
  @UseInterceptors(FileInterceptor('file'))
  async importCreateCsv(@UploadedFile() file: Express.Multer.File, @CurrentUser() user?: AuthUser) {
    if (!file) {
      throw new Error('No file provided');
    }
    return this.service.importCreateCsv(file.buffer, file.originalname, user?.email);
  }

  /** POST /api/subscriptions/bulk-create-from-quote — one subscription per domain of a converted bulk-domains quote */
  @Post('bulk-create-from-quote')
  bulkCreateFromQuote(@Body() dto: BulkCreateFromQuoteDto) {
    return this.service.bulkCreateFromQuote(dto.quote_id);
  }

  /** PATCH /api/subscriptions/:id */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSubscriptionDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  /** POST /api/subscriptions/:id/renewal-quote */
  @Post(':id/renewal-quote')
  renewalQuote(@Param('id') id: string, @Body() dto: RenewalQuoteDto) {
    return this.service.generateRenewalQuote(id, dto);
  }

  /** POST /api/subscriptions/:id/prorata-quote */
  @Post(':id/prorata-quote')
  prorataQuote(@Param('id') id: string, @Body() dto: ProrataQuoteDto) {
    return this.service.generateProrataQuote(id, dto);
  }

  /** POST /api/subscriptions/:id/start */
  @Post(':id/start')
  start(@Param('id') id: string, @Body() dto: StartSubscriptionDto) {
    return this.service.startSubscription(id, dto);
  }

  /** GET /api/subscriptions/renewal-history/:historyId/email-preview — fetch Zoho template content before sending */
  @Get('renewal-history/:historyId/email-preview')
  getEmailPreview(
    @Param('historyId') historyId: string,
    @Query('template_id') templateId?: string,
  ) {
    return this.service.getEmailPreview(historyId, templateId);
  }

  /** POST /api/subscriptions/renewal-history/:historyId/send — email the proforma (Zoho estimate) to the customer */
  @Post('renewal-history/:historyId/send')
  sendProforma(
    @Param('historyId') historyId: string,
    @Body() dto: { toMailIds?: string[]; ccMailIds?: string[]; bccMailIds?: string[]; subject?: string; body?: string },
  ) {
    return this.service.sendProforma(historyId, dto);
  }

  /** POST /api/subscriptions/renewal-history/:historyId/refresh — sync proforma status from Zoho */
  @Post('renewal-history/:historyId/refresh')
  refreshProforma(@Param('historyId') historyId: string) {
    return this.service.refreshProformaStatus(historyId);
  }

  /** POST /api/subscriptions/renewal-history/:historyId/convert-to-invoice — Convert quote to invoice via Zoho Books */
  @Post('renewal-history/:historyId/convert-to-invoice')
  convertToInvoice(@Param('historyId') historyId: string) {
    return this.service.convertToInvoice(historyId);
  }

  /** GET /api/subscriptions/renewal-history/:historyId/invoice-email-preview — Zoho invoice email content */
  @Get('renewal-history/:historyId/invoice-email-preview')
  getInvoiceEmailPreview(
    @Param('historyId') historyId: string,
    @Query('template_id') templateId?: string,
  ) {
    return this.service.getInvoiceEmailPreview(historyId, templateId);
  }

  /** POST /api/subscriptions/renewal-history/:historyId/send-invoice — (re)send the Tax Invoice to the customer */
  @Post('renewal-history/:historyId/send-invoice')
  sendInvoice(
    @Param('historyId') historyId: string,
    @Body() dto: { toMailIds?: string[]; ccMailIds?: string[]; bccMailIds?: string[]; subject?: string; body?: string },
  ) {
    return this.service.sendInvoice(historyId, dto);
  }

  /** POST /api/subscriptions/import — bulk import grouped subscriptions from Zoho invoices */
  @Post('import')
  import(@Body() dto: ImportSubscriptionsBatchDto) {
    return this.service.importGrouped(dto.subscriptions);
  }

  /** POST /api/subscriptions/sync-expiry */
  @Post('sync-expiry')
  syncExpiry() {
    return this.service.syncExpiryStatuses();
  }

  /** DELETE /api/subscriptions/:id */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    if (user.role !== 'Admin') {
      throw new ForbiddenException('Only administrators can delete subscriptions');
    }
    return this.service.remove(id, user);
  }
}
