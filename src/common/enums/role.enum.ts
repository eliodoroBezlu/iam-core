/**
 * Roles del sistema — COMPATIBLE con el Role enum del Forms Service (MongoDB)
 * Cualquier cambio aquí debe reflejarse en el forms service.
 */
export enum Role {
  USER           = 'user',
  ADMIN          = 'admin',
  MODERATOR      = 'moderator',
  SUPER_ADMIN    = 'super_admin',
  INSPECTOR      = 'inspector',
  TECNICO        = 'tecnico',
  SUPERVISOR     = 'supervisor',
  SUPERINTENDENTE = 'superintendente',
}
