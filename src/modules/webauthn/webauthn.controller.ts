import {
  Controller, Post, Get, Delete,
  Body, Param, Req, Res, HttpCode, HttpStatus,
  UseGuards, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { WebAuthnService } from './webauthn.service';
import { JwtGuard }        from '../../common/guards/jwt.guard';
import { CurrentUser }     from '../../common/decorators/current-user.decorator';
import { Public }          from '../../common/decorators/public.decorator';

@ApiTags('webauthn')
@Controller('auth/webauthn')
export class WebAuthnController {
  constructor(private readonly webAuthn: WebAuthnService) {}

  // ── Registration (requires JWT) ────────────────────────────────

  @Post('register/options')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Genera desafío de registro de passkey' })
  async registrationOptions(@CurrentUser('id') userId: string) {
    return this.webAuthn.getRegistrationOptions(userId);
  }

  @Post('register/verify')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Verifica y guarda la credencial WebAuthn' })
  async registrationVerify(
    @CurrentUser('id') userId: string,
    @Body('credential') credential: RegistrationResponseJSON,
    @Body('deviceName') deviceName: string | undefined,
    @Req() req: Request,
  ) {
    if (!credential) throw new BadRequestException('credential requerido');
    const ip  = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip;
    const ua  = req.headers['user-agent'];
    return this.webAuthn.verifyRegistration(userId, credential, deviceName, ip, ua);
  }

  // ── Authentication (public) ────────────────────────────────────

  @Post('auth/options')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Genera desafío de autenticación WebAuthn' })
  async authOptions(@Body('username') username?: string) {
    return this.webAuthn.getAuthenticationOptions(username);
  }

  @Post('auth/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ strict: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Verifica credencial y emite tokens' })
  async authVerify(
    @Body('sessionKey') sessionKey: string,
    @Body('credential') credential: AuthenticationResponseJSON,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!sessionKey)  throw new BadRequestException('sessionKey requerido');
    if (!credential)  throw new BadRequestException('credential requerido');
    const ip  = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip;
    const ua  = req.headers['user-agent'];
    const { accessToken, refreshToken } = await this.webAuthn.verifyAuthentication(sessionKey, credential, ip, ua);
    const isProd = process.env.NODE_ENV === 'production';
    const cookieOpts = {
      httpOnly: true,
      secure:   isProd,
      sameSite: (isProd ? 'strict' : 'lax') as 'strict' | 'lax',
      path:     '/',
    };
    res.cookie('access_token',  accessToken,  { ...cookieOpts, maxAge: 15 * 60 * 1000 });
    res.cookie('refresh_token', refreshToken, { ...cookieOpts, maxAge: 8  * 60 * 60 * 1000 });
    return { message: 'Autenticación exitosa' };
  }

  // ── Credential management (requires JWT) ─────────────────────

  @Get('credentials')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lista las credenciales WebAuthn del usuario' })
  async listCredentials(@CurrentUser('id') userId: string) {
    return this.webAuthn.listCredentials(userId);
  }

  @Delete('credentials/:credentialId')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Elimina una credencial WebAuthn' })
  async deleteCredential(
    @CurrentUser('id') userId: string,
    @Param('credentialId') credentialId: string,
  ) {
    await this.webAuthn.deleteCredential(userId, credentialId);
    return { message: 'Credencial eliminada' };
  }
}
