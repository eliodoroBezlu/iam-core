import {
  Injectable, Logger, BadRequestException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TokenService } from '../../infrastructure/token/token.service';
import { SessionsService } from '../sessions/sessions.service';
import { AuditService } from '../audit/audit.service';
import { UsersService, SafeUser } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { ClientsService } from './clients.service';
import { AuditEvent } from '../../common/enums/audit-event.enum';
import { verifyPkceS256 } from './pkce.util';
import { timingSafeEqual } from 'crypto';
import { addSeconds } from 'date-fns';
import { OAuthClient } from '@prisma/client';

export interface AuthorizeParams {
  responseType:        string;
  clientId:            string;
  redirectUri:         string;
  scope:               string;
  state?:              string;
  nonce?:              string;
  codeChallenge:       string;
  codeChallengeMethod: string;
}

export interface SsoContext {
  user:     SafeUser;
  authTime: number; // epoch segundos
}

export interface TokenResponse {
  access_token:  string;
  id_token?:     string;
  refresh_token: string;
  token_type:    'Bearer';
  expires_in:    number;
  scope:         string;
}

/** Error OAuth con shape estándar { error, error_description }. */
export class OAuthError extends Error {
  constructor(
    public readonly error: string,
    public readonly description: string,
    public readonly status = 400,
  ) {
    super(description);
  }
}

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly token:    TokenService,
    private readonly sessions: SessionsService,
    private readonly audit:    AuditService,
    private readonly users:    UsersService,
    private readonly auth:     AuthService,
    private readonly clients:  ClientsService,
    private readonly config:   ConfigService,
  ) {}

  private accessExpiry(): number {
    return Number(this.config.get('JWT_ACCESS_EXPIRY')) || 900;
  }

  private codeTtl(): number {
    return Number(this.config.get('OIDC_AUTH_CODE_TTL')) || 60;
  }

  // ────────────────────────────────────────────────────────────────
  // /authorize — validación + sesión SSO + emisión de código
  // ────────────────────────────────────────────────────────────────

  /**
   * Valida client_id + redirect_uri. Lanza BadRequest (sin redirigir) si no
   * son válidos — defensa contra open-redirect (nunca redirigir a un URI
   * no registrado).
   */
  async validateClientAndRedirect(clientId: string, redirectUri: string): Promise<OAuthClient> {
    const client = await this.clients.findByClientId(clientId);
    if (!client || !client.isActive) {
      throw new BadRequestException('client_id inválido o inactivo');
    }
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      throw new BadRequestException('redirect_uri no registrado para este client');
    }
    return client;
  }

  /** Valida el resto de parámetros del request a /authorize. */
  validateAuthorizeParams(params: AuthorizeParams, client: OAuthClient): void {
    if (params.responseType !== 'code') {
      throw new OAuthError('unsupported_response_type', 'Solo se soporta response_type=code');
    }
    if (params.codeChallengeMethod !== 'S256') {
      throw new OAuthError('invalid_request', 'code_challenge_method debe ser S256');
    }
    if (!params.codeChallenge) {
      throw new OAuthError('invalid_request', 'code_challenge es requerido (PKCE)');
    }
    const requested = (params.scope || '').split(/\s+/).filter(Boolean);
    if (!requested.includes('openid')) {
      throw new OAuthError('invalid_scope', 'El scope openid es obligatorio');
    }
    const notAllowed = requested.filter((s) => !client.allowedScopes.includes(s));
    if (notAllowed.length) {
      throw new OAuthError('invalid_scope', `Scopes no permitidos: ${notAllowed.join(', ')}`);
    }
  }

  /**
   * Resuelve el usuario de la sesión SSO del IAM a partir de las cookies.
   * Prioridad: access_token válido; si no, refresh_token (sesión válida).
   * Devuelve null si no hay sesión.
   */
  async resolveSsoContext(cookies: Record<string, string | undefined>): Promise<SsoContext | null> {
    const accessToken  = cookies['access_token'];
    const refreshToken = cookies['refresh_token'];

    if (accessToken) {
      try {
        const claims = this.token.verifyAccessToken(accessToken);
        const user   = await this.users.findById(claims.sub);
        if (user.isActive) {
          return { user, authTime: claims.iat };
        }
      } catch {
        // access token inválido/expirado → intentar refresh_token
      }
    }

    if (refreshToken) {
      try {
        const session = await this.sessions.findValidSession(refreshToken);
        const user    = await this.users.findById(session.userId);
        return { user, authTime: Math.floor(Date.now() / 1000) };
      } catch {
        // refresh inválido → no hay sesión
      }
    }

    return null;
  }

  /**
   * Emite un authorization code de un solo uso (TTL corto). Solo se almacena
   * su SHA-256.
   */
  async issueAuthorizationCode(
    client:   OAuthClient,
    sso:      SsoContext,
    params:   AuthorizeParams,
  ): Promise<string> {
    const code     = this.token.generateOpaqueToken();
    const codeHash = this.token.hashToken(code);

    await this.prisma.authorizationCode.create({
      data: {
        codeHash,
        clientId:            client.clientId,
        userId:              sso.user.id,
        redirectUri:         params.redirectUri,
        scope:               params.scope,
        codeChallenge:       params.codeChallenge,
        codeChallengeMethod: params.codeChallengeMethod,
        nonce:               params.nonce ?? null,
        authTime:            new Date(sso.authTime * 1000),
        expiresAt:           addSeconds(new Date(), this.codeTtl()),
      },
    });

    await this.audit.log({
      userId:    sso.user.id,
      event:     AuditEvent.OIDC_AUTHORIZE_ISSUED,
      serviceKey: client.clientId,
      metadata:  { clientId: client.clientId, scope: params.scope },
    });

    return code;
  }

  // ────────────────────────────────────────────────────────────────
  // /token — authorization_code
  // ────────────────────────────────────────────────────────────────

  async exchangeAuthorizationCode(input: {
    clientId?:     string;
    clientSecret?: string;
    code:          string;
    redirectUri:   string;
    codeVerifier?: string;
    userAgent?:    string;
    ip?:           string;
  }): Promise<TokenResponse> {
    if (!input.code || !input.redirectUri) {
      throw new OAuthError('invalid_request', 'code y redirect_uri son requeridos');
    }

    const codeHash = this.token.hashToken(input.code);
    const codeRow  = await this.prisma.authorizationCode.findUnique({
      where:   { codeHash },
      include: { oauthClient: true },
    });

    if (!codeRow) {
      throw new OAuthError('invalid_grant', 'Código inválido', 400);
    }

    // Autenticación del client (confidential: secret; público: solo PKCE)
    await this.authenticateClient(codeRow.oauthClient, input.clientId, input.clientSecret);

    // Detección de reuso — código ya consumido
    if (codeRow.consumedAt) {
      if (codeRow.sessionId) {
        await this.sessions.revokeById(codeRow.sessionId).catch(() => {});
      }
      await this.audit.log({
        userId:    codeRow.userId,
        event:     AuditEvent.OIDC_CODE_REUSE_DETECTED,
        serviceKey: codeRow.clientId,
        metadata:  { clientId: codeRow.clientId },
      });
      throw new OAuthError('invalid_grant', 'Código ya utilizado (reuso detectado)', 400);
    }

    // Expiración
    if (codeRow.expiresAt < new Date()) {
      throw new OAuthError('invalid_grant', 'Código expirado', 400);
    }

    // redirect_uri y client_id deben coincidir con los del /authorize
    if (codeRow.redirectUri !== input.redirectUri) {
      throw new OAuthError('invalid_grant', 'redirect_uri no coincide', 400);
    }

    // PKCE
    if (!input.codeVerifier || !verifyPkceS256(input.codeVerifier, codeRow.codeChallenge)) {
      throw new OAuthError('invalid_grant', 'PKCE code_verifier inválido', 400);
    }

    // Marcar consumido ATÓMICAMENTE (bloquea doble canje en carrera)
    const consumed = await this.prisma.authorizationCode.updateMany({
      where: { id: codeRow.id, consumedAt: null },
      data:  { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new OAuthError('invalid_grant', 'Código ya utilizado', 400);
    }

    // Emitir tokens
    const user     = await this.users.findById(codeRow.userId);
    const services = await this.servicesFor(user.id);
    const accessToken = this.token.signAccessToken({
      sub:      user.id,
      username: user.username,
      email:    user.email ?? undefined,
      roles:    user.roles,
      services,
      iss:      'iam-core',
      aud:      [],
    });

    const { token: refreshToken, sessionId } = await this.sessions.createWithId({
      userId:    user.id,
      userAgent: input.userAgent,
      ipAddress: input.ip,
    });

    // Guardar la sesión derivada en el code (para revocar si hay reuso)
    await this.prisma.authorizationCode.update({
      where: { id: codeRow.id },
      data:  { sessionId },
    });

    const scopes = codeRow.scope.split(/\s+/).filter(Boolean);
    let idToken: string | undefined;
    if (scopes.includes('openid')) {
      idToken = this.token.signIdToken({
        sub:      user.id,
        aud:      codeRow.clientId,
        email:    scopes.includes('email')   ? (user.email ?? undefined)    : undefined,
        name:     scopes.includes('profile') ? (user.fullName ?? undefined) : undefined,
        roles:    user.roles,
        services,
        nonce:    codeRow.nonce ?? undefined,
        authTime: Math.floor(codeRow.authTime.getTime() / 1000),
      });
    }

    await this.audit.log({
      userId:    user.id,
      event:     AuditEvent.OIDC_TOKEN_ISSUED,
      serviceKey: codeRow.clientId,
      ipAddress: input.ip,
      userAgent: input.userAgent,
      metadata:  { clientId: codeRow.clientId, scope: codeRow.scope },
    });

    return {
      access_token:  accessToken,
      id_token:      idToken,
      refresh_token: refreshToken,
      token_type:    'Bearer',
      expires_in:    this.accessExpiry(),
      scope:         codeRow.scope,
    };
  }

  // ────────────────────────────────────────────────────────────────
  // /token — refresh_token
  // ────────────────────────────────────────────────────────────────

  async refresh(input: {
    clientId?:     string;
    clientSecret?: string;
    refreshToken:  string;
    userAgent?:    string;
    ip?:           string;
  }): Promise<TokenResponse> {
    if (!input.refreshToken) {
      throw new OAuthError('invalid_request', 'refresh_token es requerido');
    }

    // Autenticar al client (si envía credenciales)
    if (input.clientId) {
      const client = await this.clients.findByClientId(input.clientId);
      if (!client) throw new OAuthError('invalid_client', 'client_id inválido', 401);
      await this.authenticateClient(client, input.clientId, input.clientSecret);
    }

    let session;
    try {
      session = await this.sessions.findValidSession(input.refreshToken);
    } catch {
      throw new OAuthError('invalid_grant', 'refresh_token inválido o expirado', 400);
    }

    const newRefresh = await this.sessions.rotate(session.id, {
      userAgent: input.userAgent,
      ipAddress: input.ip,
    });

    const user     = await this.users.findById(session.userId);
    const services = await this.servicesFor(user.id);
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
      event:     AuditEvent.OIDC_TOKEN_REFRESHED,
      ipAddress: input.ip,
      userAgent: input.userAgent,
    });

    return {
      access_token:  accessToken,
      refresh_token: newRefresh,
      token_type:    'Bearer',
      expires_in:    this.accessExpiry(),
      scope:         'openid',
    };
  }

  // ────────────────────────────────────────────────────────────────
  // /userinfo
  // ────────────────────────────────────────────────────────────────

  async getUserInfo(bearer: string | undefined): Promise<Record<string, unknown>> {
    if (!bearer) {
      throw new UnauthorizedException('Bearer token requerido');
    }
    const token = bearer.replace(/^Bearer\s+/i, '');
    let claims;
    try {
      claims = this.token.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('access token inválido');
    }

    const user = await this.users.findById(claims.sub);
    return {
      sub:                user.id,
      preferred_username: user.username,
      email:              user.email ?? undefined,
      name:               user.fullName ?? undefined,
      roles:              user.roles,
      services:           await this.servicesFor(user.id),
    };
  }

  // ────────────────────────────────────────────────────────────────
  // Discovery
  // ────────────────────────────────────────────────────────────────

  getDiscoveryDocument(): Record<string, unknown> {
    const issuer = this.config.get<string>('JWT_ISSUER', 'iam-core');
    const base   = (this.config.get<string>('IAM_CORE_PUBLIC_URL') || '').replace(/\/+$/, '');

    return {
      issuer,
      authorization_endpoint: `${base}/api/oidc/authorize`,
      token_endpoint:         `${base}/api/oidc/token`,
      userinfo_endpoint:      `${base}/api/oidc/userinfo`,
      end_session_endpoint:   `${base}/api/oidc/logout`,
      jwks_uri:               `${base}/api/auth/.well-known/jwks.json`,
      response_types_supported: ['code'],
      grant_types_supported:    ['authorization_code', 'refresh_token'],
      subject_types_supported:  ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      code_challenge_methods_supported:      ['S256'],
      scopes_supported:        ['openid', 'profile', 'email'],
      claims_supported:        ['sub', 'email', 'name', 'preferred_username', 'roles', 'services', 'nonce', 'auth_time'],
    };
  }

  // ────────────────────────────────────────────────────────────────
  // Logout (end_session)
  // ────────────────────────────────────────────────────────────────

  async resolveLogout(input: {
    idTokenHint?:          string;
    postLogoutRedirectUri?: string;
    refreshToken?:         string;
  }): Promise<{ redirectTo?: string }> {
    if (input.refreshToken) {
      await this.sessions.revoke(input.refreshToken).catch(() => {});
    }

    let redirectTo: string | undefined;
    if (input.postLogoutRedirectUri && input.idTokenHint) {
      // Validar que el post_logout_redirect_uri esté registrado para el client del hint
      const decoded = this.safeDecodeAud(input.idTokenHint);
      if (decoded) {
        const client = await this.clients.findByClientId(decoded);
        if (client && client.postLogoutRedirectUris.includes(input.postLogoutRedirectUri)) {
          redirectTo = input.postLogoutRedirectUri;
        }
      }
    }

    await this.audit.log({ event: AuditEvent.OIDC_LOGOUT });
    return { redirectTo };
  }

  // ────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────

  /** Lista de service keys del usuario (reusa AuthService.getUserServicesDetails). */
  private async servicesFor(userId: string): Promise<string[]> {
    const details = await this.auth.getUserServicesDetails(userId);
    return details.map((d) => d.serviceKey);
  }

  /** Autentica al client: confidential → compara secret; público → no requiere. */
  private async authenticateClient(
    client:       OAuthClient,
    clientId?:    string,
    clientSecret?: string,
  ): Promise<void> {
    if (clientId && clientId !== client.clientId) {
      throw new OAuthError('invalid_client', 'client_id no coincide', 401);
    }

    if (!client.isConfidential) return; // público — solo PKCE

    if (!clientSecret || !client.clientSecretHash) {
      throw new OAuthError('invalid_client', 'client_secret requerido', 401);
    }
    const provided = this.token.hashToken(clientSecret);
    const a = Buffer.from(provided);
    const b = Buffer.from(client.clientSecretHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new OAuthError('invalid_client', 'client_secret inválido', 401);
    }
  }

  private safeDecodeAud(idToken: string): string | null {
    try {
      const payload = JSON.parse(
        Buffer.from(idToken.split('.')[1], 'base64').toString('utf-8'),
      );
      return typeof payload.aud === 'string' ? payload.aud : null;
    } catch {
      return null;
    }
  }
}
