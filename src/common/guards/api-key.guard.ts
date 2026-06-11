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
 * NOTA: Este guard NO omite rutas @Public() cuando se aplica
 * explícitamente en un endpoint (ej. service-login). Solo omite
 * la validación cuando se usa como guard global y la ruta es pública.
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector }    from '@nestjs/core';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { createHash }   from 'crypto';

/** Marca un handler para que ApiKeyGuard lo omita (rutas realmente abiertas) */
export const SKIP_API_KEY = 'skipApiKey';
export const SkipApiKey = () => SetMetadata(SKIP_API_KEY, true);

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma:    PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Solo saltar si el handler está explícitamente marcado con @SkipApiKey()
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_API_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

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
