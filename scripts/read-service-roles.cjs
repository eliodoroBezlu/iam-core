/**
 * Inspección de solo lectura del RBAC por servicio.
 *
 * Uso: node scripts/read-service-roles.cjs [claveServicio]
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const filtro = process.argv[2];
  const svcs = await prisma.service.findMany({
    where: filtro ? { key: filtro } : undefined,
    select: {
      key: true,
      displayName: true,
      isActive: true,
      availableRoles: true,
      permissionCatalog: true,
      rolePermissions: true,
    },
    orderBy: { key: 'asc' },
  });

  if (svcs.length === 0) {
    console.log('No se encontró ningún servicio' + (filtro ? ` con key "${filtro}"` : ''));
    return;
  }

  for (const s of svcs) {
    console.log('='.repeat(70));
    console.log(`servicio: ${s.key}  —  ${s.displayName}  ${s.isActive ? '' : '(inactivo)'}`);
    console.log('  availableRoles   :', JSON.stringify(s.availableRoles));
    console.log('  permissionCatalog:', JSON.stringify(s.permissionCatalog));
    console.log('  rolePermissions  :');
    const rp = s.rolePermissions || {};
    for (const [rol, perms] of Object.entries(rp)) {
      console.log(`     ${rol.padEnd(22)} -> ${JSON.stringify(perms)}`);
    }
    if (Object.keys(rp).length === 0) console.log('     (vacío)');
  }
}

main()
  .catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
