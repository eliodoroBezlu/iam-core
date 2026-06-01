import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@prisma/client';

/**
 * Extrae el usuario autenticado del request.
 * Compatible con el decorator del Forms Service existente.
 *
 * Uso:
 *   @CurrentUser() user: User
 *   @CurrentUser('username') username: string
 *   @CurrentUser('roles') roles: string[]
 */
export const CurrentUser = createParamDecorator(
  (field: keyof User | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: User = request.user;

    if (!user) return null;
    if (field) return user[field];
    return user;
  },
);
