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

# Ejecutar migraciones, seed (idempotente) y arrancar.
# Nota: el build genera dist/src/main.js (no dist/main.js) porque
# scripts/*.ts y prisma/seed.ts se incluyen en la compilación.
# El seed usa upsert → seguro correrlo en cada arranque.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/prisma/seed.js && node dist/src/main"]
