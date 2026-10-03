-- El CI deja de ser obligatorio: contratistas y personal temporal dados de
-- alta desde los servicios pueden no tenerlo. El índice único se mantiene
-- (Postgres admite varios NULL en un índice único).
ALTER TABLE "trabajadores" ALTER COLUMN "ci" DROP NOT NULL;
