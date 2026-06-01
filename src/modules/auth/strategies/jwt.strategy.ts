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
    const publicKeyPath = config.get<string>('JWT_PUBLIC_KEY_PATH');
    const resolvedPath  = path.resolve(publicKeyPath!);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Clave pública RSA no encontrada: ${resolvedPath}. Ejecutar: yarn keys:generate`);
    }

    const publicKey = fs.readFileSync(resolvedPath, 'utf8');

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
