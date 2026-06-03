import {
  Controller, Post, Get, Patch, Body, UseGuards,
  Req, Res, HttpCode, HttpStatus, UnauthorizedException,
  Delete,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { createPublicKey } from 'crypto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiCookieAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { AuthService, LoginSuccess, Login2FARequired }   from './auth.service';
import { TotpService }   from '../totp/totp.service';
import { SessionsService } from '../sessions/sessions.service';
import { UsersService }  from '../users/users.service';
import { JwtGuard }      from '../../common/guards/jwt.guard';
import { ApiKeyGuard }   from '../../common/guards/api-key.guard';
import { Public }        from '../../common/decorators/public.decorator';
import { CurrentUser }   from '../../common/decorators/current-user.decorator';
import { LoginDto }      from './dto/login.dto';
import { Verify2faDto }  from './dto/verify-2fa.dto';
import { Setup2faDto }   from './dto/setup-2fa.dto';
import { CreateUserDto }                    from '../users/dto/create-user.dto';
import { ChangePasswordDto }                from '../users/dto/update-user.dto';
import { Roles }         from '../../common/decorators/roles.decorator';
import { RolesGuard }    from '../../common/guards/roles.guard';
import { Role }          from '../../common/enums/role.enum';
import { getPermissionsForRoles } from '../../common/enums/role-permissions';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService:     AuthService,
    private readonly totpService:     TotpService,
    private readonly sessionsService: SessionsService,
    private readonly usersService:    UsersService,
  ) {}

  // ────────────────────────────────────────────────────────────────
  // REGISTRO — Solo admins
  // ────────────────────────────────────────────────────────────────

  @Post('register')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un nuevo usuario (solo admins)' })
  async register(
    @Body() dto: CreateUserDto,
    @CurrentUser('id') actorId: string,
    @Req() req: any,
  ) {
    const ip        = this.getIp(req);
    const userAgent = this.getUserAgent(req);
    return this.authService.register(dto, actorId, ip, userAgent);
  }

  // ────────────────────────────────────────────────────────────────
  // LOGIN — Primer factor
  // ────────────────────────────────────────────────────────────────

  @Post('login')
  @Public()
  @UseGuards(ApiKeyGuard, AuthGuard('local'))
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Login con username y contraseña (requiere X-Api-Key)' })
  async login(
    @CurrentUser() user: any,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip        = this.getIp(req);
    const userAgent = this.getUserAgent(req);

    const result = await this.authService.login(user, userAgent, ip);

    // Si requiere 2FA → no setear cookies todavía
    if ('requires2FA' in result && result.requires2FA) {
      return {
        requires2FA: true,
        tempToken:   result.tempToken,
        message:     result.message,
      };
    }

    const success = result as any;
    this.setTokenCookies(res, success.accessToken, success.refreshToken);
    return { user: success.user };
  }

  // ────────────────────────────────────────────────────────────────
  // VERIFY 2FA — Segundo factor
  // ────────────────────────────────────────────────────────────────

  @Post('login/2fa')
  @Public()
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Verificación del segundo factor TOTP (requiere X-Api-Key)' })
  async verify2FA(
    @Body() dto: Verify2faDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip        = this.getIp(req);
    const userAgent = this.getUserAgent(req);

    const result = await this.authService.verify2FA(
      dto.tempToken,
      dto.code,
      userAgent,
      ip,
    );

    this.setTokenCookies(res, result.accessToken, result.refreshToken);
    return { user: result.user };
  }

  // ────────────────────────────────────────────────────────────────
  // SERVICE LOGIN — Login servicio-a-servicio (sin contraseña)
  // ────────────────────────────────────────────────────────────────
  // Protegido por X-Api-Key. Permite a un servicio de confianza obtener
  // tokens de una cuenta de servicio en la allowlist (ej. inspector_tecnico)
  // sin conocer su contraseña. Restringido para que la API Key no pueda
  // impersonar usuarios reales/admins.

  @Post('service-login')
  @Public()
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login servicio-a-servicio para cuentas de servicio (requiere X-Api-Key)' })
  async serviceLogin(
    @Body() body: { username?: string },
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const username = (body.username ?? '').toLowerCase().trim();

    // Allowlist de cuentas de servicio permitidas (nunca usuarios reales)
    const allowed = (process.env.SERVICE_LOGIN_USERNAMES ??
      process.env.INSPECTOR_USERNAME ??
      'inspector_tecnico')
      .split(',')
      .map((u) => u.toLowerCase().trim());

    if (!username || !allowed.includes(username)) {
      throw new UnauthorizedException('Cuenta no permitida para service-login');
    }

    const ip        = this.getIp(req);
    const userAgent = this.getUserAgent(req);

    const result = await this.authService.serviceLogin(username, userAgent, ip);

    this.setTokenCookies(res, result.accessToken, result.refreshToken);
    return { user: result.user };
  }

  // ────────────────────────────────────────────────────────────────
  // REFRESH — Rota los tokens
  // ────────────────────────────────────────────────────────────────

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Rota el refresh token y emite nuevos tokens' })
  async refresh(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      throw new UnauthorizedException('No se encontró refresh token');
    }

    const ip        = this.getIp(req);
    const userAgent = this.getUserAgent(req);

    const result = await this.authService.refresh(refreshToken, userAgent, ip);

    this.setTokenCookies(res, result.accessToken, result.refreshToken);
    return { user: result.user };
  }

  // ────────────────────────────────────────────────────────────────
  // LOGOUT
  // ────────────────────────────────────────────────────────────────

  @Post('logout')
  @UseGuards(JwtGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cierra la sesión actual' })
  async logout(
    @CurrentUser('id') userId: string,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refresh_token;
    if (refreshToken) {
      await this.authService.logout(userId, refreshToken, this.getUserAgent(req), this.getIp(req));
    }

    this.clearTokenCookies(res);
    return { message: 'Sesión cerrada exitosamente' };
  }

  // ────────────────────────────────────────────────────────────────
  // ME — Perfil del usuario autenticado
  // ────────────────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Devuelve los datos del usuario autenticado' })
  async me(@CurrentUser() user: any) {
    const rolePermissions   = getPermissionsForRoles(user.roles ?? []);
    const directPermissions = user.permissions ?? [];
    const allPermissions    = Array.from(new Set([...rolePermissions, ...directPermissions]));

    // Recargar desde BD para obtener totpEnabled actualizado + servicios con metadatos
    const [fullUser, services] = await Promise.all([
      this.usersService.findById(user.id),
      this.authService.getUserServicesDetails(user.id),
    ]);

    return {
      id:          fullUser.id,
      username:    fullUser.username,
      email:       fullUser.email,
      fullName:    fullUser.fullName,
      avatarUrl:   fullUser.avatarUrl,
      roles:       fullUser.roles,
      permissions: allPermissions,
      totpEnabled: fullUser.totpEnabled,
      isActive:    fullUser.isActive,
      isAdmin:     fullUser.isAdmin,
      lastLoginAt: fullUser.lastLoginAt,
      services,
    };
  }

  // ────────────────────────────────────────────────────────────────
  // CHANGE PASSWORD — Usuario autenticado cambia su propia contraseña
  // ────────────────────────────────────────────────────────────────

  @Patch('me/password')
  @UseGuards(JwtGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambia la contraseña del usuario autenticado' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.usersService.changePassword(userId, dto, false);
    return { message: 'Contraseña actualizada exitosamente' };
  }

  // ────────────────────────────────────────────────────────────────
  // CLAVE PÚBLICA — Para servicios hijos
  // ────────────────────────────────────────────────────────────────

  @Get('public-key')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Devuelve la clave pública RSA para validar JWTs' })
  getPublicKey() {
    return {
      publicKey: this.authService.getPublicKey(),
      algorithm: 'RS256',
    };
  }

  @Get('.well-known/jwks.json')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Expone el JSON Web Key Set (JWKS) con la clave pública' })
  getJwks() {
    const pem = this.authService.getPublicKey();
    const keyObject = createPublicKey(pem);
    const jwk = keyObject.export({ format: 'jwk' });

    return {
      keys: [
        {
          kid: 'iam-key-v1',
          kty: jwk.kty,
          n: jwk.n,
          e: jwk.e,
          use: 'sig',
          alg: 'RS256',
        },
      ],
    };
  }

  // ────────────────────────────────────────────────────────────────
  // SESIONES ACTIVAS
  // ────────────────────────────────────────────────────────────────

  @Get('sessions')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Lista las sesiones activas del usuario' })
  async getSessions(@CurrentUser('id') userId: string) {
    return this.sessionsService.findActiveByUser(userId);
  }

  @Delete('sessions/all')
  @UseGuards(JwtGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoca todas las sesiones activas (logout total)' })
  async revokeAllSessions(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const count = await this.sessionsService.revokeAll(userId);
    this.clearTokenCookies(res);
    return { message: `${count} sesiones revocadas` };
  }

  // ────────────────────────────────────────────────────────────────
  // 2FA — Setup, Enable, Disable
  // ────────────────────────────────────────────────────────────────

  @Post('totp/setup')
  @UseGuards(JwtGuard)
  @Throttle({ strict: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Inicia la configuración de 2FA — genera QR' })
  async setup2FA(@CurrentUser('id') userId: string) {
    return this.totpService.initiateSetup(userId);
  }

  @Post('totp/enable')
  @UseGuards(JwtGuard)
  @Throttle({ strict: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Activa 2FA con el primer código válido' })
  async enable2FA(
    @CurrentUser('id') userId: string,
    @Body() dto: Setup2faDto,
  ) {
    return this.totpService.enable(userId, dto.code);
  }

  @Post('totp/disable')
  @UseGuards(JwtGuard)
  @Throttle({ strict: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Desactiva 2FA con código activo' })
  async disable2FA(
    @CurrentUser('id') userId: string,
    @Body() dto: Setup2faDto,
  ) {
    await this.totpService.disable(userId, dto.code);
    return { message: '2FA deshabilitado exitosamente' };
  }

  // ────────────────────────────────────────────────────────────────
  // Helpers privados
  // ────────────────────────────────────────────────────────────────

  private setTokenCookies(res: Response, accessToken: string, refreshToken: string) {
    const isProd = process.env.NODE_ENV === 'production';

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure:   isProd,
      sameSite: isProd ? 'strict' : 'lax',
      maxAge:   15 * 60 * 1000,      // 15 minutos
      path:     '/',
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure:   isProd,
      sameSite: isProd ? 'strict' : 'lax',
      maxAge:   8 * 60 * 60 * 1000,  // 8 horas
      path:     '/',                  // Accesible globalmente para que el proxy del portal lo reenvíe
    });
  }

  private clearTokenCookies(res: Response) {
    res.clearCookie('access_token',  { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
  }

  private getIp(req: any): string {
    return req.ip ?? req.connection?.remoteAddress ?? 'unknown';
  }

  private getUserAgent(req: any): string {
    return req.headers?.['user-agent'] ?? 'unknown';
  }

}
