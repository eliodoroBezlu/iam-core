import {
  Injectable, NotFoundException, ConflictException,
  BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService }  from '../../infrastructure/prisma/prisma.service';
import { AuditService }   from '../audit/audit.service';
import { SessionsService } from '../sessions/sessions.service';
import { UsersService }   from '../users/users.service';
import { AuditEvent }     from '../../common/enums/audit-event.enum';
import { CreateServiceDto }    from './dto/create-service.dto';
import { UpdateServiceDto }    from './dto/update-service.dto';
import { GrantServiceAccessDto, UpdateServiceRolesDto } from './dto/grant-access.dto';
import { UpdateUserDto, ChangePasswordDto } from '../users/dto/update-user.dto';
import { AssignUserToTrabajadorDto } from './dto/assign-user.dto';
import { UpdateTrabajadorDto } from './dto/update-trabajador.dto';
import { CreateTrabajadorDto } from './dto/create-trabajador.dto';
import { Role } from '../../common/enums/role.enum';
import { createHash, randomBytes }  from 'crypto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma:    PrismaService,
    private readonly audit:     AuditService,
    private readonly sessions:  SessionsService,
    private readonly users:     UsersService,
  ) {}

  // ────────────────────────────────────────────────────────────────
  // GESTIÓN DE USUARIOS
  // ────────────────────────────────────────────────────────────────

  async listUsers(params: any) {
    return this.users.findAll(params);
  }

  async getUser(userId: string) {
    return this.users.findById(userId);
  }

  async updateUser(userId: string, dto: UpdateUserDto, actorId: string) {
    const updated = await this.users.update(userId, dto);

    await this.audit.log({
      userId:   actorId,
      event:    AuditEvent.USER_UPDATED,
      metadata: { targetUserId: userId, changes: dto },
    });

    return updated;
  }

  async resetPassword(userId: string, dto: ChangePasswordDto, actorId: string) {
    await this.users.changePassword(userId, dto, true); // isAdmin = true → sin verificar password actual

    await this.audit.log({
      userId:   actorId,
      event:    AuditEvent.PASSWORD_CHANGED,
      metadata: { targetUserId: userId, byAdmin: true },
    });
  }

  async deactivateUser(userId: string, actorId: string) {
    await this.users.update(userId, { isActive: false });
    await this.sessions.revokeAll(userId);

    await this.audit.log({
      userId:   actorId,
      event:    AuditEvent.USER_DEACTIVATED,
      metadata: { targetUserId: userId },
    });
  }

  async activateUser(userId: string, actorId: string) {
    await this.users.update(userId, { isActive: true });

    await this.audit.log({
      userId:   actorId,
      event:    AuditEvent.USER_ACTIVATED,
      metadata: { targetUserId: userId },
    });
  }

  /**
   * Fuerza el logout de un usuario — revoca todas sus sesiones.
   */
  async forceLogout(userId: string, actorId: string): Promise<number> {
    const count = await this.sessions.revokeAll(userId);

    await this.audit.log({
      userId:   actorId,
      event:    AuditEvent.ALL_SESSIONS_REVOKED,
      metadata: { targetUserId: userId, sessionsRevoked: count },
    });

    return count;
  }

  async getUserSessions(userId: string) {
    return this.sessions.findActiveByUser(userId);
  }

  // ────────────────────────────────────────────────────────────────
  // REGISTRO DE SERVICIOS
  // ────────────────────────────────────────────────────────────────

  async createService(dto: CreateServiceDto) {
    const existing = await this.prisma.service.findUnique({
      where: { key: dto.key },
    });
    if (existing) throw new ConflictException(`El servicio '${dto.key}' ya está registrado`);

    return this.prisma.service.create({
      data: {
        key:         dto.key,
        displayName: dto.displayName,
        baseUrl:     dto.baseUrl,
        isActive:    dto.isActive ?? true,
      },
    });
  }

  async listServices() {
    return this.prisma.service.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async toggleService(serviceId: string, isActive: boolean) {
    return this.prisma.service.update({
      where: { id: serviceId },
      data:  { isActive },
    });
  }

  async updateService(serviceId: string, dto: UpdateServiceDto) {
    const svc = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!svc) throw new NotFoundException(`Servicio '${serviceId}' no encontrado`);

    return this.prisma.service.update({
      where: { id: serviceId },
      data: {
        displayName: dto.displayName ?? undefined,
        baseUrl:     dto.baseUrl     ?? undefined,
        isActive:    dto.isActive    ?? undefined,
      },
    });
  }

  async deleteService(serviceId: string) {
    const svc = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!svc) throw new NotFoundException(`Servicio '${serviceId}' no encontrado`);

    await this.prisma.service.delete({ where: { id: serviceId } });
    this.logger.log(`Servicio eliminado: ${svc.key} [${serviceId}]`);
  }

  // ────────────────────────────────────────────────────────────────
  // CONTROL DE ACCESO — Asignación de servicios a usuarios
  // ────────────────────────────────────────────────────────────────

  async grantAccess(
    userId:   string,
    dto:      GrantServiceAccessDto,
    actorId:  string,
  ) {
    const service = await this.prisma.service.findUnique({
      where: { key: dto.serviceKey },
    });
    if (!service) throw new NotFoundException(`Servicio '${dto.serviceKey}' no encontrado`);

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const existing = await this.prisma.userServiceAccess.findUnique({
      where: { userId_serviceId: { userId, serviceId: service.id } },
    });

    let access;
    if (existing) {
      // Si ya existe, re-activar y actualizar roles
      access = await this.prisma.userServiceAccess.update({
        where: { id: existing.id },
        data: {
          roles:      dto.roles,
          revokedAt:  null,
          expiresAt:  dto.expiresAt ? new Date(dto.expiresAt) : null,
          grantedById: actorId,
          grantedAt:  new Date(),
        },
      });
    } else {
      access = await this.prisma.userServiceAccess.create({
        data: {
          userId,
          serviceId:   service.id,
          roles:       dto.roles,
          grantedById: actorId,
          expiresAt:   dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
      });
    }

    await this.audit.log({
      userId:    actorId,
      event:     AuditEvent.SERVICE_ACCESS_GRANTED,
      serviceKey: dto.serviceKey,
      metadata:  { targetUserId: userId, roles: dto.roles },
    });

    return access;
  }

  async revokeAccess(userId: string, serviceKey: string, actorId: string) {
    const service = await this.prisma.service.findUnique({ where: { key: serviceKey } });
    if (!service) throw new NotFoundException(`Servicio '${serviceKey}' no encontrado`);

    const access = await this.prisma.userServiceAccess.findUnique({
      where: { userId_serviceId: { userId, serviceId: service.id } },
    });
    if (!access || access.revokedAt !== null) {
      throw new BadRequestException('El usuario no tiene acceso activo a este servicio');
    }

    await this.prisma.userServiceAccess.update({
      where: { id: access.id },
      data:  { revokedAt: new Date() },
    });

    await this.audit.log({
      userId:    actorId,
      event:     AuditEvent.SERVICE_ACCESS_REVOKED,
      serviceKey,
      metadata:  { targetUserId: userId },
    });
  }

  // ────────────────────────────────────────────────────────────────
  // TRABAJADORES
  // ────────────────────────────────────────────────────────────────

  async listTrabajadores(params: {
    search?:          string;
    superintendencia?: string;
    area?:            string;
    tieneAcceso?:     boolean;
    page?:            number;
    limit?:           number;
  }) {
    const { search, superintendencia, area, tieneAcceso } = params;
    const page  = Number(params.page  ?? 1);
    const limit = Number(params.limit ?? 50);
    const skip  = (page - 1) * limit;

    const where: Parameters<typeof this.prisma.trabajador.findMany>[0]['where'] = {
      activo: true,
      ...(superintendencia && { superintendencia: { contains: superintendencia, mode: 'insensitive' } }),
      ...(area             && { area:             { contains: area,             mode: 'insensitive' } }),
      ...(tieneAcceso !== undefined && { tieneAccesoSistema: tieneAcceso }),
      ...(search && {
        OR: [
          { nomina: { contains: search, mode: 'insensitive' } },
          { ci:     { contains: search, mode: 'insensitive' } },
          { puesto: { contains: search, mode: 'insensitive' } },
          { jde:    { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.trabajador.findMany({
        where,
        include: { user: { select: { id: true, username: true, fullName: true } } },
        orderBy: { nomina: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.trabajador.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async createTrabajador(dto: CreateTrabajadorDto, actorId: string) {
    const existing = await this.prisma.trabajador.findUnique({ where: { ci: dto.ci } });
    if (existing) throw new ConflictException(`Ya existe un trabajador con CI '${dto.ci}'`);

    const trabajador = await this.prisma.trabajador.create({
      data: {
        ci:               dto.ci,
        nomina:           dto.nomina,
        puesto:           dto.puesto,
        superintendencia: dto.superintendencia,
        area:             dto.area        ?? null,
        fechaIngreso:     dto.fechaIngreso ? new Date(dto.fechaIngreso) : null,
        jde:              dto.jde         ?? null,
        noBloque:         dto.noBloque    ?? null,
        noHabitacion:     dto.noHabitacion ?? null,
        residencia:       dto.residencia  ?? null,
        celular:          dto.celular     ?? null,
      },
    });

    await this.audit.log({
      userId:   actorId,
      event:    AuditEvent.USER_CREATED,
      metadata: { trabajadorId: trabajador.id, ci: trabajador.ci, nomina: trabajador.nomina },
    });

    return trabajador;
  }

  async updateTrabajador(id: string, dto: UpdateTrabajadorDto, actorId: string) {
    const t = await this.prisma.trabajador.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Trabajador no encontrado');

    const updated = await this.prisma.trabajador.update({
      where: { id },
      data: {
        nomina:           dto.nomina           ?? undefined,
        puesto:           dto.puesto           ?? undefined,
        superintendencia: dto.superintendencia  ?? undefined,
        area:             dto.area             ?? undefined,
        fechaIngreso:     dto.fechaIngreso     ? new Date(dto.fechaIngreso) : undefined,
        jde:              dto.jde              ?? undefined,
        noBloque:         dto.noBloque         ?? undefined,
        noHabitacion:     dto.noHabitacion     ?? undefined,
        residencia:       dto.residencia       ?? undefined,
        celular:          dto.celular          ?? undefined,
        activo:           dto.activo           ?? undefined,
      },
      include: { user: { select: { id: true, username: true, fullName: true } } },
    });

    await this.audit.log({
      userId:   actorId,
      event:    AuditEvent.USER_UPDATED,
      metadata: { trabajadorId: id, changes: dto },
    });

    return updated;
  }

  // ────────────────────────────────────────────────────────────────
  // ASIGNACIÓN DE USUARIO A TRABAJADOR
  // ────────────────────────────────────────────────────────────────

  async assignUserToTrabajador(
    trabajadorId: string,
    dto:          AssignUserToTrabajadorDto,
    actorId:      string,
  ) {
    const trabajador = await this.prisma.trabajador.findUnique({
      where: { id: trabajadorId },
    });
    if (!trabajador) throw new NotFoundException('Trabajador no encontrado');
    if (trabajador.userId) {
      throw new ConflictException('El trabajador ya tiene un usuario vinculado');
    }

    // Crear usuario IAM
    const newUser = await this.users.create({
      username: dto.username,
      password: dto.password,
      fullName: dto.fullName ?? trabajador.nomina,
      email:    dto.email,
      roles:    dto.roles ?? [Role.USER],
      isAdmin:  false,
    });

    // Vincular usuario a trabajador
    const updated = await this.prisma.trabajador.update({
      where: { id: trabajadorId },
      data:  { userId: newUser.id, tieneAccesoSistema: true },
      include: { user: { select: { id: true, username: true, fullName: true } } },
    });

    // Opcional: conceder acceso al servicio "forms"
    if (dto.grantFormsAccess !== false) {
      const service = await this.prisma.service.findUnique({ where: { key: 'forms' } });
      if (service) {
        const serviceRoles = (dto.roles ?? [Role.USER]).filter((r) => r !== Role.USER);
        await this.prisma.userServiceAccess.upsert({
          where:  { userId_serviceId: { userId: newUser.id, serviceId: service.id } },
          create: {
            userId:      newUser.id,
            serviceId:   service.id,
            roles:       serviceRoles.length > 0 ? serviceRoles : [Role.USER],
            grantedById: actorId,
          },
          update: {
            roles:     serviceRoles.length > 0 ? serviceRoles : [Role.USER],
            revokedAt: null,
          },
        });
      }
    }

    await this.audit.log({
      userId:   actorId,
      event:    AuditEvent.USER_CREATED,
      metadata: { trabajadorId, newUserId: newUser.id, username: newUser.username },
    });

    return { trabajador: updated, user: newUser };
  }

  async unlinkUserFromTrabajador(trabajadorId: string, actorId: string) {
    const trabajador = await this.prisma.trabajador.findUnique({
      where: { id: trabajadorId },
    });
    if (!trabajador) throw new NotFoundException('Trabajador no encontrado');
    if (!trabajador.userId) {
      throw new BadRequestException('El trabajador no tiene usuario vinculado');
    }

    await this.prisma.trabajador.update({
      where: { id: trabajadorId },
      data:  { userId: null, tieneAccesoSistema: false },
    });

    await this.audit.log({
      userId:   actorId,
      event:    AuditEvent.USER_UPDATED,
      metadata: { trabajadorId, unlinkedUserId: trabajador.userId, action: 'unlink_user' },
    });
  }

  async getUserAccesses(userId: string) {
    return this.prisma.userServiceAccess.findMany({
      where:   { userId, revokedAt: null },
      include: { service: { select: { key: true, displayName: true } } },
      orderBy: { grantedAt: 'desc' },
    });
  }

  // ────────────────────────────────────────────────────────────────
  // API KEYS — Para autenticación service-to-service
  // ────────────────────────────────────────────────────────────────

  async createApiKey(serviceKey: string, description?: string) {
    const service = await this.prisma.service.findUnique({ where: { key: serviceKey } });
    if (!service) throw new NotFoundException(`Servicio '${serviceKey}' no encontrado`);

    const rawKey = `iam_${randomBytes(32).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    await this.prisma.apiKey.create({
      data: {
        serviceId:   service.id,
        keyHash,
        description: description ?? null,
      },
    });

    // Solo se devuelve la key cruda una vez — nunca se puede recuperar
    return {
      apiKey:      rawKey,
      serviceKey,
      description,
      message: 'Guarda esta API Key en un lugar seguro. No se puede recuperar.',
    };
  }

  async revokeApiKey(apiKeyId: string, actorId: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id: apiKeyId } });
    if (!key) throw new NotFoundException('API Key no encontrada');

    await this.prisma.apiKey.update({
      where: { id: apiKeyId },
      data:  { revokedAt: new Date(), isActive: false },
    });

    await this.audit.log({
      userId:   actorId,
      event:    AuditEvent.API_KEY_REVOKED,
      metadata: { apiKeyId },
    });
  }

  async listApiKeys(serviceKey?: string) {
    const where: any = { revokedAt: null };
    if (serviceKey) {
      const service = await this.prisma.service.findUnique({ where: { key: serviceKey } });
      if (service) where.serviceId = service.id;
    }

    return this.prisma.apiKey.findMany({
      where,
      select: {
        id:          true,
        description: true,
        isActive:    true,
        createdAt:   true,
        lastUsedAt:  true,
        expiresAt:   true,
        service:     { select: { key: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ────────────────────────────────────────────────────────────────
  // AUDIT LOG
  // ────────────────────────────────────────────────────────────────

  async getAuditLogs(filters: any) {
    return this.prisma.auditLog.findMany({
      where: {
        ...(filters.userId    && { userId:     filters.userId }),
        ...(filters.event     && { event:      filters.event }),
        ...(filters.serviceKey && { serviceKey: filters.serviceKey }),
        ...(filters.from || filters.to ? {
          createdAt: {
            ...(filters.from && { gte: new Date(filters.from) }),
            ...(filters.to   && { lte: new Date(filters.to) }),
          },
        } : {}),
      },
      include: {
        user: { select: { id: true, username: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take:    filters.limit ?? 100,
      skip:    ((filters.page ?? 1) - 1) * (filters.limit ?? 100),
    });
  }
}
