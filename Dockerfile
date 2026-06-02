FROM node:22-alpine AS builder

# OpenSSL requerido por Prisma (no viene en alpine por defecto)
RUN apk add --no-cache openssl

WORKDIR /app

# Instalar dependencias
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copiar fuentes y compilar
COPY . .
RUN yarn prisma:generate
RUN yarn build

# ── Imagen de producción ──────────────────────────────────────────────
FROM node:22-alpine AS runner

# OpenSSL requerido por Prisma en runtime (migrate deploy + queries)
RUN apk add --no-cache openssl

WORKDIR /app

# Sólo dependencias de producción
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

# Copiar artefactos del builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma

EXPOSE 4000

# Ejecutar migraciones y arrancar
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
