import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OidcController }      from './oidc.controller';
import { OidcAdminController } from './oidc-admin.controller';
import { OidcService }   from './oidc.service';
import { ClientsService } from './clients.service';
import { TokenModule }    from '../../infrastructure/token/token.module';
import { SessionsModule } from '../sessions/sessions.module';
import { AuditModule }    from '../audit/audit.module';
import { UsersModule }    from '../users/users.module';
import { AuthModule }     from '../auth/auth.module';

@Module({
  imports: [
    ConfigModule,
    TokenModule,
    SessionsModule,
    AuditModule,
    UsersModule,
    AuthModule, // reusa AuthService.getUserServicesDetails
  ],
  controllers: [OidcController, OidcAdminController],
  providers:   [OidcService, ClientsService],
  exports:     [ClientsService],
})
export class OidcModule {}
