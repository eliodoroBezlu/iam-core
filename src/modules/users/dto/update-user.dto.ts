import {
  IsString, IsEmail, IsOptional, IsArray, IsBoolean,
  MinLength, Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fullName?: string;

  // El catálogo de roles es dinámico (`Service.availableRoles`, editable por
  // GUI), así que aquí sólo se valida la forma. La existencia la comprueba
  // `RoleCatalogService.assertRolesExisten` en UsersService.
  @ApiPropertyOptional({ isArray: true, example: ['inspector_asignado'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

export class ChangePasswordDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currentPassword?: string; // Requerido si el propio usuario cambia su password

  @IsString()
  @MinLength(8)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    { message: 'La contraseña debe tener mayúsculas, minúsculas, números y caracteres especiales' },
  )
  newPassword: string;
}
