import { IsString, MinLength, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'juan_perez' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: 'Contraseña@2024' })
  @IsString()
  @MinLength(1)
  password: string;
}
