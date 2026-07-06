/**
 * Computa los permisos efectivos de un usuario en un servicio, a partir del
 * mapa rol→permisos del servicio (Service.rolePermissions) y los roles que el
 * usuario tiene en ese servicio (UserServiceAccess.roles).
 */
export function computeServicePermissions(
  rolePermissions: unknown,
  roles: string[],
): string[] {
  if (!rolePermissions || typeof rolePermissions !== 'object') return [];
  const map = rolePermissions as Record<string, unknown>;
  const set = new Set<string>();
  for (const role of roles) {
    const perms = map[role];
    if (Array.isArray(perms)) {
      for (const p of perms) if (typeof p === 'string') set.add(p);
    }
  }
  return Array.from(set);
}
