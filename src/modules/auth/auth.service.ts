import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService }   from '../../infrastructure/prisma/prisma.service';
import { TokenService }    from '../../infrastructure/token/token.service';
import { SessionsService } from '../sessions/sessions.service';
import { AuditService }    from '../audit/audit.service';
import { TotpService }     from '../totp/totp.service';
import { UsersService, SafeUser } from '../users/users.service';
import { AuditEvent }      from '../../common/enums/audit-event.enum';
import { getPermissionsForRoles } from '../../common/enums/role-permissions';

// ──────────────────────────────────────────────────────────────────
// Tipos de respuesta — compatible con el Forms Service existente
// ──────────────────────────────────────────────────────────────────

export interface UserResponse {
  id:               string;
  username:         string;
  email?:           string;
  fullName?:        string;
  roles:            string[];
  permissions:      string[];
  isTwoFactorEnabled: boolean;
  isAdmin:          boolean;
}

export interface LoginSuccess {
  accessToken:  string;
  refreshToken: string;
  user:         UserResponse;
}

export interface Login2FARequired {
  requires2FA: true;
  tempToken:   string;
  message:     string;
}

export type LoginResponse = LoginSuccess | Login2FARequired;

// ──────────────────────────────────────────────────────────────────

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma:    PrismaService,
    private readonly token:     TokenService,
    private readonly sessions:  SessionsService,
    private readonly audit:     AuditService,
    private readonly totp:      TotpService,
    private readonly users:     UsersService,
  ) {}

  // ────────────────────────────────────────────────────────────────
  // LOGIN — Primer factor
  // ────────────────────────────────────────────────────────────────

  async login(
    user:      SafeUser,
    userAgent: string,
    ip:        string,
  ): Promise<LoginResponse> {
    // Si tiene 2FA activo → devolver token temporal y esperar segundo factor
    const fullUser = await this.prisma.user.findUnique({
      where:  { id: user.id },
      select: { totpEnabled: true },
    });

    if (fullUser?.totpEnabled) {
      const tempToken = this.token.signTempToken(user.id);

      await this.audit.log({
        userId:    user.id,
        event:     AuditEvent.TOTP_SETUP_INITIATED,
        ipAddress: ip,
        userAgent,
        metadata:  { stage: '2fa_challenge' },
      });

      return {
        requires2FA: true,
        tempToken,
        message: 'Ingrese el código de autenticación de dos factores',
      };
    }

    return this.issueTokenPair(user, userAgent, ip);
  }

  // ────────────────────────────────────────────────────────────────
  // LOGIN 2FA — Segundo factor
  // ────────────────────────────────────────────────────────────────

  async verify2FA(
    tempToken: string,
    code:      string,
    userAgent: string,
    ip:        string,
  ): Promise<LoginSuccess> {
    // Verificar el token temporal
    let payload: { sub: string; type: string };
    try {
      payload = this.token.verifyTempToken(tempToken);
    } catch {
      throw new UnauthorizedException('Token temporal inválido o expirado');
    }

    if (payload.type !== '2fa_pending') {
      throw new UnauthorizedException('Token temporal inválido');
    }

    const userId = payload.sub;

    // Verificar el código TOTP
    const isValid = await this.totp.verify(userId, code);

    if (!isValid) {
      await this.audit.log({
        userId,
        event:     AuditEvent.TOTP_VERIFY_FAILED,
        ipAddress: ip,
        userAgent,
      });
      throw new UnauthorizedException('Código 2FA inválido');
    }

    await this.audit.log({
      userId,
      event:     AuditEvent.TOTP_VERIFY_SUCCESS,
      ipAddress: ip,
      userAgent,
    });

    const user = await this.users.findById(userId);
    return this.issueTokenPair(user, userAgent, ip);
  }

  // ────────────────────────────────────────────────────────────────
  // REFRESH — Rota el refresh token
  // ────────────────────────────────────────────────────────────────

  async refresh(
    opaqueRefreshToken: string,
    userAgent:          string,
    ip:                 string,
  ): Promise<LoginSuccess> {
    // findValidSession valida existencia, no revocada, no expirada, user activo
    const session = await this.sessions.findValidSession(opaqueRefreshToken);
    const user    = session.user as SafeUser;

    // Rotar refresh token — actualiza el hash en la misma sesión
    const newRefreshToken = await this.sessions.rotate(session.id, { userAgent, ipAddress: ip });

    // Obtener servicios accesibles del usuario
    const services = await this.getUserServices(user.id);

    // Generar nuevo access token
    const accessToken = this.token.signAccessToken({
      sub:      user.id,
      username: user.username,
      email:    user.email ?? undefined,
      roles:    user.roles,
      services,
      iss:      'iam-core',
      aud:      [],
    });

    await this.audit.log({
      userId:    user.id,
      event:     AuditEvent.TOKEN_REFRESHED,
      ipAddress: ip,
      userAgent,
      metadata:  { sessionId: session.id },
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: this.toUserResponse(user),
    };
  }

  // ────────────────────────────────────────────────────────────────
  // LOGOUT
  // ────────────────────────────────────────────────────────────────

  async logout(
    userId:       string,
    refreshToken: string,
    userAgent:    string,
    ip:           string,
  ): Promise<void> {
    await this.sessions.revoke(refreshToken);

    await this.audit.log({
      userId,
      event:     AuditEvent.LOGOUT,
      ipAddress: ip,
      userAgent,
    });
  }

  // ────────────────────────────────────────────────────────────────
  // CLAVE PÚBLICA — Para servicios hijos
  // ────────────────────────────────────────────────────────────────

  getPublicKey(): string {
    return this.token.getPublicKey();
  }

  // ────────────────────────────────────────────────────────────────
  // REGISTRO DE USUARIO — Solo admin puede crear usuarios
  // ────────────────────────────────────────────────────────────────

  async register(dto: any, actorId: string, ip: string, userAgent: string) {
    const user = await this.users.create(dto);

    await this.audit.log({
      userId:    actorId,
      event:     AuditEvent.USER_CREATED,
      ipAddress: ip,
      userAgent,
      metadata:  { createdUserId: user.id, username: user.username },
    });

    return user;
  }

  // ────────────────────────────────────────────────────────────────
  // Helpers privados
  // ────────────────────────────────────────────────────────────────

  /**
   * Emite el par de tokens y crea la sesión en BD.
   * Actualiza lastLoginAt del usuario.
   */
  private async issueTokenPair(
    user:      SafeUser,
    userAgent: string,
    ip:        string,
  ): Promise<LoginSuccess> {
    const services = await this.getUserServices(user.id);

    const accessToken = this.token.signAccessToken({
      sub:      user.id,
      username: user.username,
      email:    user.email ?? undefined,
      roles:    user.roles,
      services,
      iss:      'iam-core',
      aud:      [],
    });

    const refreshToken = await this.sessions.create({
      userId:    user.id,
      userAgent,
      ipAddress: ip,
    });

    // Actualizar lastLoginAt sin bloquear
    this.prisma.user
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .catch((e) => this.logger.error('Error actualizando lastLoginAt:', e.message));

    await this.audit.log({
      userId:    user.id,
      event:     AuditEvent.LOGIN_SUCCESS,
      ipAddress: ip,
      userAgent,
    });

    return {
      accessToken,
      refreshToken,
      user: this.toUserResponse(user),
    };
  }

  /**
   * Obtiene los keys de servicios activos a los que el usuario tiene acceso
   * (usado internamente para el JWT payload).
   */
  private async getUserServices(userId: string): Promise<string[]> {
    const accesses = await this.prisma.userServiceAccess.findMany({
      where: {
        userId,
        revokedAt:  null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
        service: { isActive: true },
      },
      include: { service: { select: { key: true } } },
    });

    return accesses.map((a) => a.service.key);
  }

  /**
   * Obtiene los servicios accesibles con metadatos completos
   * (para el endpoint GET /auth/me del portal).
   */
  async getUserServicesDetails(userId: string): Promise<Array<{
    serviceKey:  string;
    displayName: string;
    baseUrl?:    string;
    roles:       string[];
  }>> {
    const accesses = await this.prisma.userServiceAccess.findMany({
      where: {
        userId,
        revokedAt:  null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
        service: { isActive: true },
      },
      include: {
        service: {
          select: { key: true, displayName: true, baseUrl: true },
        },
      },
    });

    return accesses.map((a) => ({
      serviceKey:  a.service.key,
      displayName: a.service.displayName,
      baseUrl:     a.service.baseUrl ?? undefined,
      roles:       a.roles,
    }));
  }

  /**
   * Construye la respuesta de usuario compatible con el Forms Service.
   * Incluye permisos computados desde roles.
   */
  private toUserResponse(user: SafeUser): UserResponse {
    const rolePermissions  = getPermissionsForRoles(user.roles);
    const directPermissions = user.permissions ?? [];
    const allPermissions   = Array.from(new Set([...rolePermissions, ...directPermissions]));

    return {
      id:                 user.id,
      username:           user.username,
      email:              user.email  ?? undefined,
      fullName:           user.fullName ?? undefined,
      roles:              user.roles,
      permissions:        allPermissions,
      isTwoFactorEnabled: user.totpEnabled,
      isAdmin:            user.isAdmin,
    };
  }
}
