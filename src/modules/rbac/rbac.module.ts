import { Module } from '@nestjs/common';
import { RbacController } from './rbac.controller';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';

@Module({
  controllers: [RbacController],
  providers: [ApiKeyGuard],
})
export class RbacModule {}
