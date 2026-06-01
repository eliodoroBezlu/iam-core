import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TokenService } from '../../infrastructure/token/token.service';
import { addSeconds } from 'date-fns';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly token:   TokenService,
    private readonly config:  ConfigService,
  ) {}

  /**
   * Crea una nueva sesión para el usuario.
   * Devuelve el refreshToken OPACO (UUID) que va al cliente.
   * Solo el hash SHA-256 se persiste en BD.
   */
  async create(params: {
    userId:            string;
    userAgent?:        string;
    ipAddress?:        string;
    deviceFingerprint?: string;
  }): Promise<string> {
    const opaqueToken = this.token.generateOpaqueToken();
    const tokenHash   = this.token.hashToken(opaqueToken);
    const expirySeconds = Number(this.config.get('JWT_REFRESH_EXPIRY')) || 28800;

    await this.prisma.session.create({
      data: {
        userId:            params.userId,
        tokenHash,
        userAgent:         params.userAgent         ?? null,
        ipAddress:         params.ipAddress          ?? null,
        deviceFingerprint: params.deviceFingerprint  ?? null,
        expiresAt:         addSeconds(new Date(), expirySeconds),
      },
    });

    return opaqueToken; // Solo el cliente recibe el token en claro
  }

  /**
   * Valida un refresh token opaco y devuelve la sesión si es válida.
   * O(1) — busca directamente por hash.
   */
  async findValidSession(opaqueToken: string) {
    const tokenHash = this.token.hashToken(opaqueToken);

    const session = await this.prisma.session.findUnique({
      where:   { tokenHash },
      include: { user: true },
    });

    if (!session) {
      throw new UnauthorizedException('Sesión no encontrada');
    }
    if (session.revokedAt !== null) {
      throw new UnauthorizedException('Sesión revocada');
    }
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Sesión expirada');
    }
    if (!session.user.isActive) {
      throw new UnauthorizedException('Usuario desactivado');
    }

    return session;
  }

  /**
   * Rota el refresh token — invalida el anterior y emite uno nuevo.
   * Actualiza la MISMA sesión (no crea registro nuevo).
   */
  async rotate(sessionId: string, params: {
    userAgent?: string;
    ipAddress?: string;
  }): Promise<string> {
    const newOpaqueToken = this.token.generateOpaqueToken();
    const newHash        = this.token.hashToken(newOpaqueToken);
    const expirySeconds  = this.config.get<number>('JWT_REFRESH_EXPIRY', 28800);

    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        tokenHash:       newHash,
        expiresAt:       addSeconds(new Date(), expirySeconds),
        lastRefreshedAt: new Date(),
        ipAddress:       params.ipAddress ?? undefined,
        userAgent:       params.userAgent ?? undefined,
      },
    });

    return newOpaqueToken;
  }

  /**
   * Revoca una sesión específica por su hash (logout individual).
   */
  async revoke(opaqueToken: string): Promise<void> {
    const tokenHash = this.token.hashToken(opaqueToken);

    await this.prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data:  { revokedAt: new Date() },
    });
  }

  /**
   * Revoca TODAS las sesiones activas de un usuario (logout total / admin).
   */
  async revokeAll(userId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data:  { revokedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Lista las sesiones activas de un usuario para mostrar en el perfil.
   */
  async findActiveByUser(userId: string) {
    return this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id:              true,
        userAgent:       true,
        ipAddress:       true,
        createdAt:       true,
        lastRefreshedAt: true,
        expiresAt:       true,
      },
      orderBy: { lastRefreshedAt: 'desc' },
    });
  }

  /**
   * Limpieza diaria de sesiones expiradas y revocadas antiguas.
   * Cron job — corre a las 3:00 AM todos los días.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredSessions(): Promise<void> {
    this.logger.log('🧹 Iniciando limpieza de sesiones expiradas...');

    const now           = new Date();
    const sevenDaysAgo  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const result = await this.prisma.session.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },                                      // Expiradas
          { revokedAt: { lt: sevenDaysAgo } },                             // Revocadas hace 7+ días
        ],
      },
    });

    this.logger.log(`✅ Limpieza completada: ${result.count} sesiones eliminadas`);
  }
}
