import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request   = context.switchToHttp().getRequest();
    const { method, url } = request;
    const start     = Date.now();
    const userId    = request.user?.id ?? 'anon';

    return next.handle().pipe(
      tap({
        next: () => {
          const status  = context.switchToHttp().getResponse().statusCode;
          const elapsed = Date.now() - start;
          this.logger.log(`${method} ${url} ${status} ${elapsed}ms [user:${userId}]`);
        },
        error: () => {
          // Los errores los maneja HttpExceptionFilter
        },
      }),
    );
  }
}
