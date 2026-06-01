import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class Setup2faDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 8)
  code: string;
}
