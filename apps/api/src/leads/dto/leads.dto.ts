import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, IsDateString, IsNumber, Min } from 'class-validator';

export enum LeadStatusInput {
  New = 'New',
  Contacted = 'Contacted',
  Quoted = 'Quoted',
  Negotiating = 'Negotiating',
  Won = 'Won',
  Lost = 'Lost',
  Archived = 'Archived',
}

export class CreateLeadDto {
  @IsString() @IsOptional() @MaxLength(250)
  company_name?: string;

  @IsString() @IsOptional() @MaxLength(200)
  contact_name?: string;

  @IsEmail()
  email!: string;

  @IsString() @IsOptional()
  target_organization_id?: string;

  @IsString() @IsOptional() @MaxLength(50)
  phone?: string;

  @IsString() @IsOptional() @MaxLength(100)
  designation?: string;

  @IsString() @IsOptional() @MaxLength(250)
  billing_address_line1?: string;

  @IsString() @IsOptional() @MaxLength(250)
  billing_address_line2?: string;

  @IsString() @IsOptional() @MaxLength(100)
  city?: string;

  @IsString() @IsOptional() @MaxLength(100)
  state?: string;

  @IsString() @IsOptional() @MaxLength(10)
  state_code?: string;

  @IsString() @IsOptional() @MaxLength(20)
  postal_code?: string;

  @IsString() @IsOptional() @MaxLength(100)
  country?: string;

  @IsString() @IsOptional() @MaxLength(30)
  gstin?: string;

  @IsString() @IsOptional()
  gst_treatment?: string;

  @IsString() @IsOptional() @MaxLength(30)
  pan?: string;

  @IsString() @IsOptional() @MaxLength(255)
  primary_domain?: string;

  @IsString() @IsOptional() @MaxLength(100)
  industry?: string;

  @IsString() @IsOptional() @MaxLength(100)
  lead_source?: string;

  @IsDateString() @IsOptional()
  estimated_close_date?: string;

  @IsNumber() @IsOptional() @Min(0)
  estimated_value?: number;

  @IsString() @IsOptional()
  notes?: string;
}

export class UpdateLeadDto {
  @IsString() @IsOptional() @MaxLength(250)
  company_name?: string;

  @IsString() @IsOptional()
  target_organization_id?: string;

  @IsString() @IsOptional() @MaxLength(200)
  contact_name?: string;

  @IsEmail() @IsOptional()
  email?: string;

  @IsString() @IsOptional() @MaxLength(50)
  phone?: string;

  @IsString() @IsOptional() @MaxLength(100)
  designation?: string;

  @IsString() @IsOptional() @MaxLength(250)
  billing_address_line1?: string;

  @IsString() @IsOptional() @MaxLength(250)
  billing_address_line2?: string;

  @IsString() @IsOptional() @MaxLength(100)
  city?: string;

  @IsString() @IsOptional() @MaxLength(100)
  state?: string;

  @IsString() @IsOptional() @MaxLength(10)
  state_code?: string;

  @IsString() @IsOptional() @MaxLength(20)
  postal_code?: string;

  @IsString() @IsOptional() @MaxLength(30)
  gstin?: string;

  @IsString() @IsOptional()
  gst_treatment?: string;

  @IsString() @IsOptional() @MaxLength(30)
  pan?: string;

  @IsString() @IsOptional() @MaxLength(255)
  primary_domain?: string;

  @IsString() @IsOptional() @MaxLength(100)
  industry?: string;

  @IsString() @IsOptional() @MaxLength(100)
  lead_source?: string;

  @IsEnum(LeadStatusInput) @IsOptional()
  status?: LeadStatusInput;

  @IsDateString() @IsOptional()
  estimated_close_date?: string;

  @IsNumber() @IsOptional() @Min(0)
  estimated_value?: number;

  @IsString() @IsOptional() @MaxLength(250)
  lost_reason?: string;

  @IsString() @IsOptional()
  notes?: string;
}
