import {
  IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsNumber,
  IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum CustomerTypeInput {
  lead = 'lead',
  existing = 'existing',
}

/** One entry of a bulk-domains quote line — becomes one subscription at convert. */
export class QuoteItemDomainDto {
  @IsString() @MaxLength(255)
  domain!: string;

  @IsNumber() @IsOptional() @Min(1)
  qty?: number;
}

export class QuoteItemDto {
  @IsInt() @Min(1)
  line_order!: number;

  @IsString() @IsOptional() @MaxLength(80)
  zoho_item_id?: string;

  @IsString() @MaxLength(250)
  item_name!: string;

  @IsString() @IsOptional()
  item_description?: string;

  @IsString() @IsOptional() @MaxLength(20)
  hsn_or_sac?: string;

  @IsNumber() @Min(0)
  quantity!: number;

  @IsNumber() @Min(0)
  unit_price!: number;

  @IsNumber() @IsOptional() @Min(0)
  cost_price?: number;

  @IsNumber() @IsOptional() @Min(0)
  discount_percent?: number;

  @IsNumber() @IsOptional() @Min(0)
  tax_rate?: number;

  @IsBoolean() @IsOptional()
  is_subscription?: boolean;

  @IsString() @IsOptional()
  billing_cycle?: string;

  @IsString() @IsOptional()
  service_period_start?: string;

  @IsString() @IsOptional()
  service_period_end?: string;

  @IsString() @IsOptional() @MaxLength(255)
  primary_domain?: string;

  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => QuoteItemDomainDto)
  domain_list?: QuoteItemDomainDto[];

  @IsUUID() @IsOptional()
  renewed_subscription_id?: string;
}

export class CreateQuickQuoteDto {
  @IsEnum(CustomerTypeInput)
  customer_type!: CustomerTypeInput;

  // Mode B (lead)
  @IsUUID() @IsOptional()
  lead_id?: string;

  // Mode A (existing Zoho customer)
  @IsString() @IsOptional() @MaxLength(80)
  zoho_customer_id?: string;

  @IsString() @IsOptional() @MaxLength(250)
  zoho_customer_name?: string;

  @IsUUID()
  target_organization_id!: string;

  // Quote metadata (user-editable)
  @IsString() @IsOptional() @MaxLength(50)
  quote_number?: string;

  @IsString() @IsOptional()
  quote_date?: string;           // ISO date string, defaults to today

  @IsString() @IsOptional()
  expiry_date?: string;          // ISO date string, overrides validity_days if provided

  @IsString() @IsOptional() @MaxLength(250)
  quote_reference?: string;      // Customer PO / reference number

  @IsInt() @IsOptional() @Min(1)
  validity_days?: number;

  @IsArray() @ValidateNested({ each: true }) @Type(() => QuoteItemDto)
  items!: QuoteItemDto[];

  @IsBoolean() @IsOptional()
  is_intra_state?: boolean;

  @IsNumber() @IsOptional() @Min(0)
  cgst_rate?: number;

  @IsNumber() @IsOptional() @Min(0)
  sgst_rate?: number;

  @IsNumber() @IsOptional() @Min(0)
  igst_rate?: number;

  @IsString() @IsOptional()
  terms_and_conditions?: string;

  @IsString() @IsOptional()
  notes_to_customer?: string;

  @IsString() @IsOptional()
  internal_notes?: string;
}

export class UpdateQuickQuoteDto {
  @IsInt() @IsOptional() @Min(1)
  validity_days?: number;

  @IsArray() @ValidateNested({ each: true }) @Type(() => QuoteItemDto) @IsOptional()
  items?: QuoteItemDto[];

  @IsBoolean() @IsOptional()
  is_intra_state?: boolean;

  @IsNumber() @IsOptional() @Min(0)
  cgst_rate?: number;

  @IsNumber() @IsOptional() @Min(0)
  sgst_rate?: number;

  @IsNumber() @IsOptional() @Min(0)
  igst_rate?: number;

  @IsString() @IsOptional()
  terms_and_conditions?: string;

  @IsString() @IsOptional()
  notes_to_customer?: string;

  @IsString() @IsOptional()
  internal_notes?: string;
}

export class SendQuoteDto {
  @IsEmail() @IsOptional()
  recipient_email?: string;

  @IsString() @IsOptional()
  message?: string;
}

export class AcceptQuoteDto {
  @IsString()
  token!: string;

  @IsString() @IsOptional()
  accepted_by_name?: string;
}

export class RejectQuoteDto {
  @IsString()
  token!: string;

  @IsString() @IsOptional()
  reason?: string;
}
