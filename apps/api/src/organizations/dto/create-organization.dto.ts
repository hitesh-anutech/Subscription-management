import { IsString, IsOptional, IsBoolean, IsEnum, MaxLength, MinLength } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  zoho_org_id!: string;

  @IsOptional()
  @IsEnum(['in', 'com', 'eu', 'com.au', 'jp', 'sa'])
  data_center?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  base_currency?: string;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
