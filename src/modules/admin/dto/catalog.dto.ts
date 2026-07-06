import { IsString, IsOptional, IsBoolean, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSuperintendenciaDto {
  @ApiProperty({ example: 'Superintendencia de Mantenimiento - Planta' })
  @IsString()
  @MinLength(3)
  nombre: string;
}

export class UpdateSuperintendenciaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class CreateAreaDto {
  @ApiProperty({ example: '3320' })
  @IsString()
  @MinLength(1)
  codigo: string;

  @ApiProperty({ example: 'Molienda' })
  @IsString()
  @MinLength(1)
  nombre: string;

  @ApiProperty({ example: 'uuid-de-la-superintendencia' })
  @IsString()
  superintendenciaId: string;
}

export class UpdateAreaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  superintendenciaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
