import { IsString, IsNotEmpty, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class Verify2faDto {
  @ApiProperty({ example: 'eyJhbGciOiJSUzI1NiJ9...' })
  @IsString()
  @IsNotEmpty()
  tempToken: string;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 8 })
  @IsString()
  @Length(6, 8)
  code: string;
}
