/**
 * Permisos del sistema — COMPATIBLE con Permission enum del Forms Service
 * Estos permisos se computan en runtime desde los roles (no se guardan en el JWT).
 */
export enum Permission {
  // Trabajadores
  CREATE_WORKER     = 'create:worker',
  READ_WORKER       = 'read:worker',
  UPDATE_WORKER     = 'update:worker',
  DELETE_WORKER     = 'delete:worker',
  MANAGE_WORKER_USER = 'manage:worker_user',

  // Usuarios (General)
  READ_USER         = 'read:user',
  MANAGE_USERS      = 'manage:users',

  // Formularios / Inspecciones
  CREATE_FORM       = 'create:form',
  READ_FORM         = 'read:form',
  UPDATE_FORM       = 'update:form',
  DELETE_FORM       = 'delete:form',
  APPROVE_FORM      = 'approve:form',

  // Reportes
  VIEW_REPORTS      = 'view:reports',

  // Configuraciones
  MANAGE_SETTINGS   = 'manage:settings',

  // Plan de Acción
  MANAGE_ACTION_PLAN = 'manage:action_plan',

  // Exportación
  DOWNLOAD_EXCEL    = 'download:excel',
  DOWNLOAD_PDF      = 'download:pdf',

  // Formularios
  DOUBLE_FORM       = 'double:form',
}
