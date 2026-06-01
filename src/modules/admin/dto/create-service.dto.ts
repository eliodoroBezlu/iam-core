import { IsString, IsUrl, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateServiceDto {
  @ApiProperty({ example: 'forms' })
  @IsString()
  key: string;

  @ApiProperty({ example: 'Formularios de Inspección' })
  @IsString()
  displayName: string;

  @ApiProperty({ example: 'http://localhost:3002' })
  @IsString()
  baseUrl: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
