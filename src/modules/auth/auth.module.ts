import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthController }  from './auth.controller';
import { AuthService }     from './auth.service';
import { LocalStrategy }   from './strategies/local.strategy';
import { JwtStrategy }     from './strategies/jwt.strategy';
import { TokenModule }     from '../../infrastructure/token/token.module';
import { SessionsModule }  from '../sessions/sessions.module';
import { AuditModule }     from '../audit/audit.module';
import { TotpModule }      from '../totp/totp.module';
import { UsersModule }     from '../users/users.module';
import { ApiKeyGuard }     from '../../common/guards/api-key.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TokenModule,
    SessionsModule,
    AuditModule,
    TotpModule,
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    ApiKeyGuard,
  ],
  exports: [AuthService],
})
export class AuthModule {}
