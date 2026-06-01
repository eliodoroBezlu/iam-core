/**
 * Payload del JWT emitido por el IAM Core.
 * Diseñado para ser compatible con los servicios hijos (forms, iro-service).
 *
 * IMPORTANTE: Los permisos NO se incluyen en el JWT.
 * Se computan en runtime desde el array de roles.
 * Esto evita el anti-patrón de permisos stale en tokens no revocados.
 */
export interface JwtPayload {
  sub:      string;     // userId (UUID de PostgreSQL)
  username: string;
  email?:   string;
  roles:    string[];   // Compatible con Role enum del Forms Service
  services: string[];   // Keys de servicios a los que tiene acceso
  iss:      string;     // 'iam-core'
  aud:      string[];   // ['forms-service', 'iro-service', ...]
  iat:      number;
  exp:      number;
}

/**
 * Token temporal para el flujo de 2FA.
 * Emitido después del primer factor correcto.
 * Solo válido por 5 minutos.
 */
export interface TempTokenPayload {
  sub:  string;
  type: '2fa_pending';
  iat:  number;
  exp:  number;
}
