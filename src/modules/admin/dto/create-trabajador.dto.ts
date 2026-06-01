import {
  IsString, IsOptional, IsDateString,
  MinLength, MaxLength, Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTrabajadorDto {
  @ApiProperty({ example: '7654321' })
  @IsString()
  @MinLength(5)
  @MaxLength(12)
  @Matches(/^[0-9A-Za-z-]+$/, { message: 'CI inválido' })
  ci: string;

  @ApiProperty({ example: 'GOMEZ JUAN' })
  @IsString()
  @MinLength(2)
  nomina: string;

  @ApiProperty({ example: 'Operador Mina' })
  @IsString()
  @MinLength(2)
  puesto: string;

  @ApiProperty({ example: 'Superintendencia de Operaciones' })
  @IsString()
  superintendencia: string;

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
}
