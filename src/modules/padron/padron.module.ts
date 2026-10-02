import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { PadronController } from './padron.controller';
import { PadronService } from './padron.service';
import { ServicioEscribePadronGuard } from './servicio-escribe-padron.guard';

@Module({
  imports:     [AuditModule],
  controllers: [PadronController],
  providers:   [PadronService, ApiKeyGuard, ServicioEscribePadronGuard],
})
export class PadronModule {}
