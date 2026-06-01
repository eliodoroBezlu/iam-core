import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca un endpoint como público — bypasea el JwtGuard global.
 * Usar en: health checks, /auth/login, /auth/refresh, /auth/public-key
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
