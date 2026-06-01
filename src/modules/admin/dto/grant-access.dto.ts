import { IsString, IsArray, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GrantServiceAccessDto {
  @ApiProperty({ example: 'forms' })
  @IsString()
  serviceKey: string;

  @ApiProperty({ example: ['forms:inspector', 'forms:supervisor'] })
  @IsArray()
  @IsString({ each: true })
  roles: string[];

  @ApiPropertyOptional({ example: '2027-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateServiceRolesDto {
  @ApiProperty({ example: ['forms:supervisor'] })
  @IsArray()
  @IsString({ each: true })
  roles: string[];
}
