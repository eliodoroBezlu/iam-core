import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global — disponible en todos los módulos sin importar explícitamente.
 * Solo importar PrismaModule en AppModule.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
