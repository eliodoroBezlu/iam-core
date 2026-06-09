import {
  Controller, Get, Post, Req, Res, Body, Query, Headers,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { OidcService, OAuthError, AuthorizeParams } from './oidc.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('oidc')
@Controller()
export class OidcController {
  constructor(
    private readonly oidc:   OidcService,
    private readonly config: ConfigService,
  ) {}

  private getIp(req: Request): string {
    return req.ip ?? 'unknown';
  }
  private getUserAgent(req: Request): string {
    return (req.headers?.['user-agent'] as string) ?? 'unknown';
  }

  // ────────────────────────────────────────────────────────────────
  // Discovery
  // ────────────────────────────────────────────────────────────────
  @Get('.well-known/openid-configuration')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'OpenID Connect discovery document' })
  discovery() {
    return this.oidc.getDiscoveryDocument();
  }

  // ────────────────────────────────────────────────────────────────
  // /authorize
  // ────────────────────────────────────────────────────────────────
  @Get('oidc/authorize')
  @Public()
  @Throttle({ strict: { limit: 30, ttl: 300_000 } })
  @ApiOperation({ summary: 'OIDC Authorization endpoint (code + PKCE)' })
  async authorize(
    @Query('response_type')         responseType: string,
    @Query('client_id')             clientId: string,
    @Query('redirect_uri')          redirectUri: string,
    @Query('scope')                 scope: string,
    @Query('state')                 state: string,
    @Query('nonce')                 nonce: string,
    @Query('code_challenge')        codeChallenge: string,
    @Query('code_challenge_method') codeChallengeMethod: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const params: AuthorizeParams = {
      responseType, clientId, redirectUri, scope, state, nonce,
      codeChallenge,
      codeChallengeMethod: codeChallengeMethod || 'S256',
    };

    // 1. Validar client + redirect_uri (lanza 400 sin redirigir si inválidos)
    const client = await this.oidc.validateClientAndRedirect(clientId, redirectUri);

    // 2. Validar el resto de parámetros — si fallan, redirigir con error OAuth
    try {
      this.oidc.validateAuthorizeParams(params, client);
    } catch (err) {
      if (err instanceof OAuthError) {
        return this.redirectError(res, redirectUri, err, state);
      }
      throw err;
    }

    // 3. ¿Sesión SSO activa en el IAM?
    const sso = await this.oidc.resolveSsoContext(
      req.cookies as Record<string, string | undefined>,
    );

    if (!sso) {
      // No logueado → mandar al login del IAM Portal, que vuelve a /authorize
      const portal = (this.config.get<string>('IAM_PORTAL_URL') || '').replace(/\/+$/, '');
      const base   = (this.config.get<string>('IAM_CORE_PUBLIC_URL') || '').replace(/\/+$/, '');
      const selfUrl = `${base}/api/oidc/authorize?${this.originalQuery(params)}`;
      const loginUrl = `${portal}/login?redirect=${encodeURIComponent(selfUrl)}`;
      return res.redirect(loginUrl);
    }

    // 4. Emitir el código y redirigir al client
    const code = await this.oidc.issueAuthorizationCode(client, sso, params);
    const url  = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    return res.redirect(url.toString());
  }

  // ────────────────────────────────────────────────────────────────
  // /token
  // ────────────────────────────────────────────────────────────────
  @Post('oidc/token')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 30, ttl: 300_000 } })
  @ApiOperation({ summary: 'OIDC Token endpoint (authorization_code | refresh_token)' })
  async token(
    @Body() body: Record<string, string>,
    @Headers('authorization') authHeader: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Client auth por Basic header o por body
    const basic = this.parseBasicAuth(authHeader);
    const clientId     = body.client_id     ?? basic?.clientId;
    const clientSecret = body.client_secret ?? basic?.clientSecret;

    const ip        = this.getIp(req);
    const userAgent = this.getUserAgent(req);

    try {
      let result;
      if (body.grant_type === 'authorization_code') {
        result = await this.oidc.exchangeAuthorizationCode({
          clientId, clientSecret,
          code:         body.code,
          redirectUri:  body.redirect_uri,
          codeVerifier: body.code_verifier,
          userAgent, ip,
        });
      } else if (body.grant_type === 'refresh_token') {
        result = await this.oidc.refresh({
          clientId, clientSecret,
          refreshToken: body.refresh_token,
          userAgent, ip,
        });
      } else {
        throw new OAuthError('unsupported_grant_type', 'grant_type no soportado');
      }

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      return res.status(HttpStatus.OK).json(result);
    } catch (err) {
      if (err instanceof OAuthError) {
        return res.status(err.status).json({ error: err.error, error_description: err.description });
      }
      throw err;
    }
  }

  // ────────────────────────────────────────────────────────────────
  // /userinfo
  // ────────────────────────────────────────────────────────────────
  @Get('oidc/userinfo')
  @Public()
  @ApiOperation({ summary: 'OIDC UserInfo endpoint' })
  async userinfo(@Headers('authorization') authHeader: string) {
    return this.oidc.getUserInfo(authHeader);
  }

  // ────────────────────────────────────────────────────────────────
  // /logout (end_session)
  // ────────────────────────────────────────────────────────────────
  @Get('oidc/logout')
  @Public()
  @ApiOperation({ summary: 'OIDC RP-initiated logout (end_session)' })
  async logout(
    @Query('id_token_hint')            idTokenHint: string,
    @Query('post_logout_redirect_uri') postLogoutRedirectUri: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const cookies = req.cookies as Record<string, string | undefined>;
    const { redirectTo } = await this.oidc.resolveLogout({
      idTokenHint,
      postLogoutRedirectUri,
      refreshToken: cookies['refresh_token'],
    });

    // Limpiar cookies SSO del IAM (mismo dominio del IAM)
    const domain = process.env.COOKIE_DOMAIN || undefined;
    res.clearCookie('access_token',  { path: '/', domain });
    res.clearCookie('refresh_token', { path: '/', domain });

    if (redirectTo) return res.redirect(redirectTo);
    const portal = (this.config.get<string>('IAM_PORTAL_URL') || '').replace(/\/+$/, '');
    return res.redirect(portal ? `${portal}/login` : '/');
  }

  // ────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────

  private originalQuery(p: AuthorizeParams): string {
    const q = new URLSearchParams();
    q.set('response_type', p.responseType);
    q.set('client_id', p.clientId);
    q.set('redirect_uri', p.redirectUri);
    q.set('scope', p.scope);
    if (p.state) q.set('state', p.state);
    if (p.nonce) q.set('nonce', p.nonce);
    q.set('code_challenge', p.codeChallenge);
    q.set('code_challenge_method', p.codeChallengeMethod);
    return q.toString();
  }

  private redirectError(res: Response, redirectUri: string, err: OAuthError, state?: string) {
    const url = new URL(redirectUri);
    url.searchParams.set('error', err.error);
    url.searchParams.set('error_description', err.description);
    if (state) url.searchParams.set('state', state);
    return res.redirect(url.toString());
  }

  private parseBasicAuth(header?: string): { clientId: string; clientSecret: string } | null {
    if (!header || !header.toLowerCase().startsWith('basic ')) return null;
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
      const idx = decoded.indexOf(':');
      if (idx === -1) return null;
      return {
        clientId:     decodeURIComponent(decoded.slice(0, idx)),
        clientSecret: decodeURIComponent(decoded.slice(idx + 1)),
      };
    } catch {
      return null;
    }
  }
}
