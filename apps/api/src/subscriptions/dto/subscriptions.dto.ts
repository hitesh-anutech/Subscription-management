import {
  IsArray, IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional,
  IsString, IsUUID, MaxLength, Min, ValidateNested, IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BillingCycle, SubscriptionLifecycleStatus } from '@prisma/client';

export class CreateSubscriptionDto {
  @IsString() organizationId!: string;
  @IsOptional() @IsString() domainId?: string;
  @IsOptional() @IsString() domainName?: string;
  @IsString() zohoCustomerId!: string;
  @IsOptional() @IsString() zohoCustomerName?: string;
  @IsString() zohoItemId!: string;
  @IsOptional() @IsString() zohoItemName?: string;

  @IsOptional() @IsString() originLeadId?: string;
  @IsOptional() @IsString() originQuickQuoteId?: string;

  @IsNumber() @Min(0) quantity!: number;
  @IsNumber() @Min(0) subscriptionPrice!: number;
  @IsOptional() @IsNumber() @Min(0) nextRenewalPrice?: number;
  @IsOptional() @IsNumber() @Min(0) costPrice?: number;

  @IsEnum(BillingCycle) billingCycle!: BillingCycle;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsDateString() nextRenewalDate?: string;
  @IsOptional() @IsBoolean() autoRenew?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  // Initial lifecycle status — defaults to Pending if omitted
  @IsOptional() @IsEnum(SubscriptionLifecycleStatus) lifecycleStatus?: SubscriptionLifecycleStatus;

  // Invoice linkage (when subscription created from an existing/just-created invoice)
  @IsOptional() @IsString() @MaxLength(80) lastInvoiceId?: string;
  @IsOptional() @IsString() @MaxLength(80) lastInvoiceNumber?: string;
  @IsOptional() @IsDateString() lastInvoiceDate?: string;
}

export class UpdateSubscriptionDto {
  @IsOptional() @IsNumber() @Min(0) quantity?: number;
  @IsOptional() @IsNumber() @Min(0) subscriptionPrice?: number;
  @IsOptional() @IsNumber() @Min(0) nextRenewalPrice?: number;
  @IsOptional() @IsNumber() @Min(0) costPrice?: number;
  @IsOptional() @IsEnum(BillingCycle) billingCycle?: BillingCycle;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsDateString() nextRenewalDate?: string;
  @IsOptional() @IsBoolean() autoRenew?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  // Billing currency + exchange rate (1 unit of currency = exchangeRate INR)
  @IsOptional() @IsString() @MaxLength(10) currency?: string;
  @IsOptional() @IsNumber() exchangeRate?: number;

  // Manually link existing Zoho documents — backend will lookup ID + date from Zoho
  @IsOptional() @IsString() @MaxLength(80) lastQuoteNumber?: string;
  @IsOptional() @IsString() @MaxLength(80) lastInvoiceNumber?: string;

  // Service period from Zoho line items — passed by the mapping UI so history row gets real dates
  @IsOptional() @IsDateString() serviceStartDate?: string;
  @IsOptional() @IsDateString() serviceEndDate?: string;
}

export class BulkTransferCustomerDto {
  @IsArray() @IsString({ each: true }) subscriptionIds!: string[];
  @IsString() zohoCustomerId!: string;
  @IsString() zohoCustomerName!: string;
}

export class RenewalQuoteDto {
  @IsOptional() @IsNumber() @Min(0) overridePrice?: number;
  @IsOptional() @IsNumber() @Min(1) overrideQuantity?: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class ProrataQuoteDto {
  @IsNumber() @Min(1) additionalLicenses!: number;
  @IsDateString() effectiveDate!: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class StartSubscriptionDto {
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsEnum(['estimate', 'invoice']) zohoDocumentType!: 'estimate' | 'invoice';
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

// ── Import from Zoho invoices (grouped) ──────────────────────────────
export class ImportInvoiceRefDto {
  // Optional: estimate-sourced history rows have a quote but no invoice.
  @IsOptional() @IsString() invoiceId?: string;
  @IsOptional() @IsString() invoiceNumber?: string;
  @IsOptional() @IsDateString() invoiceDate?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsNumber() quantity?: number;
  @IsOptional() @IsNumber() price?: number;
  // Zoho Business Type? → Fresh | Renewal | Pro-rata | Transfer
  @IsOptional() @IsString() businessType?: string;

  // Originating Zoho estimate/quote (resolved from invoice.estimate_id) → links the
  // quote into renewal_history alongside its invoice.
  @IsOptional() @IsString() @MaxLength(80) quoteId?: string;
  @IsOptional() @IsString() @MaxLength(80) quoteNumber?: string;
  @IsOptional() @IsDateString() quoteDate?: string;
  // Zoho estimate status snapshot (draft|sent|accepted|invoiced|…) when known.
  @IsOptional() @IsString() @MaxLength(30) quoteStatus?: string;

  // Billing currency of this document + its exchange rate to the org base currency.
  @IsOptional() @IsString() @MaxLength(10) currency?: string;
  @IsOptional() @IsNumber() exchangeRate?: number;
}

export class ImportSubscriptionDto {
  @IsString() organizationId!: string;
  @IsString() zohoCustomerId!: string;
  @IsOptional() @IsString() zohoCustomerName?: string;
  @IsString() zohoItemId!: string;
  @IsOptional() @IsString() zohoItemName?: string;
  @IsString() domainName!: string;

  @IsNumber() @Min(0) quantity!: number;
  @IsNumber() @Min(0) subscriptionPrice!: number;
  @IsOptional() @IsNumber() @Min(0) costPrice?: number;
  @IsEnum(BillingCycle) billingCycle!: BillingCycle;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsString() @MaxLength(80) lastInvoiceId?: string;
  @IsOptional() @IsString() @MaxLength(80) lastInvoiceNumber?: string;

  // Estimate-sourced import: when true, only create a new subscription if the
  // quote is Accepted/Invoiced; otherwise link history to an existing sub only.
  @IsOptional() @IsBoolean() sourceIsEstimate?: boolean;
  @IsOptional() @IsString() @MaxLength(30) sourceQuoteStatus?: string;

  // Billing currency of this subscription + exchange rate to the org base currency (INR).
  @IsOptional() @IsString() @MaxLength(10) currency?: string;
  @IsOptional() @IsNumber() exchangeRate?: number;

  // Historical invoices/quotes for this subscription → become renewal_history rows
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ImportInvoiceRefDto)
  history?: ImportInvoiceRefDto[];
}

export class ImportSubscriptionsBatchDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ImportSubscriptionDto)
  subscriptions!: ImportSubscriptionDto[];
}

export class BulkCreateFromQuoteDto {
  @IsUUID() quote_id!: string;
}

export class BulkUpdatePriceDto {
  @IsArray()
  @IsString({ each: true })
  subscriptionIds!: string[];

  @IsNumber()
  @Min(0)
  newPrice!: number;
}

export class BulkRenewalQuoteDto {
  @IsArray()
  @IsString({ each: true })
  subscriptionIds!: string[];

  @IsOptional()
  @IsObject()
  priceOverrides?: Record<string, number>;
}

// Combined single quote — many subscriptions (mixed items/cycles/renewal dates) of
// ONE customer collapsed into a single multi-line Zoho estimate.
export class CombinedRenewalQuoteDto {
  @IsArray()
  @IsString({ each: true })
  subscriptionIds!: string[];

  // Optional per-subscription unit-price override, keyed by subscription id.
  @IsOptional()
  @IsObject()
  priceOverrides?: Record<string, number>;
}
