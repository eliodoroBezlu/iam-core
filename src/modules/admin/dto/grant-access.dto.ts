import { IsString, IsArray, IsOptional, IsDateString, IsObject } from 'class-validator';
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

  // Metadata libre de autorización por-servicio.
  // Ej. para sync-msc: { "areas": ["3320", "3330"], "disciplina": "MEC" }
  @ApiPropertyOptional({ example: { areas: ['3320', '3330'], disciplina: 'MEC' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateServiceRolesDto {
  @ApiProperty({ example: ['forms:supervisor'] })
  @IsArray()
  @IsString({ each: true })
  roles: string[];

  @ApiPropertyOptional({ example: { areas: ['3320'], disciplina: 'MEC' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
