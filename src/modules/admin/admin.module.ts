import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService }    from './admin.service';
import { AuditModule }     from '../audit/audit.module';
import { SessionsModule }  from '../sessions/sessions.module';
import { UsersModule }     from '../users/users.module';
import { RoleCatalogModule } from '../../common/services/role-catalog.module';

@Module({
  imports:     [AuditModule, SessionsModule, UsersModule, RoleCatalogModule],
  controllers: [AdminController],
  providers:   [AdminService],
})
export class AdminModule {}
