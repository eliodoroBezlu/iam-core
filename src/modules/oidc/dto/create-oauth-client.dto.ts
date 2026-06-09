import {
  IsString, IsArray, IsBoolean, IsOptional, ArrayNotEmpty, MinLength,
} from 'class-validator';

export class CreateOAuthClientDto {
  @IsString()
  @MinLength(3)
  name: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  redirectUris: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  postLogoutRedirectUris?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedScopes?: string[];

  @IsOptional()
  @IsBoolean()
  isConfidential?: boolean;

  @IsOptional()
  @IsString()
  serviceKey?: string;
}
