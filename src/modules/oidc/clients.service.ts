import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEvent } from '../../common/enums/audit-event.enum';
import { CreateOAuthClientDto } from './dto/create-oauth-client.dto';
import { UpdateOAuthClientDto } from './dto/update-oauth-client.dto';
import { randomBytes, createHash, randomUUID } from 'crypto';
import { OAuthClient } from '@prisma/client';

/** Vista segura — nunca expone el hash del secret. */
export type SafeOAuthClient = Omit<OAuthClient, 'clientSecretHash'> & {
  isConfidential: boolean;
};

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit:  AuditService,
  ) {}

  private hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  private toSafe(client: OAuthClient): SafeOAuthClient {
    const { clientSecretHash: _omit, ...safe } = client;
    void _omit;
    return safe;
  }

  /** Busca un client por su clientId público (uso interno del flujo OIDC). */
  async findByClientId(clientId: string): Promise<OAuthClient | null> {
    return this.prisma.oAuthClient.findUnique({ where: { clientId } });
  }

  async list(): Promise<SafeOAuthClient[]> {
    const clients = await this.prisma.oAuthClient.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return clients.map((c) => this.toSafe(c));
  }

  async create(dto: CreateOAuthClientDto, actorId: string): Promise<{
    client: SafeOAuthClient;
    clientSecret?: string;
    message: string;
  }> {
    const isConfidential = dto.isConfidential ?? true;

    // clientId legible y único
    const clientId = `${this.slug(dto.name)}_${randomBytes(4).toString('hex')}`;

    let clientSecret: string | undefined;
    let clientSecretHash: string | null = null;
    if (isConfidential) {
      clientSecret     = `oidc_${randomBytes(32).toString('hex')}`;
      clientSecretHash = this.hashSecret(clientSecret);
    }

    let serviceId: string | null = null;
    if (dto.serviceKey) {
      const service = await this.prisma.service.findUnique({ where: { key: dto.serviceKey } });
      serviceId = service?.id ?? null;
    }

    const client = await this.prisma.oAuthClient.create({
      data: {
        clientId,
        clientSecretHash,
        name:                   dto.name,
        redirectUris:           dto.redirectUris,
        postLogoutRedirectUris: dto.postLogoutRedirectUris ?? [],
        allowedScopes:          dto.allowedScopes ?? ['openid', 'profile', 'email'],
        isConfidential,
        serviceId,
      },
    });

    await this.audit.log({
      userId:   actorId,
      event:    AuditEvent.OAUTH_CLIENT_CREATED,
      metadata: { clientId, name: dto.name },
    });

    return {
      client: this.toSafe(client),
      clientSecret, // se devuelve UNA sola vez (solo confidential)
      message: isConfidential
        ? 'Guarda el client secret en un lugar seguro. No se puede recuperar.'
        : 'Client público creado (sin secret — solo PKCE).',
    };
  }

  async update(id: string, dto: UpdateOAuthClientDto, actorId: string): Promise<SafeOAuthClient> {
    await this.assertExists(id);

    const client = await this.prisma.oAuthClient.update({
      where: { id },
      data: {
        name:                   dto.name,
        redirectUris:           dto.redirectUris,
        postLogoutRedirectUris: dto.postLogoutRedirectUris,
        allowedScopes:          dto.allowedScopes,
        isActive:               dto.isActive,
      },
    });

    await this.audit.log({
      userId:   actorId,
      event:    AuditEvent.OAUTH_CLIENT_UPDATED,
      metadata: { clientId: client.clientId },
    });

    return this.toSafe(client);
  }

  async rotateSecret(id: string, actorId: string): Promise<{ clientSecret: string; message: string }> {
    const existing = await this.assertExists(id);

    const clientSecret = `oidc_${randomBytes(32).toString('hex')}`;
    await this.prisma.oAuthClient.update({
      where: { id },
      data:  { clientSecretHash: this.hashSecret(clientSecret), isConfidential: true },
    });

    await this.audit.log({
      userId:   actorId,
      event:    AuditEvent.OAUTH_CLIENT_SECRET_ROTATED,
      metadata: { clientId: existing.clientId },
    });

    return {
      clientSecret,
      message: 'Nuevo client secret generado. Guárdalo — no se puede recuperar.',
    };
  }

  async remove(id: string, actorId: string): Promise<void> {
    const existing = await this.assertExists(id);
    await this.prisma.oAuthClient.delete({ where: { id } });

    await this.audit.log({
      userId:   actorId,
      event:    AuditEvent.OAUTH_CLIENT_DELETED,
      metadata: { clientId: existing.clientId },
    });
  }

  private async assertExists(id: string): Promise<OAuthClient> {
    const client = await this.prisma.oAuthClient.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('OAuth client no encontrado');
    return client;
  }

  private slug(name: string): string {
    const base = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 24);
    return base || `client-${randomUUID().slice(0, 8)}`;
  }
}
