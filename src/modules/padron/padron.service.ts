/**
 * Padrón de trabajadores escrito por los servicios (service-to-service).
 *
 * El IAM es la fuente única de las personas. Los servicios que dan de alta
 * personal operativo (sync-msc: técnicos y contratistas de paradas) lo hacen
 * aquí en vez de en su propia base, y guardan solo una copia vinculada por id.
 *
 * Reglas:
 *  - Alta idempotente: si ya existe alguien con el mismo CI o JDE, se devuelve
 *    ese trabajador (creado: false) en lugar de duplicarlo.
 *  - Los servicios solo editan trabajadores SIN cuenta del IAM. Los que tienen
 *    cuenta se gestionan en el IAM Portal, igual que en la UI de los servicios.
 */
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEvent } from '../../common/enums/audit-event.enum';
import { derivarDeArea } from '../../common/utils/area.util';
import { CreateTrabajadorDto } from '../admin/dto/create-trabajador.dto';
import { UpdateTrabajadorDto } from '../admin/dto/update-trabajador.dto';
import { aTrabajadorPublico, INCLUDE_USUARIO, TrabajadorPublico } from './padron.mapper';

/** Quién pide el cambio: el servicio (por su API key) y, si lo informa, su usuario. */
export interface ContextoServicio {
  serviceKey: string;
  actor?: { id?: string; nombre?: string };
}

@Injectable()
export class PadronService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit:  AuditService,
  ) {}

  async crear(
    dto: CreateTrabajadorDto,
    ctx: ContextoServicio,
  ): Promise<{ trabajador: TrabajadorPublico; creado: boolean }> {
    const existente = await this.buscarExistente(dto);
    if (existente) return { trabajador: aTrabajadorPublico(existente), creado: false };

    const derived = await derivarDeArea(this.prisma, dto.areaCodigo);
    const t = await this.prisma.trabajador.create({
      data: {
        ci:               dto.ci ?? null,
        nomina:           dto.nomina,
        puesto:           dto.puesto,
        superintendencia: derived.superintendencia ?? dto.superintendencia ?? '',
        area:             derived.area ?? dto.area ?? null,
        areaCodigo:       derived.areaCodigo ?? null,
        disciplina:       dto.disciplina    ?? null,
        esContratista:    dto.esContratista ?? false,
        fechaIngreso:     dto.fechaIngreso ? new Date(dto.fechaIngreso) : null,
        jde:              dto.jde          ?? null,
        noBloque:         dto.noBloque     ?? null,
        noHabitacion:     dto.noHabitacion ?? null,
        residencia:       dto.residencia   ?? null,
        celular:          dto.celular      ?? null,
      },
      include: INCLUDE_USUARIO,
    });

    await this.auditar(AuditEvent.USER_CREATED, ctx, {
      accion: 'trabajador_creado_por_servicio', trabajadorId: t.id, nomina: t.nomina,
    });
    return { trabajador: aTrabajadorPublico(t), creado: true };
  }

  async actualizar(
    id: string,
    dto: UpdateTrabajadorDto,
    ctx: ContextoServicio,
  ): Promise<{ trabajador: TrabajadorPublico }> {
    const actual = await this.prisma.trabajador.findUnique({ where: { id } });
    if (!actual) throw new NotFoundException('Trabajador no encontrado');
    if (actual.userId) {
      throw new ConflictException(
        'Este trabajador tiene cuenta en el IAM: sus datos se gestionan en el IAM Portal.',
      );
    }

    const derived = await derivarDeArea(this.prisma, dto.areaCodigo);
    const t = await this.prisma.trabajador.update({
      where: { id },
      data: {
        nomina:           dto.nomina        ?? undefined,
        puesto:           dto.puesto        ?? undefined,
        superintendencia: derived.superintendencia ?? dto.superintendencia ?? undefined,
        area:             derived.area ?? dto.area ?? undefined,
        areaCodigo:       derived.areaCodigo ?? undefined,
        disciplina:       dto.disciplina    ?? undefined,
        esContratista:    dto.esContratista ?? undefined,
        fechaIngreso:     dto.fechaIngreso ? new Date(dto.fechaIngreso) : undefined,
        jde:              dto.jde           ?? undefined,
        noBloque:         dto.noBloque      ?? undefined,
        noHabitacion:     dto.noHabitacion  ?? undefined,
        residencia:       dto.residencia    ?? undefined,
        celular:          dto.celular       ?? undefined,
        activo:           dto.activo        ?? undefined,
      },
      include: INCLUDE_USUARIO,
    });

    await this.auditar(AuditEvent.USER_UPDATED, ctx, {
      accion: 'trabajador_actualizado_por_servicio', trabajadorId: id, cambios: { ...dto },
    });
    return { trabajador: aTrabajadorPublico(t) };
  }

  /** Mismo CI (único) o, si no hay CI, mismo JDE. Sin ninguno de los dos no se deduplica. */
  private async buscarExistente(dto: CreateTrabajadorDto) {
    if (dto.ci) {
      const porCi = await this.prisma.trabajador.findUnique({
        where: { ci: dto.ci }, include: INCLUDE_USUARIO,
      });
      if (porCi) return porCi;
    }
    if (dto.jde) {
      return this.prisma.trabajador.findFirst({
        where: { jde: dto.jde }, include: INCLUDE_USUARIO, orderBy: { createdAt: 'asc' },
      });
    }
    return null;
  }

  private async auditar(
    event: AuditEvent,
    ctx: ContextoServicio,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    // Solo se enlaza userId si el actor informado es un usuario real del IAM
    // (la FK fallaría con un id inventado).
    const actorId = ctx.actor?.id
      ? (await this.prisma.user.findUnique({ where: { id: ctx.actor.id }, select: { id: true } }))?.id
      : undefined;
    await this.audit.log({
      userId:     actorId,
      event,
      serviceKey: ctx.serviceKey,
      metadata:   { ...metadata, origen: ctx.serviceKey, actor: ctx.actor ?? null },
    });
  }
}
