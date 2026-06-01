import { Module }           from '@nestjs/common';
import { WebAuthnController } from './webauthn.controller';
import { WebAuthnService }    from './webauthn.service';
import { PrismaModule }       from '../../infrastructure/prisma/prisma.module';
import { TokenModule }        from '../../infrastructure/token/token.module';
import { SessionsModule }     from '../sessions/sessions.module';
import { AuditModule }        from '../audit/audit.module';

@Module({
  imports:     [PrismaModule, TokenModule, SessionsModule, AuditModule],
  controllers: [WebAuthnController],
  providers:   [WebAuthnService],
  exports:     [WebAuthnService],
})
export class WebAuthnModule {}
