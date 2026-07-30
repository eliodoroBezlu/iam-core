/**
 * Roles del sistema — COMPATIBLE con el Role enum del Forms Service (MongoDB)
 * Cualquier cambio aquí debe reflejarse en el forms service.
 */
export enum Role {
  USER           = 'user',
  ADMIN          = 'admin',
  MODERATOR      = 'moderator',
  SUPER_ADMIN    = 'super_admin',
  INSPECTOR      = 'inspector',      // legacy — unificado con TECNICO
  TECNICO        = 'tecnico',
  SUPERVISOR     = 'supervisor',
  SUPERINTENDENTE = 'superintendente',
  PLANIFICADOR   = 'planificador',
  CONTRATISTA    = 'contratista',
  /**
   * Visibilidad acotada: solo ve sus inspecciones, las plantillas de
   * Herramientas y Equipos asignadas a su rol (`rolesVisibles`) y los
   * reportes de esas plantillas. Puede llenar inspecciones, no crear la
   * estructura de un formulario.
   */
  INSPECTOR_ASIGNADO = 'inspector_asignado',
}
