import {
  Injectable, NotFoundException, UnauthorizedException,
  BadRequestException, Logger,
} from '@nestjs/common';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { PrismaService }  from '../../infrastructure/prisma/prisma.service';
import { TokenService }   from '../../infrastructure/token/token.service';
import { SessionsService } from '../sessions/sessions.service';
import { AuditService }   from '../audit/audit.service';
import { AuditEvent }     from '../../common/enums/audit-event.enum';
import { ConfigService }  from '@nestjs/config';

const RP_NAME = 'IAM Portal San Cristóbal';

// ── In-memory challenge store (process-level, 5 min TTL) ─────────────
interface PendingChallenge {
  challenge: string;
  expiresAt: number;
}

@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger(WebAuthnService.name);
  private readonly rpId: string;
  private readonly rpOrigin: string;

  // userId → pending challenge
  private readonly regChallenges  = new Map<string, PendingChallenge>();
  // username → pending challenge (for login)
  private readonly authChallenges = new Map<string, PendingChallenge>();

  constructor(
    private readonly prisma:    PrismaService,
    private readonly token:     TokenService,
    private readonly sessions:  SessionsService,
    private readonly audit:     AuditService,
    private readonly config:    ConfigService,
  ) {
    this.rpId     = this.config.get<string>('WEBAUTHN_RP_ID', 'localhost');
    this.rpOrigin = this.config.get<string>('WEBAUTHN_ORIGIN', 'http://localhost:3005');
  }

  // ── Registration ──────────────────────────────────────────────────

  /**
   * Genera el desafío de registro WebAuthn para el usuario autenticado.
   */
  async getRegistrationOptions(userId: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const user = await this.prisma.user.findUnique({
      where:   { id: userId },
      include: { webAuthnCredentials: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const excludeCredentials = user.webAuthnCredentials.map((c) => ({
      id:         c.credentialId,
      transports: c.transports as AuthenticatorTransportFuture[],
    }));

    const options = await generateRegistrationOptions({
      rpName:                  RP_NAME,
      rpID:                    this.rpId,
      userName:                user.username,
      userDisplayName:         user.fullName ?? user.username,
      userID:                  new TextEncoder().encode(user.id),
      attestationType:         'none',
      excludeCredentials,
      authenticatorSelection:  {
        residentKey:       'preferred',
        userVerification:  'preferred',
      },
      supportedAlgorithmIDs: [-7, -257], // ES256, RS256
    });

    // Store challenge with 5-min TTL
    this.regChallenges.set(userId, {
      challenge: options.challenge,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    return options;
  }

  /**
   * Verifica la respuesta de registro y persiste la credencial.
   */
  async verifyRegistration(
    userId:      string,
    credential:  RegistrationResponseJSON,
    deviceName?: string,
    ipAddress?:  string,
    userAgent?:  string,
  ): Promise<{ credentialId: string; deviceName: string }> {
    const pending = this.regChallenges.get(userId);
    if (!pending || Date.now() > pending.expiresAt) {
      throw new BadRequestException('Desafío expirado. Inicia el proceso de registro nuevamente.');
    }
    this.regChallenges.delete(userId);

    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response:             credential,
        expectedChallenge:    pending.challenge,
        expectedOrigin:       this.rpOrigin,
        expectedRPID:         this.rpId,
        requireUserVerification: true,
      });
    } catch (err: unknown) {
      this.logger.warn(`WebAuthn registration verification failed: ${(err as Error).message}`);
      throw new BadRequestException('Verificación fallida. Inténtalo de nuevo.');
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException('Credencial WebAuthn inválida');
    }

    const { credential: cred, credentialDeviceType } = verification.registrationInfo;

    // Save to DB
    const saved = await this.prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: cred.id,
        publicKey:    Buffer.from(cred.publicKey),
        counter:      BigInt(cred.counter),
        deviceType:   credentialDeviceType,
        deviceName:   deviceName ?? 'Dispositivo',
        transports:   (credential.response.transports ?? []) as string[],
      },
    });

    await this.audit.log({
      userId,
      event:     AuditEvent.USER_UPDATED,
      ipAddress,
      userAgent,
      metadata:  { action: 'webauthn_credential_registered', credentialId: cred.id },
    });

    this.logger.log(`WebAuthn credential registered for user ${userId}`);
    return { credentialId: saved.credentialId, deviceName: saved.deviceName ?? 'Dispositivo' };
  }

  // ── Authentication ─────────────────────────────────────────────────

  /**
   * Genera el desafío de autenticación.
   * Si se pasa username, lo incluye como allowCredentials para autenticación por username.
   */
  async getAuthenticationOptions(username?: string): Promise<{
    options:    PublicKeyCredentialRequestOptionsJSON;
    sessionKey: string;
  }> {
    let allowCredentials: { id: string; transports: AuthenticatorTransportFuture[] }[] = [];

    if (username) {
      const user = await this.prisma.user.findUnique({
        where:   { username },
        include: { webAuthnCredentials: true },
      });
      if (!user || !user.isActive) {
        // Don't leak existence — return generic options
        allowCredentials = [];
      } else {
        allowCredentials = user.webAuthnCredentials.map((c) => ({
          id:         c.credentialId,
          transports: c.transports as AuthenticatorTransportFuture[],
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID:             this.rpId,
      allowCredentials,
      userVerification: 'preferred',
    });

    // Use username as key if provided, else 'passkey' (discoverable)
    const sessionKey = username ?? '__discoverable__';
    this.authChallenges.set(sessionKey, {
      challenge: options.challenge,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    return { options, sessionKey };
  }

  /**
   * Verifica la respuesta de autenticación y devuelve tokens si es válida.
   */
  async verifyAuthentication(
    sessionKey: string,
    credential: AuthenticationResponseJSON,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const pending = this.authChallenges.get(sessionKey);
    if (!pending || Date.now() > pending.expiresAt) {
      throw new UnauthorizedException('Desafío expirado. Inicia el proceso de nuevo.');
    }
    this.authChallenges.delete(sessionKey);

    // Find the credential in DB by credentialId
    const storedCred = await this.prisma.webAuthnCredential.findUnique({
      where:   { credentialId: credential.id },
      include: { user: true },
    });

    if (!storedCred) throw new UnauthorizedException('Credencial no encontrada');
    if (!storedCred.user.isActive) throw new UnauthorizedException('Usuario desactivado');

    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response:          credential,
        expectedChallenge: pending.challenge,
        expectedOrigin:    this.rpOrigin,
        expectedRPID:      this.rpId,
        credential: {
          id:         storedCred.credentialId,
          publicKey:  new Uint8Array(storedCred.publicKey),
          counter:    Number(storedCred.counter),
          transports: storedCred.transports as AuthenticatorTransportFuture[],
        },
        requireUserVerification: true,
      });
    } catch (err: unknown) {
      this.logger.warn(`WebAuthn auth verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Verificación biométrica fallida');
    }

    if (!verification.verified) throw new UnauthorizedException('Credencial WebAuthn inválida');

    // Update counter
    await this.prisma.webAuthnCredential.update({
      where: { id: storedCred.id },
      data:  {
        counter:    BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });

    // Issue tokens (same as regular login)
    const user = storedCred.user;
    const serviceAccesses = await this.prisma.userServiceAccess.findMany({
      where:   { userId: user.id, revokedAt: null },
      include: { service: { select: { key: true } } },
    });

    const accessToken = this.token.signAccessToken({
      sub:      user.id,
      username: user.username,
      email:    user.email ?? undefined,
      roles:    user.roles,
      services: serviceAccesses.map((a) => a.service.key),
      iss:      'iam-core',
      aud:      ['forms-service'],
    });

    const refreshToken = await this.sessions.create({
      userId:    user.id,
      userAgent,
      ipAddress,
    });

    // Update lastLoginAt
    await this.prisma.user.update({
      where: { id: user.id },
      data:  { lastLoginAt: new Date() },
    });

    await this.audit.log({
      userId:    user.id,
      event:     AuditEvent.LOGIN_SUCCESS,
      ipAddress,
      userAgent,
      metadata:  { method: 'webauthn', credentialId: credential.id },
    });

    return { accessToken, refreshToken };
  }

  // ── Credential management ─────────────────────────────────────────

  async listCredentials(userId: string) {
    return this.prisma.webAuthnCredential.findMany({
      where:   { userId },
      select:  {
        id:          true,
        credentialId: true,
        deviceType:  true,
        deviceName:  true,
        transports:  true,
        createdAt:   true,
        lastUsedAt:  true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async deleteCredential(userId: string, credentialId: string) {
    const cred = await this.prisma.webAuthnCredential.findFirst({
      where: { credentialId, userId },
    });
    if (!cred) throw new NotFoundException('Credencial no encontrada');

    await this.prisma.webAuthnCredential.delete({ where: { id: cred.id } });
    this.logger.log(`WebAuthn credential deleted: ${credentialId} for user ${userId}`);
  }
}
