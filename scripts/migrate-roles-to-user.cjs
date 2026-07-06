/**
 * Consolida el rol en User.roles (rol GLOBAL único).
 * Toma el rol de mayor autoridad entre User.roles y los UserServiceAccess.roles
 * del usuario, y lo fija como su rol global. Idempotente.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const GENERIC_ROLES = [
  "super_admin", "admin", "superintendente", "supervisor",
  "planificador", "tecnico", "contratista",
];
function highest(roles) {
  let best, bestIdx = Infinity;
  for (const r of roles) {
    const i = GENERIC_ROLES.indexOf(r);
    if (i !== -1 && i < bestIdx) { bestIdx = i; best = r; }
  }
  return best;
}

async function main() {
  const users = await prisma.user.findMany({
    include: { serviceAccess: { select: { roles: true } } },
  });
  let changed = 0;
  for (const u of users) {
    const all = [...u.roles, ...u.serviceAccess.flatMap((a) => a.roles)];
    const high = highest(all);
    if (high && !(u.roles.length === 1 && u.roles[0] === high)) {
      await prisma.user.update({ where: { id: u.id }, data: { roles: [high] } });
      changed++;
    }
  }
  console.log(`✅ Roles globales consolidados: ${changed} / ${users.length} usuarios`);
}

main().catch((e) => { console.error("❌", e); process.exit(1); }).finally(() => prisma.$disconnect());
