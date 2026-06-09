/**
 * Seed inicial del IAM Core.
 * Crea el usuario admin, el servicio 'forms' y concede acceso al admin.
 *
 * Ejecutar: yarn prisma:seed
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';

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

  // ── 3a. OAuth client OIDC para FormNext ────────────────────────
  // Cliente del flujo Authorization Code + PKCE. El secret se hashea
  // (SHA-256) y debe configurarse en FormNext como OIDC_CLIENT_SECRET.
  const FORMS_CLIENT_ID     = process.env.SEED_FORMS_CLIENT_ID ?? 'forms';
  const FORMS_CLIENT_SECRET = process.env.SEED_FORMS_CLIENT_SECRET;
  const FORMS_REDIRECT_URIS = (process.env.SEED_FORMS_REDIRECT_URIS
    ?? 'http://localhost:3001/api/auth/callback').split(',').map((u) => u.trim());
  const FORMS_POST_LOGOUT   = (process.env.SEED_FORMS_POST_LOGOUT_URIS
    ?? 'http://localhost:3001/').split(',').map((u) => u.trim());

  if (FORMS_CLIENT_SECRET) {
    const secretHash = createHash('sha256').update(FORMS_CLIENT_SECRET).digest('hex');
    await prisma.oAuthClient.upsert({
      where:  { clientId: FORMS_CLIENT_ID },
      update: {
        clientSecretHash:       secretHash,
        redirectUris:           FORMS_REDIRECT_URIS,
        postLogoutRedirectUris: FORMS_POST_LOGOUT,
        isActive:               true,
      },
      create: {
        clientId:               FORMS_CLIENT_ID,
        clientSecretHash:       secretHash,
        name:                   'FormNext (Formularios)',
        redirectUris:           FORMS_REDIRECT_URIS,
        postLogoutRedirectUris: FORMS_POST_LOGOUT,
        allowedScopes:          ['openid', 'profile', 'email'],
        isConfidential:         true,
        serviceId:              formsService.id,
      },
    });
    console.log(`✅ OAuth client OIDC creado: ${FORMS_CLIENT_ID} → forms`);
  } else {
    console.log('⏭️  SEED_FORMS_CLIENT_SECRET no definido — se omite el OAuth client');
  }

  // ── 3b. Usuario inspector técnico (acceso legacy temporal) ─────
  // Acceso directo de inspector mientras se migran los trabajadores a
  // usuarios con passkey. BackendForm hace login server-to-server con
  // estas credenciales cuando recibe la INSPECTOR_API_KEY válida.
  const INSPECTOR_USERNAME = process.env.INSPECTOR_USERNAME ?? 'inspector_tecnico';
  const INSPECTOR_PASSWORD = process.env.INSPECTOR_PASSWORD;

  if (INSPECTOR_PASSWORD) {
    const inspectorHash = await bcrypt.hash(INSPECTOR_PASSWORD, BCRYPT_ROUNDS);

    const inspector = await prisma.user.upsert({
      where:  { username: INSPECTOR_USERNAME },
      // Cuenta de servicio: en cada deploy re-sincroniza el hash y limpia
      // cualquier bloqueo por intentos fallidos.
      update: {
        passwordHash:        inspectorHash,
        isActive:            true,
        failedLoginAttempts: 0,
        lockedUntil:         null,
      },
      create: {
        username:     INSPECTOR_USERNAME,
        email:        'inspector@sistema.local',
        passwordHash: inspectorHash,
        fullName:     'Inspector Técnico',
        roles:        ['user', 'inspector'],
        isActive:     true,
      },
    });

    await prisma.userServiceAccess.upsert({
      where: {
        userId_serviceId: {
          userId:    inspector.id,
          serviceId: formsService.id,
        },
      },
      update: {},
      create: {
        userId:      inspector.id,
        serviceId:   formsService.id,
        roles:       ['forms:inspector'],
        grantedById: admin.id,
      },
    });

    console.log(`✅ Inspector técnico creado: ${inspector.username} → forms`);
  } else {
    console.log('⏭️  INSPECTOR_PASSWORD no definido — se omite el usuario inspector');
  }

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
