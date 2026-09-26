FROM node:22-alpine

# OpenSSL requerido por Prisma (no viene en alpine por defecto)
RUN apk add --no-cache openssl

WORKDIR /app

# Instalar dependencias
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copiar fuentes
COPY . .

# Generar Prisma client y compilar TypeScript
RUN npx prisma generate && yarn build

EXPOSE 4000

# Migraciones + arranque. El seed ya NO corre solo.
#
# Nota: el build genera dist/src/main.js (no dist/main.js) porque
# scripts/*.ts y prisma/seed.ts se incluyen en la compilación.
#
# ── Por qué el seed dejó de correr en cada arranque ────────────────────
#
# «Usa upsert → es seguro» era cierto solo a medias. Los `upsert` del seed
# llevan bloques `update:` que **pisan configuración viva** cada vez que el
# contenedor arranca —y en Railway eso es cada despliegue y cada reinicio—:
#
#   · oauth_clients (forms, sync-msc)
#       redirectUris, postLogoutRedirectUris  ← reescritos desde SEED_*_URIS
#       clientSecretHash                      ← rehasheado desde SEED_*_SECRET
#   · services (forms, sync-msc, iro-service)
#       availableRoles, permissionCatalog, rolePermissions
#
# Consecuencia concreta: registrar un redirect_uri desde el portal y volver a
# desplegar lo borraba, y el login OIDC volvía a fallar con «redirect_uri no
# registrado para este client» sin que nadie hubiera tocado nada. Lo mismo con
# cualquier rol o permiso ajustado por GUI.
#
# `prisma migrate deploy` sí se queda: el esquema tiene que ir con el código o
# la aplicación arranca contra una base que no entiende.
#
# Para sembrar un entorno nuevo, poner EJECUTAR_SEED=true en ese despliegue y
# quitarlo después. Es un paso de estreno, no de rutina.
CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"$EJECUTAR_SEED\" = \"true\" ]; then echo '▶ EJECUTAR_SEED=true → sembrando'; node dist/prisma/seed.js; else echo '⏭ seed omitido (EJECUTAR_SEED no es true)'; fi && node dist/src/main"]
