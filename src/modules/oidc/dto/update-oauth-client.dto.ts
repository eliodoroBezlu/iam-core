import {
  IsString, IsArray, IsBoolean, IsOptional, IsString as IsStr, MinLength,
} from 'class-validator';

export class UpdateOAuthClientDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsStr({ each: true })
  redirectUris?: string[];

  @IsOptional()
  @IsArray()
  @IsStr({ each: true })
  postLogoutRedirectUris?: string[];

  @IsOptional()
  @IsArray()
  @IsStr({ each: true })
  allowedScopes?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
