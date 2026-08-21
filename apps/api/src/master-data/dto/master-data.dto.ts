import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateMasterDataItemDto {
  @IsString()
  @MaxLength(200)
  itemValue!: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  itemLabel?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class UpdateMasterDataItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(250)
  itemLabel?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
