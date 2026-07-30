/**
 * Crea el rol `inspector_asignado` en el servicio `forms`.
 * ───────────────────────────────────────────────────────────────────────────
 * Rol de visibilidad acotada: solo ve *Mis Inspecciones*, las plantillas de
 * Herramientas y Equipos asignadas a su rol (`rolesVisibles` de la plantilla)
 * y los reportes de esas mismas plantillas.
 *
 * Puede **llenar** inspecciones. NO puede crear la estructura de un
 * formulario: eso está restringido a ADMIN por `@Roles()` en el controller de
 * plantillas, independientemente de este permiso.
 *
 * El set de permisos replica el de `tecnico` más `view:reports`, y omite
 * deliberadamente `update:form`, `delete:form`, `approve:form` y todo
 * `manage:*`.
 *
 * IDEMPOTENTE: se puede reejecutar; no duplica ni pisa otros roles.
 *
 * Uso:
 *   node scripts/create-role-inspector-asignado.cjs                  # simulacro
 *   node scripts/create-role-inspector-asignado.cjs --apply          # escribe
 *   node scripts/create-role-inspector-asignado.cjs --apply --assign juan.perez
 *                                                    # crea y asigna a un usuario
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SERVICE_KEY = 'forms';
const ROLE = 'inspector_asignado';

/**
 * Mismo set que `tecnico` + `view:reports`.
 *
 * `download:excel` / `download:pdf` se incluyen porque la vista de reportes
 * ofrece esos botones; sin los permisos, la UI mostraría acciones que
 * devuelven 403. Si se prefiere solo lectura, quitarlos de esta lista.
 */
const PERMISOS = [
  'read:worker',
  'create:form',
  'read:form',
  'view:reports',
  'download:excel',
  'download:pdf',
];

function parseArgs() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const iAssign = argv.indexOf('--assign');
  const assign = iAssign >= 0 ? argv[iAssign + 1] : null;
  const iBy = argv.indexOf('--granted-by');
  const grantedBy = iBy >= 0 ? argv[iBy + 1] : null;
  return { apply, assign, grantedBy };
}

