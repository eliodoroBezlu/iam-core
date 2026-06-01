import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { Permission } from '../enums/permission.enum';
import { getPermissionsForRoles } from '../enums/role-permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Sin permisos');

    // Permisos desde roles + permisos directos del usuario
    const rolePerms   = getPermissionsForRoles(user.roles || []);
    const directPerms = user.permissions || [];
    const allPerms    = new Set([...rolePerms, ...directPerms]);

    const hasPermission = requiredPermissions.some((p) => allPerms.has(p));
    if (!hasPermission) {
      throw new ForbiddenException(
        `Requiere uno de los permisos: ${requiredPermissions.join(', ')}`,
      );
    }

    return true;
  }
}
