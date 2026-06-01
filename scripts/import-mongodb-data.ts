/**
 * ============================================================
 * Script de importación: MongoDB → IAM Core (PostgreSQL)
 * ============================================================
 *
 * Importa usuarios y trabajadores desde los exports de MongoDB
 * (BackendForm) hacia la base de datos PostgreSQL del IAM Core.
 *
 * ANTES DE EJECUTAR:
 *  1. Copiar los archivos JSON a la carpeta data/:
 *       data/users.json        ← export de la colección "users" de MongoDB
 *       data/trabajadores.json ← export de la colección "trabajadors" de MongoDB
 *
 *  2. Detener el servidor IAM Core (para que Prisma pueda regenerar el cliente)
 *
 *  3. Ejecutar:
 *       npx ts-node --project tsconfig.json -e "require('ts-node').register({transpileOnly:true})" scripts/import-mongodb-data.ts
 *     O más simple:
 *       npx tsx scripts/import-mongodb-data.ts
 *
 * El script es IDEMPOTENTE: usa upsert, se puede ejecutar múltiples veces.
 * ============================================================
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync }  from 'fs';
import { join }          from 'path';

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

// ── Tipos MongoDB exportados ────────────────────────────────────────

interface MongoDate  { $date: string }
interface MongoOid   { $oid: string }

interface MongoUser {
  _id:                { $oid: string };
  username:           string;
  email:              string | null;
  password:           string;         // bcrypt hash
  roles:              string[];
  isTwoFactorEnabled: boolean;
  isActive:           boolean;
  fullName:           string | null;
  avatarUrl:          string | null;
  createdAt:          MongoDate;
  updatedAt:          MongoDate;
}

interface MongoTrabajador {
  _id:                  MongoOid | { $oid: string };
  ci:                   string;
  nomina:               string;
  puesto:               string;
  superintendencia:     string;
  area?:                string;
  jde?:                 string;
  celular?:             string;
  residencia?:          string;
  fecha_ingreso?:       MongoDate;
  no_bloque?:           string;
  no_habitacion?:       string;
  tiene_acceso_sistema?: boolean;
  activo?:              boolean;
  username?:            string;       // si tiene acceso al sistema
  userId?:              MongoOid;    // MongoDB userId — no usable directamente
  keycloak_user_id?:    string;       // ignorado
  updatedBy?:           string;       // ignorado
}

// ── Helpers ─────────────────────────────────────────────────────────

function readJson<T>(filename: string): T[] {
  const path = join(__dirname, '..', 'data', filename);
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as T[];
  } catch (e) {
    console.error(`❌ No se pudo leer ${filename}. Colócalo en la carpeta data/`);
    throw e;
  }
}

function toDate(d: MongoDate | undefined): Date | undefined {
  if (!d?.$date) return undefined;
  const parsed = new Date(d.$date);
  return isNaN(parsed.getTime()) ? undefined : parsed;
}

// ── PASO 1: Importar usuarios ───────────────────────────────────────

async function importUsers(users: MongoUser[]): Promise<Map<string, string>> {
  console.log(`\n📥 Importando ${users.length} usuarios...`);

  // username → iamUserId
  const usernameToId = new Map<string, string>();

  let created = 0;
  let updated = 0;

  for (const u of users) {
    // Mapeo de roles: el IAM Core usa los mismos strings
    // MongoDB: ["user", "admin"] | ["user", "supervisor"] | ["user", "inspector"]
    // IAM Core: igual — String[] flexible
    const roles = u.roles.length > 0 ? u.roles : ['user'];

    // isAdmin = true si tiene rol "admin" o "super_admin"
    const isAdmin = roles.includes('admin') || roles.includes('super_admin');

    const result = await prisma.user.upsert({
      where: { username: u.username },
      create: {
        username:     u.username,
        email:        u.email ?? undefined,
        passwordHash: u.password,          // bcrypt — compatible directo
        fullName:     u.fullName ?? undefined,
        avatarUrl:    u.avatarUrl ?? undefined,
        roles,
        isActive:     u.isActive,
        isAdmin,
        totpEnabled:  u.isTwoFactorEnabled,
      },
      update: {
        email:        u.email ?? undefined,
        passwordHash: u.password,
        fullName:     u.fullName ?? undefined,
        roles,
        isActive:     u.isActive,
        isAdmin,
        totpEnabled:  u.isTwoFactorEnabled,
      },
    });

    usernameToId.set(u.username, result.id);

    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      created++;
    } else {
      updated++;
    }

    console.log(`  ✅ ${u.username} (${roles.join(', ')}) → ${result.id}`);
  }

  console.log(`\n  Usuarios: ${created} creados, ${updated} actualizados`);
  return usernameToId;
}

// ── PASO 2: Importar trabajadores ───────────────────────────────────

async function importTrabajadores(
  trabajadores: MongoTrabajador[],
  usernameToId: Map<string, string>,
): Promise<void> {
  console.log(`\n📥 Importando ${trabajadores.length} trabajadores...`);

  let created = 0;
  let updated = 0;
  let linked  = 0;
  let skipped = 0;

  for (const t of trabajadores) {
    // Limpiar ci — algunos tienen sufijos como "3994205-1B"
    const ci = String(t.ci).trim();
    if (!ci) { skipped++; continue; }

    // Resolver userId IAM Core por username
    let userId: string | undefined = undefined;
    if (t.username && usernameToId.has(t.username)) {
      userId = usernameToId.get(t.username);
      linked++;
    } else if (t.username) {
      // Buscar en DB por si ya existía antes de este import
      const existing = await prisma.user.findUnique({ where: { username: t.username } });
      if (existing) {
        userId = existing.id;
        usernameToId.set(t.username, existing.id);
        linked++;
      }
    }

    const tieneAcceso = t.tiene_acceso_sistema === true;

    const data = {
      nomina:            t.nomina,
      puesto:            t.puesto,
      superintendencia:  t.superintendencia,
      area:              t.area              ?? undefined,
      jde:               t.jde              ?? undefined,
      celular:           t.celular          ?? undefined,
      residencia:        t.residencia       ?? undefined,
      fechaIngreso:      toDate(t.fecha_ingreso),
      noBloque:          t.no_bloque        ?? undefined,
      noHabitacion:      t.no_habitacion    ?? undefined,
      tieneAccesoSistema: tieneAcceso,
      activo:            t.activo           ?? true,
      userId:            userId,
    };

    try {
      const result = await prisma.trabajador.upsert({
        where:  { ci },
        create: { ci, ...data },
        update: data,
      });

      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }
    } catch (err: unknown) {
      // userId ya asignado a otro trabajador → import sin link
      if ((err as { code?: string }).code === 'P2002') {
        const result = await prisma.trabajador.upsert({
          where:  { ci },
          create: { ci, ...data, userId: undefined },
          update: { ...data, userId: undefined },
        });
        console.warn(`  ⚠️  ${ci} — userId en conflicto, importado sin link de usuario`);
        if (result.createdAt.getTime() === result.updatedAt.getTime()) created++;
        else updated++;
      } else {
        console.error(`  ❌ Error importando CI ${ci}:`, err);
        skipped++;
      }
    }
  }

  console.log(`\n  Trabajadores: ${created} creados, ${updated} actualizados, ${linked} vinculados a usuario, ${skipped} omitidos`);
}

// ── PASO 3: Crear servicio "forms" si no existe ────────────────────

async function ensureFormsService(): Promise<void> {
  const existing = await prisma.service.findUnique({ where: { key: 'forms' } });
  if (!existing) {
    await prisma.service.create({
      data: {
        key:         'forms',
        displayName: 'Sistema de Formularios e Inspecciones',
        baseUrl:     process.env.FORMS_BASE_URL ?? 'http://localhost:3002',
        isActive:    true,
      },
    });
    console.log('\n  ✅ Servicio "forms" creado');
  } else {
    console.log('\n  ℹ️  Servicio "forms" ya existe');
  }
}

// ── PASO 4: Asignar acceso al servicio "forms" a usuarios migrados ─

async function grantFormsAccess(
  users: MongoUser[],
  usernameToId: Map<string, string>,
): Promise<void> {
  const service = await prisma.service.findUnique({ where: { key: 'forms' } });
  if (!service) return;

  // Admin system user for grantedById
  const adminUser = await prisma.user.findFirst({ where: { roles: { has: 'admin' } } });
  if (!adminUser) return;

  console.log(`\n📥 Asignando acceso al servicio "forms"...`);
  let granted = 0;

  for (const u of users) {
    const userId = usernameToId.get(u.username);
    if (!userId) continue;

    // Roles de servicio basados en el rol global
    const serviceRoles = u.roles.filter((r) => r !== 'user');

    try {
      await prisma.userServiceAccess.upsert({
        where:  { userId_serviceId: { userId, serviceId: service.id } },
        create: {
          userId,
          serviceId:   service.id,
          roles:       serviceRoles.length > 0 ? serviceRoles : ['user'],
          grantedById: adminUser.id,
          revokedAt:   null,
        },
        update: {
          roles:     serviceRoles.length > 0 ? serviceRoles : ['user'],
          revokedAt: null,
        },
      });
      granted++;
    } catch {
      // ignorar
    }
  }

  console.log(`  ✅ ${granted} usuarios con acceso al servicio "forms"`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('   Importación MongoDB → IAM Core (PostgreSQL)');
  console.log('═══════════════════════════════════════════════════');

  // Leer archivos
  const users        = readJson<MongoUser>('users.json');
  const trabajadores = readJson<MongoTrabajador>('trabajadores.json');

  console.log(`\n  📂 Archivos leídos:`);
  console.log(`     users.json:        ${users.length} registros`);
  console.log(`     trabajadores.json: ${trabajadores.length} registros`);

  // Importar en orden
  await ensureFormsService();
  const usernameToId = await importUsers(users);
  await importTrabajadores(trabajadores, usernameToId);
  await grantFormsAccess(users, usernameToId);

  console.log('\n\n═══════════════════════════════════════════════════');
  console.log('   ✅ Importación completada');
  console.log('═══════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Error fatal:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
