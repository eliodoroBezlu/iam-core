import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Servicios autorizados a ESCRIBIR el padrón. Leerlo (GET /rbac/trabajadores)
 * sigue abierto a cualquier servicio con API key válida, como forms.
 */
export const SERVICIOS_QUE_ESCRIBEN_PADRON = new Set(['sync-msc']);

/**
 * Va después de ApiKeyGuard (que deja `apiKeyService`). Como guard corre antes
 * que la validación del cuerpo: un servicio no autorizado recibe 403 directo,
 * sin enterarse de las reglas de validación.
 */
@Injectable()
export class ServicioEscribePadronGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { apiKeyService?: string }>();
    const serviceKey = req.apiKeyService ?? '';
    if (!SERVICIOS_QUE_ESCRIBEN_PADRON.has(serviceKey)) {
      throw new ForbiddenException(
        `El servicio '${serviceKey}' no puede modificar el padrón de trabajadores`,
      );
    }
    return true;
  }
}
