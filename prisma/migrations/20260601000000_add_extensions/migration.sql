-- Extensiones PostgreSQL requeridas por IAM Core
-- Se ejecutan via "prisma migrate deploy" en el startup del contenedor

-- UUID helpers (alternativa a gen_random_uuid() nativo de PG 13+)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Búsquedas trigram eficientes para ILIKE en username/email
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
