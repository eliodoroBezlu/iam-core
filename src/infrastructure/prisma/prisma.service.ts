import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('PostgreSQL conectado exitosamente');

    // Log de queries lentas en desarrollo
    if (process.env.NODE_ENV === 'development') {
      (this.$on as any)('warn', (e: any) => {
        this.logger.warn(`Prisma warn: ${e.message}`);
      });
    }

    (this.$on as any)('error', (e: any) => {
      this.logger.error(`Prisma error: ${e.message}`);
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('PostgreSQL desconectado');
  }

  /**
   * Limpia la BD en tests — nunca usar en producción
   */
  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('cleanDatabase no disponible en producción');
    }
    const tableNames = ['audit_logs', 'api_keys', 'user_service_access', 'sessions', 'users', 'services'];
    for (const tableName of tableNames) {
      await this.$executeRawUnsafe(`TRUNCATE TABLE "${tableName}" CASCADE;`);
    }
  }
}
