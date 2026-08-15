import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';

/**
 * Endpoint público de solo lectura del RBAC de un servicio.
 * Cada servicio (forms, sync-msc) descarga y cachea este mapa para computar
 * los permisos de sus usuarios desde los roles (fuente de verdad: el IAM).
 */
@ApiTags('rbac')
@Controller('rbac')
export class RbacController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Catálogo maestro de áreas activas.
   *
   * `superintendenciaId` es la clave estable con la que los servicios deben
   * emparejar. Antes solo se mandaba el nombre denormalizado y cada servicio
   * casaba por texto: como BackendForm guardaba «Mec. **Planta** Chancado…» y
   * el IAM manda «Mec. **Plta.** Chancado…», cada sincronización creaba una
   * superintendencia duplicada. El nombre se sigue enviando —es lo que se
   * muestra— pero no debe usarse para emparejar.
   */
  @Get('catalog/areas')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Catálogo maestro de áreas (para que los servicios lo sincronicen)' })
  async getAreasCatalog() {
    const areas = await this.prisma.area.findMany({
      where:   { activo: true },
      orderBy: { codigo: 'asc' },
      select:  {
        codigo:                  true,
        nombre:                  true,
        superintendencia:        true,
        superintendenciaId:      true,
        superintendenciaEntidad: { select: { id: true, nombre: true } },
      },
    });

    return {
      areas: areas.map((a) => ({
        codigo:           a.codigo,
        nombre:           a.nombre,
        // Se conserva por compatibilidad con los consumidores que ya lo leen.
        superintendencia: a.superintendencia,
        // La entidad maestra manda sobre el texto denormalizado del área.
        superintendenciaId:     a.superintendenciaEntidad?.id ?? a.superintendenciaId,
        superintendenciaNombre: a.superintendenciaEntidad?.nombre ?? a.superintendencia,
      })),
    };
  }

  @Get('services/:key/users')
  @Public()
  @UseGuards(ApiKeyGuard)
  @SkipThrottle()
  @ApiHeader({ name: 'X-Api-Key', required: true })
  @ApiOperation({
    summary:
      'Usuarios (con su Trabajador vinculado) que tienen un rol dado en un servicio — service-to-service',
  })
  async getServiceUsers(
    @Param('key') key: string,
    @Query('role') role?: string,
  ) {
    const service = await this.prisma.service.findUnique({ where: { key } });
    if (!service) {
      throw new NotFoundException(`Servicio '${key}' no encontrado`);
    }

    const now = new Date();
    const accesos = await this.prisma.userServiceAccess.findMany({
      where: {
        serviceId: service.id,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        // Nota: UserServiceAccess.roles guarda el rol sin prefijo de
        // servicio (ej. "supervisor", no "forms:supervisor") — confirmado
        // contra datos reales, aunque el comentario del schema sugiera lo
        // contrario.
        ...(role ? { roles: { has: role } } : {}),
      },
      include: { user: { include: { trabajador: true } } },
    });

    const users = accesos
      .filter((acceso) => acceso.user.isActive)
      .map((acceso) => ({
        userId: acceso.user.id,
        username: acceso.user.username,
        fullName: acceso.user.fullName,
        email: acceso.user.email,
        globalRoles: acceso.user.roles,
        serviceRoles: acceso.roles,
        trabajador: acceso.user.trabajador
          ? {
              ci: acceso.user.trabajador.ci,
              nomina: acceso.user.trabajador.nomina,
              puesto: acceso.user.trabajador.puesto,
              area: acceso.user.trabajador.area,
              areaCodigo: acceso.user.trabajador.areaCodigo,
              superintendencia: acceso.user.trabajador.superintendencia,
              activo: acceso.user.trabajador.activo,
              tieneAccesoSistema: acceso.user.trabajador.tieneAccesoSistema,
            }
          : null,
      }));

    return { users };
  }

  @Get('trabajadores')
  @Public()
  @UseGuards(ApiKeyGuard)
  @SkipThrottle()
  @ApiHeader({ name: 'X-Api-Key', required: true })
  @ApiOperation({
    summary:
      'Roster completo de trabajadores (tengan o no usuario/acceso al sistema) — service-to-service',
  })
  async getTrabajadores(@Query('activo') activo?: string) {
    const trabajadores = await this.prisma.trabajador.findMany({
      where: activo === undefined ? {} : { activo: activo !== 'false' },
      orderBy: { nomina: 'asc' },
      select: {
        ci: true,
        nomina: true,
        puesto: true,
        superintendencia: true,
        area: true,
        areaCodigo: true,
        jde: true,
        disciplina: true,
        esContratista: true,
        celular: true,
        residencia: true,
        noBloque: true,
        noHabitacion: true,
        fechaIngreso: true,
        tieneAccesoSistema: true,
        activo: true,
        user: { select: { username: true } },
      },
    });

    return {
      trabajadores: trabajadores.map((t) => ({
        ci: t.ci,
        nomina: t.nomina,
        puesto: t.puesto,
        superintendencia: t.superintendencia,
        area: t.area,
        areaCodigo: t.areaCodigo,
        jde: t.jde,
        disciplina: t.disciplina,
        esContratista: t.esContratista,
        celular: t.celular,
        residencia: t.residencia,
        noBloque: t.noBloque,
        noHabitacion: t.noHabitacion,
        fechaIngreso: t.fechaIngreso,
        tieneAccesoSistema: t.tieneAccesoSistema,
        activo: t.activo,
        username: t.user?.username ?? null,
      })),
    };
  }

  @Get(':serviceKey')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Mapa RBAC (roles, permisos, rol→permisos) de un servicio' })
  async getServiceRbac(@Param('serviceKey') serviceKey: string) {
    const svc = await this.prisma.service.findUnique({
      where:  { key: serviceKey },
      select: { key: true, availableRoles: true, permissionCatalog: true, rolePermissions: true },
    });
    if (!svc) throw new NotFoundException(`Servicio '${serviceKey}' no encontrado`);

    return {
      serviceKey:        svc.key,
      availableRoles:    svc.availableRoles,
      permissionCatalog: svc.permissionCatalog,
      rolePermissions:   svc.rolePermissions ?? {},
    };
  }
}
