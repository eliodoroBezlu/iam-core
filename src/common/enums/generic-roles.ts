/**
 * Catálogo ÚNICO de roles genéricos, compartido por todos los servicios.
 * El rol del usuario es global (User.roles) y aplica a todos los servicios
 * a los que tiene acceso. Lo que cambia por servicio son los PERMISOS
 * (Service.rolePermissions).
 *
 * Orden = jerarquía (índice menor = más autoridad), útil para elegir el rol
 * "más alto" al migrar/derivar.
 */
export const GENERIC_ROLES = [
  'super_admin',
  'admin',
  'superintendente',
  'supervisor',
  'planificador',
  'tecnico',
  'contratista',
  // El más acotado de todos: solo ve lo que se le asigna explícitamente.
  'inspector_asignado',
] as const;

export type GenericRole = (typeof GENERIC_ROLES)[number];

/** Devuelve el rol de mayor autoridad de una lista (o undefined). */
export function highestRole(roles: string[]): string | undefined {
  let best: string | undefined;
  let bestIdx = Infinity;
  for (const r of roles) {
    const idx = (GENERIC_ROLES as readonly string[]).indexOf(r);
    if (idx !== -1 && idx < bestIdx) { bestIdx = idx; best = r; }
  }
  return best;
}
