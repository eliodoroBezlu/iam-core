/**
 * ApiKeyGuard
 * ─────────────────────────────────────────────────────────────────
 * Valida el header X-Api-Key en endpoints service-to-service.
 *
 * Flujo:
 *  1. Extrae el header X-Api-Key del request.
 *  2. Calcula SHA-256(rawKey).
 *  3. Busca en la tabla api_keys donde keyHash coincide.
 *  4. Verifica que la key esté activa y no expirada.
 *  5. Actualiza lastUsedAt (fire-and-forget).
 *
 * Los endpoints marcados con @Public() quedan excluidos automáticamente
 * (JWKS, public-key, etc. no necesitan API Key).
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector }    from '@nestjs/core';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { createHash }   from 'crypto';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma:    PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Rutas públicas (JWKS, public-key) → saltar validación
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const rawKey  = request.headers['x-api-key'] as string | undefined;

    if (!rawKey) {
      throw new UnauthorizedException('API Key requerida (X-Api-Key)');
    }

    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await this.prisma.apiKey.findFirst({
      where: {
        keyHash,
        isActive:  true,
        revokedAt: null,
      },
      include: { service: { select: { key: true, isActive: true } } },
    });

    if (!apiKey) {
      throw new UnauthorizedException('API Key inválida o revocada');
    }

    // Verificar expiración
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedException('API Key expirada');
    }

    // Verificar que el servicio asociado esté activo
    if (!apiKey.service.isActive) {
      throw new UnauthorizedException('Servicio desactivado');
    }

    // Actualizar lastUsedAt en background (no bloquea la request)
    this.prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {/* ignorar errores de tracking */});

    // Adjuntar info del servicio al request para uso posterior
    request.apiKeyService = apiKey.service.key;

    return true;
  }
}
