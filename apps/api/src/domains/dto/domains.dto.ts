import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DomainStatus } from '@prisma/client';

export class CreateDomainDto {
  @IsString() @MaxLength(255) domainName!: string;
  @IsString() organizationId!: string;
  @IsString() @MaxLength(80) zohoCustomerId!: string;
  @IsOptional() @IsString() @MaxLength(250) zohoCustomerName?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateDomainDto {
  @IsOptional() @IsEnum(DomainStatus) status?: DomainStatus;
  @IsOptional() @IsString() @MaxLength(250) zohoCustomerName?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
