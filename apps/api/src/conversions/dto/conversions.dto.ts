import { IsString, IsOptional, IsDateString, IsArray, IsEmail, IsIn, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** Convert-time choice: create the subscription now, keep the button for later, or never (one-time deal). */
export type SubscriptionDecision = 'create_now' | 'later' | 'never';
const SUBSCRIPTION_DECISIONS: SubscriptionDecision[] = ['create_now', 'later', 'never'];

export class TriggerConversionDto {
  @IsString() organizationId!: string;
  @IsOptional() @IsString() quickQuoteId?: string;
  /** Domain + service start collected at the Convert/Push step (no longer on the quote). */
  @IsOptional() @IsString() domainName?: string;
  @IsOptional() @IsDateString() serviceStartDate?: string;
  @IsOptional() @IsIn(SUBSCRIPTION_DECISIONS) subscriptionDecision?: SubscriptionDecision;
}

export class ConvertQuoteDto {
  /** Domain + service start collected at the Convert/Push step (no longer on the quote). */
  @IsOptional() @IsString() domainName?: string;
  @IsOptional() @IsDateString() serviceStartDate?: string;
  @IsOptional() @IsIn(SUBSCRIPTION_DECISIONS) subscriptionDecision?: SubscriptionDecision;
}

/** Change the subscription decision after conversion (e.g. undo an accidental "never"). */
export class SetSubscriptionDecisionDto {
  @IsIn(SUBSCRIPTION_DECISIONS) decision!: SubscriptionDecision;
}

/**
 * One row from the Create Subscription form — drives per-item domain + dates
 * in the Zoho invoice created after subscriptions are confirmed.
 */
export class CreateInvoiceItemDto {
  @IsOptional() @IsString() domainName?: string;
  @IsOptional() @IsString() billingCycle?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsNumber() @Type(() => Number) costPrice?: number;
}

/** POST /api/conversions/quote/:id/create-invoice — create Zoho invoice after subscriptions. */
export class CreateInvoiceDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => CreateInvoiceItemDto)
  items!: CreateInvoiceItemDto[];
}

/** Compose-modal override for emailing the converted invoice (all optional = Zoho defaults). */
export class EmailInvoiceDto {
  @IsOptional() @IsArray() @IsEmail({}, { each: true }) toMailIds?: string[];
  @IsOptional() @IsArray() @IsEmail({}, { each: true }) ccMailIds?: string[];
  @IsOptional() @IsArray() @IsEmail({}, { each: true }) bccMailIds?: string[];
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() body?: string;
}
