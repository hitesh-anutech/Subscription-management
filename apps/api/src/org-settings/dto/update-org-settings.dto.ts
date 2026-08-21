import {
  IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString,
  Max, MaxLength, Min,
} from 'class-validator';

/**
 * class-validator DTO (not nestjs-zod): the global ValidationPipe runs with
 * `whitelist + forbidNonWhitelisted`, which only recognises class-validator
 * metadata — a createZodDto class has none, so every property was rejected
 * with "property X should not exist" (BUG-016).
 * All fields optional; explicit null clears the column.
 */
export class UpdateOrgSettingsDto {
  // Branding
  @IsOptional() @IsString() @MaxLength(250)
  legalName?: string | null;

  @IsOptional() @IsString() @MaxLength(250)
  displayName?: string | null;

  @IsOptional() @IsString()
  logoUrl?: string | null;

  @IsOptional() @IsString() @MaxLength(20)
  brandColor?: string | null;

  // Header / contact
  @IsOptional() @IsString() @MaxLength(250)
  addressLine1?: string | null;

  @IsOptional() @IsString() @MaxLength(250)
  addressLine2?: string | null;

  @IsOptional() @IsString() @MaxLength(100)
  city?: string | null;

  @IsOptional() @IsString() @MaxLength(100)
  state?: string | null;

  @IsOptional() @IsString() @MaxLength(10)
  stateCode?: string | null;

  @IsOptional() @IsString() @MaxLength(20)
  postalCode?: string | null;

  @IsOptional() @IsString() @MaxLength(100)
  country?: string | null;

  @IsOptional() @IsString() @MaxLength(30)
  gstin?: string | null;

  @IsOptional() @IsString() @MaxLength(30)
  pan?: string | null;

  @IsOptional() @IsString() @MaxLength(50)
  phone?: string | null;

  @IsOptional() @IsEmail()
  email?: string | null;

  @IsOptional() @IsString() @MaxLength(250)
  website?: string | null;

  // PDF appearance
  @IsOptional() @IsIn(['modern', 'classic', 'minimal', 'compact'])
  pdfTemplate?: 'modern' | 'classic' | 'minimal' | 'compact';

  @IsOptional() @IsString()
  pdfFooterText?: string | null;

  @IsOptional() @IsBoolean()
  pdfShowCostPrice?: boolean;

  @IsOptional() @IsBoolean()
  pdfShowInternalNotes?: boolean;

  @IsOptional() @IsString() @MaxLength(50)
  pdfWatermark?: string | null;

  @IsOptional() @IsString()
  signatureImageUrl?: string | null;

  // Bank details
  @IsOptional() @IsString() @MaxLength(100)
  bankName?: string | null;

  @IsOptional() @IsString() @MaxLength(50)
  bankAccountNumber?: string | null;

  @IsOptional() @IsString() @MaxLength(20)
  bankIfsc?: string | null;

  @IsOptional() @IsString() @MaxLength(250)
  bankAccountHolder?: string | null;

  // Tax defaults
  @IsOptional() @IsNumber() @Min(0) @Max(100)
  defaultTaxRate?: number;

  @IsOptional() @IsString() @MaxLength(100)
  supplierState?: string | null;

  @IsOptional() @IsString() @MaxLength(10)
  supplierStateCode?: string | null;

  // Email overrides (per-org)
  @IsOptional() @IsEmail()
  emailFromAddress?: string | null;

  @IsOptional() @IsEmail()
  emailReplyTo?: string | null;

  // Per-org Gmail SMTP credentials
  @IsOptional() @IsEmail()
  smtpUser?: string | null;

  @IsOptional() @IsString()
  smtpPassword?: string | null;

  // Quote defaults override
  @IsOptional() @IsInt() @Min(1)
  quoteValidityDays?: number | null;

  @IsOptional() @IsString()
  quoteTermsAndConditions?: string | null;

  @IsOptional() @IsString()
  quoteNotesToCustomer?: string | null;

  @IsOptional() @IsString() @MaxLength(50)
  quoteNumberFormat?: string | null;

  @IsOptional() @IsString() @MaxLength(50)
  leadNumberFormat?: string | null;

  @IsOptional() @IsString() @MaxLength(50)
  subscriptionNumberFormat?: string | null;

  @IsOptional()
  settingsOverrides?: Record<string, unknown> | null;
}
