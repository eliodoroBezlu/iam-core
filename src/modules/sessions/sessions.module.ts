import { Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { TokenModule } from '../../infrastructure/token/token.module';

@Module({
  imports:   [TokenModule],
  providers: [SessionsService],
  exports:   [SessionsService],
})
export class SessionsModule {}
