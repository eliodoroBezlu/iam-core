/**
 * Normaliza UserServiceAccess.roles a roles genéricos (sin prefijo de servicio).
 * Ej. 'sync-msc:tecnico' → 'tecnico', 'forms:supervisor' → 'supervisor'.
 * Idempotente. Uso: node scripts/migrate-service-roles-generic.cjs
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const accesses = await prisma.userServiceAccess.findMany({ select: { id: true, roles: true } });
  let changed = 0;
  for (const a of accesses) {
    const generic = a.roles.map((r) => (r.includes(":") ? r.split(":").pop() : r));
    const isDifferent = generic.some((g, i) => g !== a.roles[i]);
    if (isDifferent) {
      await prisma.userServiceAccess.update({ where: { id: a.id }, data: { roles: generic } });
      changed++;
    }
  }
  console.log(`✅ Accesos normalizados a roles genéricos: ${changed} / ${accesses.length}`);
}

main().catch((e) => { console.error("❌", e); process.exit(1); }).finally(() => prisma.$disconnect());
