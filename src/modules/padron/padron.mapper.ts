import type { Trabajador } from '@prisma/client';

/** Trabajador tal como se entrega a los servicios (forms, sync-msc). */
export interface TrabajadorPublico {
  id:                 string;
  ci:                 string | null;
  nomina:             string;
  puesto:             string;
  superintendencia:   string;
  area:               string | null;
  areaCodigo:         string | null;
  jde:                string | null;
  disciplina:         string | null;
  esContratista:      boolean;
  celular:            string | null;
  residencia:         string | null;
  noBloque:           string | null;
  noHabitacion:       string | null;
  fechaIngreso:       Date | null;
  tieneAccesoSistema: boolean;
  activo:             boolean;
  /** Cuenta del IAM vinculada, si la tiene (sus datos se gestionan en el portal). */
  userId:             string | null;
  username:           string | null;
}

export type TrabajadorConUsuario = Trabajador & { user: { username: string } | null };

/** `include` mínimo para poder mapear con `aTrabajadorPublico`. */
export const INCLUDE_USUARIO = { user: { select: { username: true } } } as const;

export function aTrabajadorPublico(t: TrabajadorConUsuario): TrabajadorPublico {
  return {
    id:                 t.id,
    ci:                 t.ci,
    nomina:             t.nomina,
    puesto:             t.puesto,
    superintendencia:   t.superintendencia,
    area:               t.area,
    areaCodigo:         t.areaCodigo,
    jde:                t.jde,
    disciplina:         t.disciplina,
    esContratista:      t.esContratista,
    celular:            t.celular,
    residencia:         t.residencia,
    noBloque:           t.noBloque,
    noHabitacion:       t.noHabitacion,
    fechaIngreso:       t.fechaIngreso,
    tieneAccesoSistema: t.tieneAccesoSistema,
    activo:             t.activo,
    userId:             t.userId,
    username:           t.user?.username ?? null,
  };
}
