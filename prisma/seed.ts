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
  // ── Catálogo RBAC de forms (migrado desde su role-permissions.ts) ──
  const FORMS_PERMS = [
    'create:worker', 'read:worker', 'update:worker', 'delete:worker', 'manage:worker_user',
    'read:user', 'manage:users',
    'create:form', 'read:form', 'update:form', 'delete:form', 'approve:form',
    'view:reports', 'manage:settings', 'manage:action_plan',
    'download:excel', 'download:pdf', 'double:form',
  ];
  // Catálogo de roles genéricos GLOBAL (compartido por todos los servicios)
  const GENERIC_ROLES = [
    'super_admin', 'admin', 'superintendente', 'supervisor',
    'planificador', 'tecnico', 'contratista',
  ];
  const FORMS_ROLE_PERMS: Record<string, string[]> = {
    super_admin:     FORMS_PERMS,
    admin:           FORMS_PERMS,
    superintendente: ['read:worker', 'read:form', 'view:reports', 'manage:action_plan', 'download:excel', 'download:pdf'],
    supervisor:      ['read:worker', 'create:form', 'read:form', 'approve:form', 'view:reports', 'manage:action_plan', 'download:excel', 'download:pdf'],
    planificador:    ['read:worker', 'read:form', 'view:reports', 'download:excel', 'download:pdf'],
    tecnico:         ['read:worker', 'create:form', 'read:form', 'download:excel', 'download:pdf'],
    contratista:     ['read:worker', 'create:form', 'read:form'],
  };
  const FORMS_ROLES = GENERIC_ROLES;

  const formsService = await prisma.service.upsert({
    where:  { key: 'forms' },
    update: {
      availableRoles:    FORMS_ROLES,
      permissionCatalog: FORMS_PERMS,
      rolePermissions:   FORMS_ROLE_PERMS,
    },
    create: {
      key:               'forms',
      displayName:       'Formularios de Inspección',
      baseUrl:           process.env.FORMS_BASE_URL ?? 'http://localhost:3002',
      isActive:          true,
      availableRoles:    FORMS_ROLES,
      permissionCatalog: FORMS_PERMS,
      rolePermissions:   FORMS_ROLE_PERMS,
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
      roles:       ['admin'],
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
        roles:       ['inspector'],
        grantedById: admin.id,
      },
    });

    console.log(`✅ Inspector técnico creado: ${inspector.username} → forms`);
  } else {
    console.log('⏭️  INSPECTOR_PASSWORD no definido — se omite el usuario inspector');
  }

  // ── 3c. Servicio + OAuth client OIDC para Sync-MSC ─────────────
  // Sync-MSC (gestión de mantenimiento) usa el login estándar del IAM
  // vía OIDC y centraliza su autorización aquí (rol sync-msc:* + áreas
  // en UserServiceAccess.metadata).
  const SYNC_PERMS = [
    'sync:read_ot', 'sync:create_ot', 'sync:approve_ot', 'sync:close_ot', 'sync:manage_ot',
    'sync:read_calibration', 'sync:manage_calibration',
    'sync:view_reports', 'sync:manage_schedule',
    'sync:manage_users', 'sync:manage_areas', 'sync:manage_config',
  ];
  const SYNC_ROLE_PERMS: Record<string, string[]> = {
    super_admin:     SYNC_PERMS,
    admin:           SYNC_PERMS,
    superintendente: ['sync:read_ot', 'sync:view_reports', 'sync:read_calibration', 'sync:manage_schedule'],
    supervisor:      ['sync:read_ot', 'sync:create_ot', 'sync:approve_ot', 'sync:close_ot', 'sync:view_reports', 'sync:read_calibration', 'sync:manage_schedule'],
    planificador:    ['sync:read_ot', 'sync:view_reports', 'sync:manage_schedule'],
    tecnico:         ['sync:read_ot', 'sync:create_ot', 'sync:read_calibration'],
    contratista:     ['sync:read_ot', 'sync:create_ot'],
  };
  const SYNC_ROLES = GENERIC_ROLES;

  const syncService = await prisma.service.upsert({
    where:  { key: 'sync-msc' },
    update: {
      availableRoles:    SYNC_ROLES,
      permissionCatalog: SYNC_PERMS,
      rolePermissions:   SYNC_ROLE_PERMS,
    },
    create: {
      key:               'sync-msc',
      displayName:       'Sync MSC (Gestión de Mantenimiento)',
      baseUrl:           process.env.SYNC_BASE_URL ?? 'http://localhost:3000',
      isActive:          true,
      availableRoles:    SYNC_ROLES,
      permissionCatalog: SYNC_PERMS,
      rolePermissions:   SYNC_ROLE_PERMS,
    },
  });

  console.log(`✅ Servicio registrado: ${syncService.key}`);

  // Acceso del admin a Sync-MSC con rol admin (1)
  await prisma.userServiceAccess.upsert({
    where: {
      userId_serviceId: { userId: admin.id, serviceId: syncService.id },
    },
    update: {},
    create: {
      userId:      admin.id,
      serviceId:   syncService.id,
      roles:       ['sync-msc:admin'],
      grantedById: admin.id,
    },
  });

  console.log(`✅ Acceso concedido: ${admin.username} → sync-msc [sync-msc:admin]`);

  const SYNC_CLIENT_ID     = process.env.SEED_SYNC_CLIENT_ID ?? 'sync-msc';
  const SYNC_CLIENT_SECRET = process.env.SEED_SYNC_CLIENT_SECRET;
  const SYNC_REDIRECT_URIS = (process.env.SEED_SYNC_REDIRECT_URIS
    ?? 'http://localhost:3000/api/auth/callback').split(',').map((u) => u.trim());
  const SYNC_POST_LOGOUT   = (process.env.SEED_SYNC_POST_LOGOUT_URIS
    ?? 'http://localhost:3000/').split(',').map((u) => u.trim());

  if (SYNC_CLIENT_SECRET) {
    const secretHash = createHash('sha256').update(SYNC_CLIENT_SECRET).digest('hex');
    await prisma.oAuthClient.upsert({
      where:  { clientId: SYNC_CLIENT_ID },
      update: {
        clientSecretHash:       secretHash,
        redirectUris:           SYNC_REDIRECT_URIS,
        postLogoutRedirectUris: SYNC_POST_LOGOUT,
        isActive:               true,
      },
      create: {
        clientId:               SYNC_CLIENT_ID,
        clientSecretHash:       secretHash,
        name:                   'Sync MSC',
        redirectUris:           SYNC_REDIRECT_URIS,
        postLogoutRedirectUris: SYNC_POST_LOGOUT,
        allowedScopes:          ['openid', 'profile', 'email'],
        isConfidential:         true,
        serviceId:              syncService.id,
      },
    });
    console.log(`✅ OAuth client OIDC creado: ${SYNC_CLIENT_ID} → sync-msc`);
  } else {
    console.log('⏭️  SEED_SYNC_CLIENT_SECRET no definido — se omite el OAuth client de Sync');
  }

  // ── 4. Registrar IRO Service (si aplica) ──────────────────────
  const iroService = await prisma.service.upsert({
    where:  { key: 'iro-service' },
    update: { availableRoles: ['iro-service:admin', 'iro-service:user'] },
    create: {
      key:            'iro-service',
      displayName:    'IRO-ISOP',
      baseUrl:        process.env.IRO_BASE_URL ?? 'http://localhost:3003',
      isActive:       true,
      availableRoles: ['iro-service:admin', 'iro-service:user'],
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
