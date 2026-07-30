/**
 * Migración one-time: usuarios CON CUENTA de Sync-MSC → IAM Core.
 *
 * Fuente: sync-export.json (generado del dump de Sync con parse-dump.cjs).
 * Compatible con el modelo de "rol global único" (Fase 8):
 *   - User.roles = [rolGenérico]  (deriva el Rol numérico de Sync y los permisos)
 *   - UserServiceAccess(sync-msc) = gate de acceso + metadata { areas, disciplina }
 *   - Contratistas (rol 6): expiresAt = fechaExpiracion
 *
 * Password: Sync usa SHA-256(password + 'syncmsc-salt-v1'). Se importa con el
 * prefijo 'sync-sha256$' que el IAM reconoce y re-hashea a bcrypt en el 1er login.
 *
 * NO crea Trabajador (requiere ci, ausente en el dump); si ya existe uno con el
 * mismo jde y sin userId, lo vincula.
 *
 * Idempotente: re-ejecutar no pisa contraseñas ya migradas a bcrypt.
 *
 * Uso:
 *   node scripts/migrate-sync-from-dump.cjs [ruta-export.json] [--dry] [--no-areas]
 */
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const SKIP_AREAS = args.includes("--no-areas");
const EXPORT_PATH =
  args.find((a) => !a.startsWith("--")) || path.join(__dirname, "sync-export.json");

const LEGACY_PREFIX = "sync-sha256$";
const ROLE_SLUG = {
  1: "admin",
  2: "superintendente",
  3: "supervisor",
  4: "tecnico",
  5: "planificador",
  6: "contratista",
};

function log(...a) {
  console.log(...a);
}

async function uniqueUsername(base, email) {
  let username = base || "user";
  let n = 1;
  while (true) {
    const ex = await prisma.user.findFirst({
      where: { username, NOT: { email } },
      select: { id: true },
    });
    if (!ex) return username;
    username = `${base}_${++n}`;
  }
}

async function seedAreas(areas) {
  // Superintendencias únicas (por nombre)
  const nombres = [...new Set(areas.map((a) => a.superintendencia).filter(Boolean))];
  const supMap = {};
  for (const nombre of nombres) {
    if (DRY) {
      supMap[nombre] = "(dry)";
      continue;
    }
    const s = await prisma.superintendencia.upsert({
      where: { nombre },
      update: {},
      create: { nombre, activo: true },
    });
    supMap[nombre] = s.id;
  }
  log(`🏢 Superintendencias: ${nombres.length}`);

  for (const a of areas) {
    const superintendenciaId = a.superintendencia ? supMap[a.superintendencia] : null;
    if (DRY) continue;
    await prisma.area.upsert({
      where: { codigo: a.codigo },
      update: {
        nombre: a.nombre,
        superintendencia: a.superintendencia || "",
        activo: a.activo,
        superintendenciaId: superintendenciaId && superintendenciaId !== "(dry)" ? superintendenciaId : null,
      },
      create: {
        codigo: a.codigo,
        nombre: a.nombre,
        superintendencia: a.superintendencia || "",
        activo: a.activo,
        superintendenciaId: superintendenciaId && superintendenciaId !== "(dry)" ? superintendenciaId : null,
      },
    });
  }
  log(`🗺️  Áreas: ${areas.length}`);
}

async function main() {
  const data = JSON.parse(fs.readFileSync(EXPORT_PATH, "utf-8"));
  log(`📂 Export: ${EXPORT_PATH}${DRY ? "  [DRY-RUN]" : ""}`);
  log(`   áreas=${data.areas.length}  usuarios=${data.usuarios.length}`);

  const admin =
    (await prisma.user.findFirst({ where: { username: "admin" } })) ||
    (await prisma.user.findFirst({ where: { isAdmin: true } }));
  if (!admin) throw new Error("No hay usuario admin (corre el seed del IAM primero)");

  const syncService = await prisma.service.findUnique({ where: { key: "sync-msc" } });
  if (!syncService) throw new Error("Servicio sync-msc no existe (corre el seed primero)");

  if (!SKIP_AREAS) await seedAreas(data.areas);

  let creados = 0,
    actualizados = 0,
    vinculados = 0,
    accesos = 0;

  for (const u of data.usuarios) {
    const email = (u.email || "").toLowerCase().trim() || null;
    if (!email) {
      log(`⏭️  ${u.nombre}: sin email → omitido`);
      continue;
    }

    const base = email.split("@")[0].replace(/[^a-z0-9_.-]/gi, "").toLowerCase();
    const rolGenerico = ROLE_SLUG[u.rol] || "tecnico";
    const legacyHash = LEGACY_PREFIX + u.passwordHash;

    let user = await prisma.user.findFirst({ where: { email } });

    if (DRY) {
      log(
        `${user ? "≈" : "+"} ${email}  rol=${rolGenerico}  areas=[${u.areas.join(",")}]` +
          (u.rol === 6 ? `  exp=${u.fechaExpiracion || "—"}` : "")
      );
    } else if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { fullName: u.nombre, isActive: true, roles: [rolGenerico] },
      });
      actualizados++;
    } else {
      const username = await uniqueUsername(base, email);
      user = await prisma.user.create({
        data: {
          username,
          email,
          passwordHash: legacyHash,
          fullName: u.nombre,
          roles: [rolGenerico],
          isActive: true,
        },
      });
      creados++;
    }

    // Vincular Trabajador existente por jde (no crear: ci es requerido y no lo tenemos)
    if (!DRY && u.jde) {
      const trab = await prisma.trabajador.findFirst({
        where: { jde: u.jde, userId: null },
      });
      if (trab) {
        await prisma.trabajador.update({
          where: { id: trab.id },
          data: {
            userId: user.id,
            disciplina: u.disciplina || trab.disciplina,
            tieneAccesoSistema: true,
          },
        });
        vinculados++;
      }
    }

    // Acceso al servicio sync-msc (gate + metadata; expiresAt para contratistas)
    if (!DRY) {
      const metadata = { areas: u.areas || [], disciplina: u.disciplina || "GENERAL" };
      const expiresAt =
        u.rol === 6 && u.fechaExpiracion ? new Date(u.fechaExpiracion.replace(" ", "T")) : null;
      await prisma.userServiceAccess.upsert({
        where: { userId_serviceId: { userId: user.id, serviceId: syncService.id } },
        update: { metadata, expiresAt, revokedAt: null },
        create: {
          userId: user.id,
          serviceId: syncService.id,
          roles: [], // el rol es global (User.roles); aquí solo gate + metadata
          metadata,
          expiresAt,
          grantedById: admin.id,
        },
      });
      accesos++;
    }
  }

  log("──────────────────────────────────────");
  if (DRY) {
    log("DRY-RUN: no se escribió nada.");
  } else {
    log(`👤 Users creados:            ${creados}`);
    log(`🔄 Users actualizados:       ${actualizados}`);
    log(`🔗 Trabajadores vinculados:  ${vinculados}`);
    log(`🎟️  Accesos sync-msc:        ${accesos}`);
    log("🎉 Migración completada");
  }
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
