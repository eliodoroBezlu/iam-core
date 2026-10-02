/**
 * Invalida contraseñas comprometidas y obliga a elegir una nueva.
 *
 * Motivo: scripts/sync-export.json (emails + hashes SHA-256 con salt fija de
 * Sync) estuvo publicado en GitHub. Borrarlo del historial no lo saca de los
 * clones ni de las cachés, así que esas contraseñas se tratan como conocidas.
 *
 * Por cada cuenta de la lista:
 *   - reemplaza la contraseña por una temporal aleatoria (la filtrada deja de
 *     servir YA, no recién cuando el dueño entre),
 *   - marca mustChangePassword: al entrar con la temporal, el IAM le pide una
 *     propia antes de abrir sesión (y bloquea passkey y SSO mientras tanto),
 *   - cierra sus sesiones abiertas y registra el evento en la auditoría.
 *
 * Las temporales se escriben en scripts/salida/ (gitignored) para entregarlas
 * a cada persona por un canal privado. Borrar ese CSV después de entregarlas.
 *
 * Idempotente: salta las cuentas que ya tienen la marca, para que re-ejecutar
 * no invalide temporales ya entregadas. --incluir-marcadas las regenera.
 *
 * Uso (desde iam-core; la DB sale del .env de este proyecto):
 *   node scripts/forzar-cambio-clave.cjs [lista.json] [--dry] [--incluir-marcadas]
 *   lista.json: { afectados: [{ email, nombre }] }
 *               (por defecto scripts/salida/afectados-filtracion-sync-export.json)
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// La DB del IAM, aunque la terminal tenga exportada la de otro servicio.
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const INCLUIR_MARCADAS = args.includes("--incluir-marcadas");
const LISTA =
  args.find((a) => !a.startsWith("--")) ||
  path.join(__dirname, "salida", "afectados-filtracion-sync-export.json");
const SALIDA = path.join(__dirname, "salida");
const ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;

const prisma = new PrismaClient();

// Sin caracteres que se confunden al dictarla o copiarla (0/O, 1/l/I).
const MAYUS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MINUS = "abcdefghijkmnpqrstuvwxyz";
const DIGITOS = "23456789";
const ESPECIALES = "@$!%*?&"; // los que acepta ChangePasswordDto

function al(conjunto) {
  return conjunto[crypto.randomInt(conjunto.length)];
}

/** 12 caracteres con al menos uno de cada clase que exige el IAM. */
function claveTemporal() {
  const todos = MAYUS + MINUS + DIGITOS + ESPECIALES;
  const c = [al(MAYUS), al(MINUS), al(DIGITOS), al(ESPECIALES)];
  while (c.length < 12) c.push(al(todos));
  for (let i = c.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c.join("");
}

function csv(v) {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const { afectados } = JSON.parse(fs.readFileSync(LISTA, "utf8"));
  if (!Array.isArray(afectados) || afectados.length === 0) {
    throw new Error(`${LISTA} no trae una lista "afectados"`);
  }

  const host = (process.env.DATABASE_URL || "").replace(/\/\/[^@]*@/, "//***@");
  console.log(`${DRY ? "[DRY] " : ""}DB: ${host}`);
  console.log(`Lista: ${LISTA} (${afectados.length} cuentas)\n`);

  const filas = [];
  const sinCuenta = [];
  const yaMarcadas = [];
  let sesionesCerradas = 0;

  for (const { email, nombre } of afectados) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        id: true, username: true, email: true, fullName: true, isActive: true,
        mustChangePassword: true,
        _count: { select: { webAuthnCredentials: true } },
      },
    });
    if (!user) {
      sinCuenta.push(email);
      continue;
    }
    if (user.mustChangePassword && !INCLUIR_MARCADAS) {
      yaMarcadas.push(user.email);
      continue;
    }

    const clave = claveTemporal();
    if (!DRY) {
      const hash = await bcrypt.hash(clave, ROUNDS);
      const [, sesiones] = await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: {
            passwordHash: hash,
            mustChangePassword: true,
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        }),
        prisma.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: {
            userId: user.id,
            event: "PASSWORD_CHANGED",
            metadata: { motivo: "filtracion_sync_export", provisional: true, porScript: true },
          },
        }),
      ]);
      sesionesCerradas += sesiones.count;
    }

    filas.push({
      email: user.email,
      nombre: user.fullName || nombre,
      username: user.username,
      activo: user.isActive,
      passkeys: user._count.webAuthnCredentials,
      clave,
    });
  }

  console.log(`${DRY ? "Se invalidarían" : "Invalidadas"}: ${filas.length}`);
  if (!DRY) console.log(`Sesiones cerradas: ${sesionesCerradas}`);
  if (yaMarcadas.length) {
    console.log(`Ya marcadas (saltadas, --incluir-marcadas para regenerar): ${yaMarcadas.length}`);
  }
  if (sinCuenta.length) {
    console.log(`Sin cuenta en el IAM (${sinCuenta.length}): ${sinCuenta.join(", ")}`);
  }
  const inactivas = filas.filter((f) => !f.activo);
  if (inactivas.length) {
    console.log(`Inactivas (invalidadas igual, por si se reactivan): ${inactivas.length}`);
  }
  const conPasskey = filas.filter((f) => f.passkeys > 0);
  if (conPasskey.length) {
    console.log(
      `Con passkey registrada (revisar que sea del dueño): ` +
        conPasskey.map((f) => `${f.email} (${f.passkeys})`).join(", "),
    );
  }

  if (DRY || filas.length === 0) return;

  fs.mkdirSync(SALIDA, { recursive: true });
  const sello = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const destino = path.join(SALIDA, `claves-temporales-${sello}.csv`);
  const lineas = ["email,nombre,usuario,clave_temporal"].concat(
    filas.map((f) => [f.email, f.nombre, f.username, f.clave].map(csv).join(",")),
  );
  fs.writeFileSync(destino, lineas.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
  console.log(`\nClaves temporales: ${destino}`);
  console.log("Entregarlas por canal privado y borrar el archivo después.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
