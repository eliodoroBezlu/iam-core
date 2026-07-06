import { IsString, IsOptional, IsBoolean, IsArray, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateServiceDto {
  @ApiPropertyOptional({ example: 'Formularios de Inspección v2' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ example: 'http://localhost:3002' })
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: ['admin', 'supervisor', 'inspector'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  availableRoles?: string[];

  @ApiPropertyOptional({ example: ['create:form', 'approve:form'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionCatalog?: string[];

  @ApiPropertyOptional({ example: { admin: ['create:form'], supervisor: ['read:form'] } })
  @IsOptional()
  @IsObject()
  rolePermissions?: Record<string, string[]>;
}
