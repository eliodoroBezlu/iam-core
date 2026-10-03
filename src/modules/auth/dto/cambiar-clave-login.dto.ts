import { IsString, IsNotEmpty, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Paso del login en que una cuenta con contraseña provisional elige la suya. */
export class CambiarClaveLoginDto {
  @ApiProperty({ example: 'eyJhbGciOiJSUzI1NiJ9...' })
  @IsString()
  @IsNotEmpty()
  tempToken: string;

  // Mismas reglas que ChangePasswordDto.
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    { message: 'La contraseña debe tener mayúsculas, minúsculas, números y caracteres especiales' },
  )
  newPassword: string;
}
