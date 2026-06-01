import { Role } from './role.enum';
import { Permission } from './permission.enum';

/**
 * Mapa de permisos por rol — COMPATIBLE con el Forms Service existente.
 * Los permisos se computan en runtime, NO se incluyen en el JWT payload
 * para evitar el anti-patrón de permisos stale en tokens no revocados.
 */
export const RolePermissions: Record<Role, Permission[]> = {
  [Role.SUPER_ADMIN]: Object.values(Permission),

  [Role.ADMIN]: [
    Permission.CREATE_WORKER,
    Permission.READ_WORKER,
    Permission.UPDATE_WORKER,
    Permission.DELETE_WORKER,
    Permission.MANAGE_WORKER_USER,
    Permission.READ_USER,
    Permission.MANAGE_USERS,
    Permission.CREATE_FORM,
    Permission.READ_FORM,
    Permission.UPDATE_FORM,
    Permission.DELETE_FORM,
    Permission.APPROVE_FORM,
    Permission.VIEW_REPORTS,
    Permission.MANAGE_SETTINGS,
    Permission.MANAGE_ACTION_PLAN,
    Permission.DOWNLOAD_EXCEL,
    Permission.DOWNLOAD_PDF,
    Permission.DOUBLE_FORM,
  ],

  [Role.SUPERINTENDENTE]: [
    Permission.READ_WORKER,
    Permission.READ_FORM,
    Permission.VIEW_REPORTS,
    Permission.MANAGE_ACTION_PLAN,
    Permission.DOWNLOAD_EXCEL,
    Permission.DOWNLOAD_PDF,
  ],

  [Role.SUPERVISOR]: [
    Permission.READ_WORKER,
    Permission.CREATE_FORM,
    Permission.READ_FORM,
    Permission.APPROVE_FORM,
    Permission.VIEW_REPORTS,
    Permission.MANAGE_ACTION_PLAN,
    Permission.DOWNLOAD_EXCEL,
    Permission.DOWNLOAD_PDF,
  ],

  [Role.INSPECTOR]: [
    Permission.READ_WORKER,
    Permission.CREATE_FORM,
    Permission.READ_FORM,
  ],

  [Role.TECNICO]: [
    Permission.READ_WORKER,
    Permission.CREATE_FORM,
    Permission.READ_FORM,
    Permission.DOWNLOAD_EXCEL,
    Permission.DOWNLOAD_PDF,
  ],

  [Role.MODERATOR]: [
    Permission.READ_WORKER,
    Permission.READ_FORM,
    Permission.VIEW_REPORTS,
  ],

  [Role.USER]: [
    Permission.READ_WORKER,
    Permission.READ_FORM,
  ],
};

export function getPermissionsForRoles(roles: string[]): Permission[] {
  const permissionsSet = new Set<Permission>();
  for (const role of roles) {
    const rolePerms = RolePermissions[role as Role] || [];
    for (const perm of rolePerms) {
      permissionsSet.add(perm);
    }
  }
  return Array.from(permissionsSet);
}