async function main() {
  const { apply, assign, grantedBy } = parseArgs();

  const svc = await prisma.service.findUnique({ where: { key: SERVICE_KEY } });
  if (!svc) {
    throw new Error(`No existe el servicio con key "${SERVICE_KEY}".`);
  }

  console.log(`servicio: ${svc.key} — ${svc.displayName}`);
  console.log('─'.repeat(70));

  // ── 1. availableRoles ─────────────────────────────────────────────────
  const yaEnRoles = svc.availableRoles.includes(ROLE);
  const nuevosRoles = yaEnRoles
    ? svc.availableRoles
    : [...svc.availableRoles, ROLE];

  console.log(
    `availableRoles : ${yaEnRoles ? `ya contiene "${ROLE}"` : `+ "${ROLE}"`}`,
  );

  // ── 2. permissionCatalog ──────────────────────────────────────────────
  // Todo permiso del rol debe existir en el catálogo del servicio, o el
  // cálculo de permisos devolvería algo que el servicio no reconoce.
  const faltantes = PERMISOS.filter(
    (p) => !svc.permissionCatalog.includes(p),
  );
  if (faltantes.length > 0) {
    console.log(`permissionCatalog: + ${JSON.stringify(faltantes)}`);
  } else {
    console.log('permissionCatalog: sin cambios (todos ya existen)');
  }
  const nuevoCatalogo = [
    ...svc.permissionCatalog,
    ...faltantes,
  ];

  // ── 3. rolePermissions ────────────────────────────────────────────────
  const rp = { ...(svc.rolePermissions || {}) };
  const previo = rp[ROLE];
  const cambiaPermisos =
    !previo || JSON.stringify(previo) !== JSON.stringify(PERMISOS);

  if (previo) {
    console.log(`rolePermissions: "${ROLE}" ya existía -> ${JSON.stringify(previo)}`);
    if (cambiaPermisos) console.log(`                 se reemplaza por -> ${JSON.stringify(PERMISOS)}`);
  } else {
    console.log(`rolePermissions: + "${ROLE}" -> ${JSON.stringify(PERMISOS)}`);
  }
  rp[ROLE] = PERMISOS;

  const hayCambios = !yaEnRoles || faltantes.length > 0 || cambiaPermisos;

  if (!hayCambios) {
    console.log('\n✅ Nada que hacer: el rol ya está configurado igual.');
  } else if (apply) {
    await prisma.service.update({
      where: { id: svc.id },
      data: {
        availableRoles: nuevosRoles,
        permissionCatalog: nuevoCatalogo,
        rolePermissions: rp,
      },
    });
    console.log(`\n✅ Rol "${ROLE}" creado/actualizado en el servicio "${SERVICE_KEY}".`);
  } else {
    console.log('\nSimulacro: nada se escribió. Reejecutá con --apply.');
  }

  // ── 4. Asignación opcional a un usuario, para poder probar ────────────
  if (!assign) {
    console.log(
      `\nPara asignarlo a alguien:\n  node scripts/create-role-inspector-asignado.cjs --apply --assign <username>`,
    );
    return;
  }

  const user = await prisma.user.findUnique({ where: { username: assign } });
  if (!user) throw new Error(`No existe el usuario "${assign}".`);

  // `grantedById` es obligatorio en UserServiceAccess: se usa el admin
  // indicado, o el primer usuario con isAdmin como responsable del grant.
  let otorgante = null;
  if (grantedBy) {
    otorgante = await prisma.user.findUnique({ where: { username: grantedBy } });
    if (!otorgante) throw new Error(`No existe el usuario "${grantedBy}" (--granted-by).`);
  } else {
    otorgante = await prisma.user.findFirst({ where: { isAdmin: true } });
    if (!otorgante)
      throw new Error(
        'No hay ningún usuario con isAdmin=true para registrar como otorgante. Usá --granted-by <username>.',
      );
  }

  console.log('\n' + '─'.repeat(70));
  console.log(`asignar "${ROLE}" a ${user.username} (otorga: ${otorgante.username})`);

  /**
   * ⚠️ El rol vive en `User.roles` (GLOBAL), no en `UserServiceAccess.roles`.
   *
   * Así lo resuelve `auth.service.ts`: lee `User.roles` y calcula los permisos
   * por servicio con `computeServicePermissions(service.rolePermissions, userRoles)`.
   * El portal hace lo mismo (`adminApi.updateUser(id, { roles: [...] })`) y deja
   * `UserServiceAccess.roles` vacío. Escribir ahí no tendría ningún efecto.
   *
   * `UserServiceAccess` sí hace falta: concede el ACCESO al servicio.
   */

  // 1. Rol global
  if (user.roles.includes(ROLE)) {
    console.log(`  User.roles: ya lo tiene -> ${JSON.stringify(user.roles)}`);
  } else {
    // El portal asigna un rol único; se replica ese criterio para no dejar al
    // usuario con dos roles que la jerarquía del frontend colapsaría.
    const roles = [ROLE];
    console.log(`  User.roles: ${JSON.stringify(user.roles)} -> ${JSON.stringify(roles)}`);
    if (apply) {
      await prisma.user.update({ where: { id: user.id }, data: { roles } });
      console.log('  ✅ rol global actualizado');
    }
  }

  // 2. Acceso al servicio (sin roles: el rol ya es global)
  const acceso = await prisma.userServiceAccess.findFirst({
    where: { userId: user.id, serviceId: svc.id },
  });

  if (acceso) {
    const revocado = acceso.revokedAt !== null;
    console.log(
      `  acceso a "${SERVICE_KEY}": ya existe${revocado ? ' (revocado — se reactiva)' : ''}`,
    );
    if (apply && revocado) {
      await prisma.userServiceAccess.update({
        where: { id: acceso.id },
        data: { revokedAt: null },
      });
      console.log('  ✅ acceso reactivado');
    }
  } else {
    console.log(`  acceso a "${SERVICE_KEY}": no tenía; se crea`);
    if (apply) {
      await prisma.userServiceAccess.create({
        data: {
          userId: user.id,
          serviceId: svc.id,
          roles: [], // el rol es global, aquí va vacío (igual que el portal)
          grantedById: otorgante.id,
        },
      });
      console.log('  ✅ acceso creado');
    }
  }

  if (!apply) console.log('  (simulacro — nada se escribió)');
}

main()
  .catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
