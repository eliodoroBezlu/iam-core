import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditEvent } from '../../common/enums/audit-event.enum';

interface LogEventOptions {
  userId?:    string;
  event:      AuditEvent;
  serviceKey?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?:  Record<string, any>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra un evento de auditoría de forma asíncrona sin bloquear el request.
   * Si el log falla, se registra en el logger pero NO se propaga el error
   * (el log de auditoría nunca debe tumbar una operación de negocio).
   */
  async log(options: LogEventOptions): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId:     options.userId    ?? null,
          event:      options.event,
          serviceKey: options.serviceKey ?? null,
          ipAddress:  options.ipAddress  ?? null,
          userAgent:  options.userAgent  ?? null,
          metadata:   options.metadata   ?? null,
        },
      });
    } catch (error) {
      // Log de auditoría fallido — no propagar para no interrumpir el flujo
      this.logger.error(
        `Error registrando audit log [${options.event}]: ${error.message}`,
        { userId: options.userId, event: options.event },
      );
    }
  }

  /**
   * Consulta el log de auditoría con filtros — solo para admins.
   */
  async findAll(filters: {
    userId?:    string;
    event?:     AuditEvent;
    serviceKey?: string;
    from?:      Date;
    to?:        Date;
    page?:      number;
    limit?:     number;
  }) {
    const page  = filters.page  ?? 1;
    const limit = filters.limit ?? 50;
    const skip  = (page - 1) * limit;

    const where: any = {};
    if (filters.userId)     where.userId     = filters.userId;
    if (filters.event)      where.event      = filters.event;
    if (filters.serviceKey) where.serviceKey = filters.serviceKey;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = filters.from;
      if (filters.to)   where.createdAt.lte = filters.to;
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: { id: true, username: true, fullName: true },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
