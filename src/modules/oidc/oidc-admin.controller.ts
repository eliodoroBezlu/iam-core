import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { JwtGuard }    from '../../common/guards/jwt.guard';
import { RolesGuard }  from '../../common/guards/roles.guard';
import { Roles }       from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role }        from '../../common/enums/role.enum';
import { CreateOAuthClientDto } from './dto/create-oauth-client.dto';
import { UpdateOAuthClientDto } from './dto/update-oauth-client.dto';

@ApiTags('admin')
@Controller('admin/oauth-clients')
@UseGuards(JwtGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@ApiBearerAuth()
export class OidcAdminController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista los OAuth clients registrados' })
  list() {
    return this.clients.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un OAuth client (secret mostrado una sola vez)' })
  create(@Body() dto: CreateOAuthClientDto, @CurrentUser('id') actorId: string) {
    return this.clients.create(dto, actorId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualiza un OAuth client' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOAuthClientDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.clients.update(id, dto, actorId);
  }

  @Post(':id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rota el client secret (mostrado una sola vez)' })
  rotateSecret(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.clients.rotateSecret(id, actorId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Elimina un OAuth client' })
  async remove(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    await this.clients.remove(id, actorId);
    return { message: 'OAuth client eliminado' };
  }
}
