import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly config:  ConfigService,
  ) {
    const publicKey = JwtStrategy.resolvePublicKey(config);

    super({
      // Extraer JWT desde cookie access_token — compatible con el Forms Service
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req) => req?.cookies?.access_token ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(), // Fallback para API clients
      ]),
      ignoreExpiration:  false,
      secretOrKey:       publicKey,
      algorithms:        ['RS256'],
      issuer:            config.get<string>('JWT_ISSUER', 'iam-core'),
    });
  }

  /**
   * Resuelve la clave pública RSA de forma robusta:
   *  1. JWT_PUBLIC_KEY con contenido PEM → se usa directo (cloud).
   *  2. JWT_PUBLIC_KEY_PATH con contenido PEM → también directo (mal configurado).
   *  3. JWT_PUBLIC_KEY_PATH como ruta a archivo → se lee del disco (local).
   * Los `\n` literales (env vars de Railway/Docker) se restauran.
   */
  private static resolvePublicKey(config: ConfigService): string {
    const inline = config.get<string>('JWT_PUBLIC_KEY');
    if (inline && inline.includes('BEGIN')) {
      return inline.replace(/\\n/g, '\n');
    }

    const pathValue = config.get<string>('JWT_PUBLIC_KEY_PATH');

    if (pathValue && pathValue.includes('BEGIN')) {
      return pathValue.replace(/\\n/g, '\n');
    }

    if (pathValue) {
      const resolved = path.resolve(pathValue);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Clave pública RSA no encontrada: ${resolved}. Ejecutar: yarn keys:generate`);
      }
      return fs.readFileSync(resolved, 'utf8');
    }

    throw new Error(
      'Falta la clave pública: define JWT_PUBLIC_KEY (contenido PEM) o JWT_PUBLIC_KEY_PATH (ruta al archivo .pem)',
    );
  }

  /**
   * Llamado después de verificar la firma del JWT.
   * Hidrata el usuario completo desde PostgreSQL para tener datos frescos.
   */
  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where:  { id: payload.sub },
      select: {
        id:           true,
        username:     true,
        email:        true,
        fullName:     true,
        roles:        true,
        permissions:  true,
        isActive:     true,
        isAdmin:      true,
        totpEnabled:  true,
        createdAt:    true,
        updatedAt:    true,
        lastLoginAt:  true,
        avatarUrl:    true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuario no autorizado o desactivado');
    }

    return user;
  }
}
