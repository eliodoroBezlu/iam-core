import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Nombre admitido para un rol: minúsculas, dígitos, `_`, `-` y `:`.
 *
 * Se valida porque el nombre viaja en el JWT, en `User.roles` y en los enums
 * del forms service: un espacio o una mayúscula rompen la comparación en el
 * otro extremo sin dar ningún error visible.
 *
 * `-` y `:` están permitidos a propósito — `iro-service` ya tiene en producción
 * roles con prefijo (`iro-service:admin`) y un patrón más estricto impediría
 * guardar ese servicio desde la GUI.
 */
export const PATRON_NOMBRE_ROL = /^[a-z][a-z0-9_:-]{2,39}$/;

/**
 * Roles que asigna el propio IAM y que por tanto no dependen de ningún
 * servicio. `user` es el valor por defecto de `UsersService.create`, así que
 * tiene que ser siempre válido aunque ningún servicio lo declare.
 */
export const ROLES_SISTEMA = ['user'];

/**
 * Catálogo de roles asignables.
 *
 * La fuente de verdad es la unión de `Service.availableRoles` de todos los
 * servicios registrados: los roles se crean desde la GUI (pestaña *Roles y
 * Permisos*), no en un enum de TypeScript.
 *
 * Antes esto se validaba con `@IsEnum(Role)`, lo que obligaba a editar el enum,
 * recompilar y desplegar iam-core solo para poder asignar un rol que ya existía
 * en la base.
 */
@Injectable()
export class RoleCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Todos los roles asignables, de cualquier servicio, ordenados. */
  async listarRoles(): Promise<string[]> {
    const servicios = await this.prisma.service.findMany({
      select: { availableRoles: true },
    });
    const roles = new Set<string>(ROLES_SISTEMA);
    for (const s of servicios) for (const r of s.availableRoles) roles.add(r);
    return Array.from(roles).sort();
  }

  /** Roles declarados por un servicio concreto. */
  async listarRolesDeServicio(serviceKey: string): Promise<string[]> {
    const svc = await this.prisma.service.findUnique({
      where: { key: serviceKey },
      select: { availableRoles: true },
    });
    return svc?.availableRoles ?? [];
  }

  /**
   * 400 si se intenta **añadir** un rol que no está en el catálogo.
   *
   * `rolesActuales` son los que el usuario ya tiene: se aceptan aunque hayan
   * quedado fuera del catálogo (hay datos heredados como `inspector`, legacy de
   * la migración de Sync). Si no, editar el email de uno de esos usuarios
   * fallaría con un 400 sin forma de arreglarlo desde la GUI.
   */
  async assertRolesExisten(
    roles?: string[],
    rolesActuales: string[] = [],
  ): Promise<void> {
    if (!roles?.length) return;
    const conocidos = new Set(await this.listarRoles());
    const heredados = new Set(rolesActuales);

    const desconocidos = roles.filter(
      (r) => !conocidos.has(r) && !heredados.has(r),
    );
    if (desconocidos.length) {
      throw new BadRequestException(
        `Rol(es) inexistente(s): ${desconocidos.join(', ')}. ` +
          `Créalos primero en «Roles y Permisos». ` +
          `Disponibles: ${Array.from(conocidos).join(', ')}`,
      );
    }
  }

  /** 400 si alguno de los roles no lo ofrece ese servicio. */
  async assertRolesDeServicio(
    serviceKey: string,
    roles?: string[],
  ): Promise<void> {
    if (!roles?.length) return;
    const disponibles = await this.listarRolesDeServicio(serviceKey);
    const conocidos = new Set(disponibles);
    const desconocidos = roles.filter((r) => !conocidos.has(r));
    if (desconocidos.length) {
      throw new BadRequestException(
        `El servicio '${serviceKey}' no ofrece el/los rol(es): ${desconocidos.join(', ')}. ` +
          `Ofrece: ${disponibles.join(', ') || '(ninguno)'}`,
      );
    }
  }

  /**
   * Normaliza un catálogo de roles recibido de la GUI: recorta, pasa a
   * minúsculas, quita duplicados y valida el formato.
   */
  normalizarCatalogo(roles: string[]): string[] {
    const limpios = roles.map((r) => r.trim().toLowerCase()).filter(Boolean);

    const invalidos = limpios.filter((r) => !PATRON_NOMBRE_ROL.test(r));
    if (invalidos.length) {
      throw new BadRequestException(
        `Nombre de rol inválido: ${invalidos.join(', ')}. ` +
          `Usa minúsculas, dígitos y guion bajo, empezando por letra ` +
          `(3–40 caracteres). Ej: inspector_asignado`,
      );
    }

    return Array.from(new Set(limpios));
  }

  /**
   * 409 si el rol todavía está asignado a alguien. Evita que borrar una fila
   * de la matriz deje usuarios con un rol que ya no existe en ningún catálogo
   * —y que por tanto no se podría volver a asignar ni quitar desde la GUI.
   */
  async assertRolSinUso(rol: string): Promise<void> {
    const [usuarios, accesos] = await Promise.all([
      this.prisma.user.count({ where: { roles: { has: rol } } }),
      this.prisma.userServiceAccess.count({ where: { roles: { has: rol } } }),
    ]);

    if (usuarios > 0 || accesos > 0) {
      throw new BadRequestException(
        `No se puede eliminar el rol '${rol}': lo tienen ${usuarios} usuario(s) ` +
          `y ${accesos} acceso(s) a servicio. Quítaselo primero a esos usuarios.`,
      );
    }
  }
}
