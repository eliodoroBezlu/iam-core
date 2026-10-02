import type { ExecutionContext } from '@nestjs/common';

/**
 * Clave con la que `@Throttle({ strict: { … } })` guarda su límite en la ruta
 * (o en la clase). Es `THROTTLER_LIMIT + nombre` de @nestjs/throttler v6, que el
 * paquete no exporta; la prueba de throttle.util.spec.ts se rompe si cambia.
 */
export const CLAVE_LIMITE_STRICT = 'THROTTLER:LIMITstrict';

/** ¿La ruta (o su controlador) pidió explícitamente el limitador `strict`? */
export function pideLimiteStrict(ctx: ExecutionContext): boolean {
  return (
    Reflect.getMetadata(CLAVE_LIMITE_STRICT, ctx.getHandler()) !== undefined ||
    Reflect.getMetadata(CLAVE_LIMITE_STRICT, ctx.getClass()) !== undefined
  );
}
