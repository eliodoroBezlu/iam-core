import {
  Controller, Post, Patch, Body, Param, Req, Res, ParseUUIDPipe, UseGuards,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { CrearTrabajadorServicioDto } from './crear-trabajador-servicio.dto';
import { UpdateTrabajadorDto } from '../admin/dto/update-trabajador.dto';
import { PadronService, ContextoServicio } from './padron.service';
import { CompletarTrabajadorDto } from './completar-trabajador.dto';
import { ServicioEscribePadronGuard } from './servicio-escribe-padron.guard';

@ApiTags('padron')
@Controller('rbac/trabajadores')
@Public()
@UseGuards(ApiKeyGuard, ServicioEscribePadronGuard)
// Hay que nombrar TODOS los limitadores: `@SkipThrottle()` a secas solo exime de
// `default`, y `strict` (10 cada 5 min) seguiría aplicando por IP del servidor
// del servicio — una reconciliación de 30 altas se cortaba en la décima.
@SkipThrottle({ default: true, strict: true })
@ApiHeader({ name: 'X-Api-Key', required: true })
@ApiHeader({ name: 'X-Actor-Id', required: false, description: 'Usuario del IAM que origina la acción en el servicio' })
@ApiHeader({ name: 'X-Actor-Nombre', required: false })
export class PadronController {
  constructor(private readonly padron: PadronService) {}

  @Post()
  @ApiOperation({
    summary: 'Alta de trabajador desde un servicio (idempotente por CI/JDE) — service-to-service',
  })
  async crear(
    @Body() dto: CrearTrabajadorServicioDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.padron.crear(dto, this.contexto(req));
    res.status(resultado.creado ? 201 : 200);
    return resultado;
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edición de un trabajador SIN cuenta del IAM desde un servicio — service-to-service',
  })
  async actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTrabajadorDto,
    @Req() req: Request,
  ) {
    return this.padron.actualizar(id, dto, this.contexto(req));
  }

  @Post(':id/completar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rellena solo los campos vacíos de una ficha (con o sin cuenta) — service-to-service',
  })
  async completar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompletarTrabajadorDto,
    @Req() req: Request,
  ) {
    return this.padron.completar(id, dto, this.contexto(req));
  }

  /** Servicio (ya validado por los guards) y usuario que origina la acción, si lo informa. */
  private contexto(req: Request): ContextoServicio {
    const serviceKey = (req as Request & { apiKeyService?: string }).apiKeyService ?? '';
    const header = (n: string) => {
      const v = req.headers[n];
      return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
    };
    const id = header('x-actor-id');
    // Los headers HTTP son ASCII: el servicio envía el nombre con encodeURIComponent
    const nombreCrudo = header('x-actor-nombre');
    let nombre = nombreCrudo;
    try { nombre = nombreCrudo ? decodeURIComponent(nombreCrudo) : undefined; } catch { /* se deja tal cual */ }
    return { serviceKey, actor: id || nombre ? { id, nombre } : undefined };
  }
}
