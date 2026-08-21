import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ConversionsService } from './conversions.service';
import { TriggerConversionDto, ConvertQuoteDto, EmailInvoiceDto, SetSubscriptionDecisionDto, CreateInvoiceDto } from './dto/conversions.dto';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';

@Controller('conversions')
export class ConversionsController {
  constructor(private readonly service: ConversionsService) {}

  /** POST /api/conversions/lead/:leadId — trigger lead → customer conversion */
  @Post('lead/:leadId')
  trigger(
    @Param('leadId') leadId: string,
    @Body() dto: TriggerConversionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.triggerConversion(leadId, dto, user.id);
  }

  /** GET /api/conversions/lead/:leadId — conversion history */
  @Get('lead/:leadId')
  history(@Param('leadId') leadId: string) {
    return this.service.getConversionsForLead(leadId);
  }

  /** POST /api/conversions/quote/:quoteId — existing-customer quote → Zoho Tax Invoice */
  @Post('quote/:quoteId')
  convertQuote(
    @Param('quoteId') quoteId: string,
    @Body() dto: ConvertQuoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.convertExistingCustomerQuote(quoteId, dto, user.id);
  }

  /** GET /api/conversions/quote/:quoteId/post-convert — invoice + next-step info for a converted quote */
  @Get('quote/:quoteId/post-convert')
  postConvert(@Param('quoteId') quoteId: string) {
    return this.service.getPostConvertInfo(quoteId);
  }

  /** POST /api/conversions/quote/:quoteId/create-invoice — Phase 2: create Zoho invoice after subscriptions are confirmed */
  @Post('quote/:quoteId/create-invoice')
  createInvoice(@Param('quoteId') quoteId: string, @Body() dto: CreateInvoiceDto) {
    return this.service.createInvoiceForQuote(quoteId, dto);
  }

  /** POST /api/conversions/quote/:quoteId/subscription-decision — change the convert-time choice (undo "never" etc.) */
  @Post('quote/:quoteId/subscription-decision')
  setSubscriptionDecision(@Param('quoteId') quoteId: string, @Body() dto: SetSubscriptionDecisionDto) {
    return this.service.setSubscriptionDecision(quoteId, dto.decision);
  }

  /** GET /api/conversions/quote/:quoteId/invoice-email-preview — Zoho's pre-filled email for the compose modal */
  @Get('quote/:quoteId/invoice-email-preview')
  invoiceEmailPreview(
    @Param('quoteId') quoteId: string,
    @Query('template_id') templateId?: string,
  ) {
    return this.service.getQuoteInvoiceEmailPreview(quoteId, templateId);
  }

  /** POST /api/conversions/quote/:quoteId/email-invoice — email the converted invoice via Zoho (compose override optional) */
  @Post('quote/:quoteId/email-invoice')
  emailInvoice(@Param('quoteId') quoteId: string, @Body() dto: EmailInvoiceDto) {
    return this.service.emailQuoteInvoice(quoteId, dto);
  }

  /** POST /api/conversions/quote/:quoteId/refresh-invoice — sync invoice status from Zoho */
  @Post('quote/:quoteId/refresh-invoice')
  refreshInvoice(@Param('quoteId') quoteId: string) {
    return this.service.refreshQuoteInvoiceStatus(quoteId);
  }
}
