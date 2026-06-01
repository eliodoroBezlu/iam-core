import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  Query, UseGuards, HttpCode, HttpStatus, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService }   from './admin.service';
import { JwtGuard }       from '../../common/guards/jwt.guard';
import { RolesGuard }     from '../../common/guards/roles.guard';
import { Roles }          from '../../common/decorators/roles.decorator';
import { CurrentUser }    from '../../common/decorators/current-user.decorator';
import { Role }           from '../../common/enums/role.enum';
import { CreateUserDto }  from '../users/dto/create-user.dto';
import { UpdateUserDto, ChangePasswordDto }  from '../users/dto/update-user.dto';
import { CreateServiceDto }     from './dto/create-service.dto';
import { UpdateServiceDto }     from './dto/update-service.dto';
import { GrantServiceAccessDto } from './dto/grant-access.dto';
import { AssignUserToTrabajadorDto } from './dto/assign-user.dto';
import { UpdateTrabajadorDto } from './dto/update-trabajador.dto';
import { CreateTrabajadorDto } from './dto/create-trabajador.dto';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ────────────────────────────────────────────────────────────────
  // USUARIOS
  // ────────────────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'Lista todos los usuarios' })
  async listUsers(
    @Query('page')     page?: number,
    @Query('limit')    limit?: number,
    @Query('search')   search?: string,
    @Query('isActive') isActive?: boolean,
    @Query('role')     role?: string,
  ) {
    return this.adminService.listUsers({ page, limit, search, isActive, role });
  }

  @Get('users/:userId')
  @ApiOperation({ summary: 'Obtiene un usuario por ID' })
  async getUser(@Param('userId') userId: string) {
    return this.adminService.getUser(userId);
  }

  @Patch('users/:userId')
  @ApiOperation({ summary: 'Actualiza datos del usuario' })
  async updateUser(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.adminService.updateUser(userId, dto, actorId);
  }

  @Post('users/:userId/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desactiva un usuario y revoca todas sus sesiones' })
  async deactivateUser(
    @Param('userId') userId: string,
    @CurrentUser('id') actorId: string,
  ) {
    await this.adminService.deactivateUser(userId, actorId);
    return { message: 'Usuario desactivado y sesiones revocadas' };
  }

  @Post('users/:userId/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activa un usuario desactivado' })
  async activateUser(
    @Param('userId') userId: string,
    @CurrentUser('id') actorId: string,
  ) {
    await this.adminService.activateUser(userId, actorId);
    return { message: 'Usuario activado' };
  }

  @Post('users/:userId/logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fuerza el logout de un usuario (revoca todas sus sesiones)' })
  async forceLogout(
    @Param('userId') userId: string,
    @CurrentUser('id') actorId: string,
  ) {
    const count = await this.adminService.forceLogout(userId, actorId);
    return { message: `${count} sesiones revocadas` };
  }

  @Post('users/:userId/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resetea la contraseña de un usuario (admin)' })
  async resetPassword(
    @Param('userId') userId: string,
    @Body() dto: ChangePasswordDto,
    @CurrentUser('id') actorId: string,
  ) {
    await this.adminService.resetPassword(userId, dto, actorId);
    return { message: 'Contraseña actualizada' };
  }

  @Get('users/:userId/sessions')
  @ApiOperation({ summary: 'Lista las sesiones activas de un usuario' })
  async getUserSessions(@Param('userId') userId: string) {
    return this.adminService.getUserSessions(userId);
  }

  @Get('users/:userId/services')
  @ApiOperation({ summary: 'Lista los servicios accesibles de un usuario' })
  async getUserAccesses(@Param('userId') userId: string) {
    return this.adminService.getUserAccesses(userId);
  }

  // ────────────────────────────────────────────────────────────────
  // CONTROL DE ACCESO A SERVICIOS
  // ────────────────────────────────────────────────────────────────

  @Post('users/:userId/services')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Concede acceso a un servicio con roles específicos' })
  async grantAccess(
    @Param('userId') userId: string,
    @Body() dto: GrantServiceAccessDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.adminService.grantAccess(userId, dto, actorId);
  }

  @Delete('users/:userId/services/:serviceKey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoca el acceso de un usuario a un servicio' })
  async revokeAccess(
    @Param('userId') userId: string,
    @Param('serviceKey') serviceKey: string,
    @CurrentUser('id') actorId: string,
  ) {
    await this.adminService.revokeAccess(userId, serviceKey, actorId);
    return { message: 'Acceso revocado' };
  }

  // ────────────────────────────────────────────────────────────────
  // SERVICIOS REGISTRADOS
  // ────────────────────────────────────────────────────────────────

  @Get('services')
  @ApiOperation({ summary: 'Lista los servicios registrados en el IAM' })
  async listServices() {
    return this.adminService.listServices();
  }

  @Post('services')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registra un nuevo servicio en el IAM' })
  async createService(@Body() dto: CreateServiceDto) {
    return this.adminService.createService(dto);
  }

  @Patch('services/:serviceId/toggle')
  @ApiOperation({ summary: 'Activa o desactiva un servicio' })
  async toggleService(
    @Param('serviceId') serviceId: string,
    @Query('active') active: string,
  ) {
    return this.adminService.toggleService(serviceId, active === 'true');
  }

  @Patch('services/:serviceId')
  @ApiOperation({ summary: 'Actualiza datos de un servicio (displayName, baseUrl)' })
  async updateService(
    @Param('serviceId') serviceId: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.adminService.updateService(serviceId, dto);
  }

  @Delete('services/:serviceId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Elimina un servicio y revoca sus accesos' })
  async deleteService(@Param('serviceId') serviceId: string) {
    await this.adminService.deleteService(serviceId);
    return { message: 'Servicio eliminado' };
  }

  // ────────────────────────────────────────────────────────────────
  // API KEYS
  // ────────────────────────────────────────────────────────────────

  @Get('api-keys')
  @ApiOperation({ summary: 'Lista las API Keys activas' })
  async listApiKeys(@Query('serviceKey') serviceKey?: string) {
    return this.adminService.listApiKeys(serviceKey);
  }

  @Post('api-keys')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Genera una nueva API Key para un servicio' })
  async createApiKey(
    @Body('serviceKey') serviceKey: string,
    @Body('description') description?: string,
  ) {
    return this.adminService.createApiKey(serviceKey, description);
  }

  @Delete('api-keys/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoca una API Key' })
  async revokeApiKey(
    @Param('id') id: string,
    @CurrentUser('id') actorId: string,
  ) {
    await this.adminService.revokeApiKey(id, actorId);
    return { message: 'API Key revocada' };
  }

  // ────────────────────────────────────────────────────────────────
  // AUDIT LOG
  // ────────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────
  // TRABAJADORES
  // ────────────────────────────────────────────────────────────────

  @Get('trabajadores')
  @ApiOperation({ summary: 'Lista trabajadores con búsqueda y paginación' })
  async listTrabajadores(
    @Query('search')          search?:          string,
    @Query('superintendencia') superintendencia?: string,
    @Query('area')            area?:            string,
    @Query('tieneAcceso')     tieneAcceso?:     string,
    @Query('page')            page?:            number,
    @Query('limit')           limit?:           number,
  ) {
    return this.adminService.listTrabajadores({
      search,
      superintendencia,
      area,
      tieneAcceso: tieneAcceso === 'true' ? true : tieneAcceso === 'false' ? false : undefined,
      page,
      limit,
    });
  }

  @Post('trabajadores')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un nuevo trabajador' })
  async createTrabajador(
    @Body() dto: CreateTrabajadorDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.adminService.createTrabajador(dto, actorId);
  }

  @Patch('trabajadores/:trabajadorId')
  @ApiOperation({ summary: 'Actualiza datos de un trabajador' })
  async updateTrabajador(
    @Param('trabajadorId') trabajadorId: string,
    @Body() dto: UpdateTrabajadorDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.adminService.updateTrabajador(trabajadorId, dto, actorId);
  }

  @Post('trabajadores/:trabajadorId/assign-user')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un usuario IAM y lo vincula al trabajador' })
  async assignUserToTrabajador(
    @Param('trabajadorId') trabajadorId: string,
    @Body() dto: AssignUserToTrabajadorDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.adminService.assignUserToTrabajador(trabajadorId, dto, actorId);
  }

  @Delete('trabajadores/:trabajadorId/unlink-user')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desvincula el usuario IAM del trabajador (no elimina el usuario)' })
  async unlinkUserFromTrabajador(
    @Param('trabajadorId') trabajadorId: string,
    @CurrentUser('id') actorId: string,
  ) {
    await this.adminService.unlinkUserFromTrabajador(trabajadorId, actorId);
    return { message: 'Usuario desvinculado del trabajador' };
  }

  // ────────────────────────────────────────────────────────────────
  // AUDIT LOG
  // ────────────────────────────────────────────────────────────────

  @Get('audit-logs')
  @ApiOperation({ summary: 'Consulta el log de auditoría con filtros' })
  async getAuditLogs(
    @Query('userId')     userId?: string,
    @Query('event')      event?: string,
    @Query('serviceKey') serviceKey?: string,
    @Query('from')       from?: string,
    @Query('to')         to?: string,
    @Query('page')       page?: number,
    @Query('limit')      limit?: number,
  ) {
    return this.adminService.getAuditLogs({ userId, event, serviceKey, from, to, page, limit });
  }
}
