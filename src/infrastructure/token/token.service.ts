import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface JwtPayload {
  sub: string;       // userId (UUID)
  username: string;
  email?: string;
  roles: string[];
  services: string[]; // keys de servicios accesibles
  iss: string;
  aud: string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string; // UUID opaco — nunca un JWT
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private privateKey: string;
  private publicKey: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    this.loadKeys();
  }

  private loadKeys() {
    try {
      this.privateKey = this.resolveKey('JWT_PRIVATE_KEY', 'JWT_PRIVATE_KEY_PATH', 'privada');
      this.publicKey  = this.resolveKey('JWT_PUBLIC_KEY',  'JWT_PUBLIC_KEY_PATH',  'pública');
      this.logger.log('Claves RSA cargadas correctamente');
    } catch (error) {
      this.logger.error('Error cargando claves RSA:', error.message);
      throw error;
    }
  }

  /**
   * Resuelve una clave RSA de forma robusta:
   *  1. Si la variable inline (ej. JWT_PRIVATE_KEY) contiene un PEM → se usa directo.
   *  2. Si la variable _PATH contiene un PEM (mal configurado) → también se usa directo.
   *  3. Si la variable _PATH es una ruta a archivo → se lee del disco (modo local).
   *
   * Los saltos de línea `\n` literales (típico en env vars de Railway/Docker)
   * se restauran a saltos reales.
   */
  private resolveKey(inlineVar: string, pathVar: string, label: string): string {
    const inline = this.config.get<string>(inlineVar);
    if (inline && inline.includes('BEGIN')) {
      return inline.replace(/\\n/g, '\n');
    }

    const pathValue = this.config.get<string>(pathVar);

    // Caso: el usuario pegó el contenido PEM dentro de la variable _PATH
    if (pathValue && pathValue.includes('BEGIN')) {
      return pathValue.replace(/\\n/g, '\n');
    }

    // Caso: ruta a un archivo en disco (desarrollo local)
    if (pathValue) {
      const resolved = path.resolve(pathValue);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Clave ${label} no encontrada: ${resolved}. Ejecutar: yarn keys:generate`);
      }
      return fs.readFileSync(resolved, 'utf8');
    }

    throw new Error(
      `Falta la clave ${label}: define ${inlineVar} (contenido PEM) o ${pathVar} (ruta al archivo .pem)`,
    );
  }

  /**
   * Genera el par de tokens (access + refresh) para un usuario autenticado.
   * El access token es un JWT RS256.
   * El refresh token es un UUID opaco — no es un JWT.
   */
  generateTokenPair(payload: JwtPayload): TokenPair {
    const accessToken  = this.signAccessToken(payload);
    const refreshToken = this.generateOpaqueToken();
    return { accessToken, refreshToken };
  }

  /**
   * Firma el access token como JWT RS256.
   * El payload es mínimo: sub, username, roles, services, iss, aud.
   * Los permisos NO van en el JWT — se computan en runtime.
   */
  signAccessToken(payload: JwtPayload): string {
    // IMPORTANTE: ConfigService.get<number>() es solo type-cast TS, no coerciona.
    // process.env.* siempre es string, y jsonwebtoken interpreta strings sin
    // sufijo como milisegundos. Coercionar explícitamente a Number (segundos).
    const expiresIn = Number(this.config.get('JWT_ACCESS_EXPIRY')) || 900;

    return this.jwtService.sign(
      {
        sub:      payload.sub,
        username: payload.username,
        email:    payload.email,
        roles:    payload.roles,
        services: payload.services,
      },
      {
        privateKey:  this.privateKey,
        algorithm:   'RS256',
        expiresIn,
        issuer:      this.config.get<string>('JWT_ISSUER', 'iam-core'),
        audience:    this.config.get<string>('JWT_AUDIENCE', 'forms-service').split(','),
        keyid:       'iam-key-v1',
      },
    );
  }

  /**
   * Token temporal para el flujo de 2FA.
   * Solo contiene el sub — duración 5 minutos.
   */
  signTempToken(userId: string): string {
    const expiresIn = Number(this.config.get('JWT_TEMP_EXPIRY')) || 300;

    return this.jwtService.sign(
      { sub: userId, type: '2fa_pending' },
      {
        privateKey: this.privateKey,
        algorithm:  'RS256',
        expiresIn,
        issuer:     this.config.get<string>('JWT_ISSUER', 'iam-core'),
      },
    );
  }

  /**
   * Verifica y decodifica el token temporal de 2FA.
   */
  verifyTempToken(token: string): { sub: string; type: string } {
    return this.jwtService.verify(token, {
      publicKey:  this.publicKey,
      algorithms: ['RS256'],
    });
  }

  /**
   * Genera un UUID opaco para el refresh token.
   * El hash SHA-256 se almacena en BD — el UUID crudo va al cliente.
   */
  generateOpaqueToken(): string {
    return randomUUID();
  }

  /**
   * Hashea un token opaco para comparación segura en BD.
   */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Devuelve la clave pública RSA para que servicios hijos validen JWTs.
   */
  getPublicKey(): string {
    return this.publicKey;
  }
}
