import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

// Infrastructure
import { PrismaModule }   from './infrastructure/prisma/prisma.module';
import { TokenModule }    from './infrastructure/token/token.module';

// Modules
import { AuthModule }     from './modules/auth/auth.module';
import { UsersModule }    from './modules/users/users.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { TotpModule }     from './modules/totp/totp.module';
import { AuditModule }    from './modules/audit/audit.module';
import { AdminModule }    from './modules/admin/admin.module';
import { WebAuthnModule } from './modules/webauthn/webauthn.module';

// Common
import { JwtGuard }             from './common/guards/jwt.guard';
import { HttpExceptionFilter }  from './common/filters/http-exception.filter';
import { LoggingInterceptor }   from './common/interceptors/logging.interceptor';

// Configuración
import configuration from './config/configuration';

@Module({
  imports: [
    // Config — global, cacheado
    ConfigModule.forRoot({
      isGlobal:    true,
      cache:       true,
      load:        [configuration],
      envFilePath: ['.env', '.env.local'],
    }),

    // Scheduler para cron jobs (limpieza de sesiones)
    ScheduleModule.forRoot(),

    // Rate limiting — protección contra fuerza bruta y DDoS
    // Niveles: default (general), strict (login/auth sensibles)
    ThrottlerModule.forRoot([
      {
        name:  'default',
        ttl:   60_000,   // ventana 1 minuto
        limit: 120,      // 120 req/min por IP — uso normal
      },
      {
        name:  'strict',
        ttl:   300_000,  // ventana 5 minutos
        limit: 10,       // 10 req/5min por IP — endpoints de auth sensibles
      },
    ]),

    // Infrastructure — PrismaModule es @Global, no necesita re-importarse
    PrismaModule,
    TokenModule,

    // Módulos de negocio
    UsersModule,
    SessionsModule,
    TotpModule,
    AuditModule,
    AuthModule,
    AdminModule,
    WebAuthnModule,
  ],
  providers: [
    // JwtGuard global — protege todas las rutas excepto las marcadas con @Public()
    {
      provide:  APP_GUARD,
      useClass: JwtGuard,
    },

    // ThrottlerGuard global — rate limiting por IP en todas las rutas
    {
      provide:  APP_GUARD,
      useClass: ThrottlerGuard,
    },

    // Filtro de excepciones global — respuestas de error consistentes
    {
      provide:  APP_FILTER,
      useClass: HttpExceptionFilter,
    },

    // Interceptor de logging — registra método, ruta, status, latencia
    {
      provide:  APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
