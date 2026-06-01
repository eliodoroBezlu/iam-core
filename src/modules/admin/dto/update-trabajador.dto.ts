import {
  IsString, IsOptional, IsBoolean, IsDateString,
  MinLength, MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTrabajadorDto {
  @ApiPropertyOptional({ example: 'GOMEZ JUAN' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  nomina?: string;

  @ApiPropertyOptional({ example: 'Operador Mina' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  puesto?: string;

  @ApiPropertyOptional({ example: 'Superintendencia de Operaciones' })
  @IsOptional()
  @IsString()
  superintendencia?: string;

  @ApiPropertyOptional({ example: 'Área Norte' })
  @IsOptional()
  @IsString()
  area?: string;

  @ApiPropertyOptional({ example: '2020-01-15' })
  @IsOptional()
  @IsDateString()
  fechaIngreso?: string;

  @ApiPropertyOptional({ example: '12345' })
  @IsOptional()
  @IsString()
  jde?: string;

  @ApiPropertyOptional({ example: 'B-3' })
  @IsOptional()
  @IsString()
  noBloque?: string;

  @ApiPropertyOptional({ example: '102' })
  @IsOptional()
  @IsString()
  noHabitacion?: string;

  @ApiPropertyOptional({ example: 'Campamento Central' })
  @IsOptional()
  @IsString()
  residencia?: string;

  @ApiPropertyOptional({ example: '71234567' })
  @IsOptional()
  @IsString()
  @MaxLength(15)
  celular?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
