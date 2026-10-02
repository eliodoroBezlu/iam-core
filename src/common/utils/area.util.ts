import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface AreaDerivada {
  areaCodigo?:       string;
  area?:             string;
  superintendencia?: string;
}

/**
 * El área maestra es la fuente de verdad: a partir de su código se derivan el
 * nombre del área y la superintendencia denormalizados en el Trabajador.
 * Sin código, no deriva nada (el llamador decide los valores por defecto).
 */
export async function derivarDeArea(
  prisma: PrismaService,
  areaCodigo?: string,
): Promise<AreaDerivada> {
  if (!areaCodigo) return {};
  const area = await prisma.area.findUnique({ where: { codigo: areaCodigo } });
  if (!area) throw new BadRequestException(`Área '${areaCodigo}' no existe en el catálogo`);
  return { areaCodigo: area.codigo, area: area.nombre, superintendencia: area.superintendencia };
}
