/**
 * Migración one-time: usuarios con cuenta de Sync-MSC → IAM (centralización).
 *
 * Lee el export generado desde Sync (sync-export.json) y:
 *  1. Pobla el catálogo Area del IAM.
 *  2. Por cada usuario con cuenta:
 *     - crea/actualiza el User (email + username; contraseña legacy de Sync,
 *       marcada 'sync-sha256$' — se re-hashea a bcrypt en el primer login),
 *     - vincula al Trabajador por jde (si existe) y setea su disciplina,
 *     - concede acceso al servicio sync-msc con rol 'sync-msc:<slug>' y
 *       metadata { areas, disciplina }.
 *
 * Idempotente: re-ejecutar no pisa contraseñas ya migradas a bcrypt.
 *
 * Uso:  node scripts/migrate-sync-users.cjs [ruta-export.json]
 */
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");

const prisma = new PrismaClient();

const EXPORT_PATH = process.argv[2] || "D:/tesisSanCristobal/sync-export.json";
const LEGACY_PREFIX = "sync-sha256$";
const ROLE_SLUG = {
  1: "admin",
  2: "superintendente",
  3: "supervisor",
  4: "tecnico",
  5: "planificador",
  6: "contratista",
};

async function uniqueUsername(base, email) {
  let username = base || "user";
  let n = 1;
  // Evitar colisión con un username ya usado por OTRO usuario (distinto email)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ex = await prisma.user.findFirst({
      where: { username, NOT: { email } },
      select: { id: true },
    });
    if (!ex) return username;
    username = `${base}_${++n}`;
  }
}

async function main() {
  const data = JSON.parse(fs.readFileSync(EXPORT_PATH, "utf-8"));

  const admin = await prisma.user.findFirst({ where: { username: "admin" } });
  if (!admin) throw new Error("Usuario admin no existe (corre el seed primero)");
  const syncService = await prisma.service.findUnique({ where: { key: "sync-msc" } });
  if (!syncService) throw new Error("Servicio sync-msc no existe (corre el seed primero)");

  // ── 1. Catálogo de áreas ──
  for (const a of data.areas) {
    await prisma.area.upsert({
      where: { codigo: a.codigo },
      update: { nombre: a.nombre, superintendencia: a.superintendencia, activo: a.activo },
      create: { codigo: a.codigo, nombre: a.nombre, superintendencia: a.superintendencia, activo: a.activo },
    });
  }
  console.log(`✅ Catálogo Area poblado: ${data.areas.length} áreas`);

  // ── 2. Usuarios ──
  let creados = 0,
    actualizados = 0,
    vinculados = 0,
    sinTrab = 0,
    saltados = 0;

  for (const u of data.usuarios) {
    const email = (u.email || "").toLowerCase().trim() || null;
    if (!email) {
      console.log(`⏭️  ${u.nombre}: sin email → omitido`);
      saltados++;
      continue;
    }

    const base = email.split("@")[0].replace(/[^a-z0-9_.-]/gi, "").toLowerCase();
    const username = await uniqueUsername(base, email);
    const legacyHash = LEGACY_PREFIX + u.passwordHash;

    let user = await prisma.user.findFirst({ where: { email } });
    if (user) {
      // No pisar passwordHash (puede ya estar migrado a bcrypt)
      user = await prisma.user.update({
        where: { id: user.id },
        data: { fullName: u.nombre, isActive: true },
      });
      actualizados++;
    } else {
      user = await prisma.user.create({
        data: {
          username,
          email,
          passwordHash: legacyHash,
          fullName: u.nombre,
          roles: ["user"],
          isActive: true,
        },
      });
      creados++;
    }

    // Vincular Trabajador por jde + disciplina
    let trab = null;
    if (u.jde) trab = await prisma.trabajador.findFirst({ where: { jde: u.jde } });
    if (trab) {
      await prisma.trabajador.update({
        where: { id: trab.id },
        data: { userId: user.id, disciplina: u.disciplina || null, tieneAccesoSistema: true },
      });
      vinculados++;
    } else {
      sinTrab++;
    }

    // Acceso al servicio sync-msc (rol + áreas + disciplina en metadata)
    const slug = ROLE_SLUG[u.rol] || "tecnico";
    const metadata = { areas: u.areas || [], disciplina: u.disciplina || "GENERAL" };
    await prisma.userServiceAccess.upsert({
      where: { userId_serviceId: { userId: user.id, serviceId: syncService.id } },
      update: { roles: [`sync-msc:${slug}`], metadata },
      create: {
        userId: user.id,
        serviceId: syncService.id,
        roles: [`sync-msc:${slug}`],
        metadata,
        grantedById: admin.id,
      },
    });
  }

  console.log("──────────────────────────────────────");
  console.log(`👤 Users creados:        ${creados}`);
  console.log(`🔄 Users actualizados:   ${actualizados}`);
  console.log(`🔗 Vinculados a Trabajador: ${vinculados}`);
  console.log(`⚠️  Sin Trabajador (solo cuenta): ${sinTrab}`);
  console.log(`⏭️  Omitidos (sin email): ${saltados}`);
  console.log("🎉 Migración completada");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
