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

# Ejecutar migraciones y arrancar
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
