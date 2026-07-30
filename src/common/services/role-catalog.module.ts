import { Module } from '@nestjs/common';
import { RoleCatalogService } from './role-catalog.service';

/**
 * Provee el catálogo de roles a los módulos que escriben `User.roles` o
 * `UserServiceAccess.roles` (users, admin). PrismaModule es `@Global()`, así
 * que aquí no hace falta importarlo.
 */
@Module({
  providers: [RoleCatalogService],
  exports: [RoleCatalogService],
})
export class RoleCatalogModule {}
