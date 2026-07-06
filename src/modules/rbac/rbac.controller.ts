import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Endpoint público de solo lectura del RBAC de un servicio.
 * Cada servicio (forms, sync-msc) descarga y cachea este mapa para computar
 * los permisos de sus usuarios desde los roles (fuente de verdad: el IAM).
 */
@ApiTags('rbac')
@Controller('rbac')
export class RbacController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('catalog/areas')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Catálogo maestro de áreas (para que los servicios lo sincronicen)' })
  async getAreasCatalog() {
    const areas = await this.prisma.area.findMany({
      where:   { activo: true },
      orderBy: { codigo: 'asc' },
      select:  { codigo: true, nombre: true, superintendencia: true },
    });
    return { areas };
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
