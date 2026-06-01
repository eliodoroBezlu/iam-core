/**
 * Seed inicial del IAM Core.
 * Crea el usuario admin, el servicio 'forms' y concede acceso al admin.
 *
 * Ejecutar: yarn prisma:seed
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed del IAM Core...');

  const BCRYPT_ROUNDS  = 12;
  const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345!';
  const ADMIN_EMAIL    = process.env.SEED_ADMIN_EMAIL    ?? 'admin@empresa.com';
  const ADMIN_FULLNAME = process.env.SEED_ADMIN_FULLNAME ?? 'Administrador Sistema';

  // ── 1. Crear usuario admin ─────────────────────────────────────
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);

  const admin = await prisma.user.upsert({
    where:  { username: ADMIN_USERNAME },
    update: {},
    create: {
      username:     ADMIN_USERNAME,
      email:        ADMIN_EMAIL,
      passwordHash,
      fullName:     ADMIN_FULLNAME,
      roles:        ['super_admin', 'admin'],
      isAdmin:      true,
      isActive:     true,
    },
  });

  console.log(`✅ Admin creado: ${admin.username} [${admin.id}]`);

  // ── 2. Registrar el servicio Forms ────────────────────────────
  const formsService = await prisma.service.upsert({
    where:  { key: 'forms' },
    update: {},
    create: {
      key:         'forms',
      displayName: 'Formularios de Inspección',
      baseUrl:     process.env.FORMS_BASE_URL ?? 'http://localhost:3002',
      isActive:    true,
    },
  });

  console.log(`✅ Servicio registrado: ${formsService.key}`);

  // ── 3. Conceder acceso del admin al servicio Forms ─────────────
  await prisma.userServiceAccess.upsert({
    where: {
      userId_serviceId: {
        userId:    admin.id,
        serviceId: formsService.id,
      },
    },
    update: {},
    create: {
      userId:      admin.id,
      serviceId:   formsService.id,
      roles:       ['forms:admin'],
      grantedById: admin.id,
    },
  });

  console.log(`✅ Acceso concedido: ${admin.username} → forms [forms:admin]`);

  // ── 4. Registrar IRO Service (si aplica) ──────────────────────
  const iroService = await prisma.service.upsert({
    where:  { key: 'iro-service' },
    update: {},
    create: {
      key:         'iro-service',
      displayName: 'IRO-ISOP',
      baseUrl:     process.env.IRO_BASE_URL ?? 'http://localhost:3003',
      isActive:    true,
    },
  });

  console.log(`✅ Servicio registrado: ${iroService.key}`);

  console.log('\n🎉 Seed completado exitosamente');
  console.log('──────────────────────────────────────');
  console.log(`👤 Admin username: ${ADMIN_USERNAME}`);
  console.log(`🔑 Admin password: ${ADMIN_PASSWORD}`);
  console.log('──────────────────────────────────────');
  console.log('⚠️  Cambia la contraseña del admin inmediatamente en producción.');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
