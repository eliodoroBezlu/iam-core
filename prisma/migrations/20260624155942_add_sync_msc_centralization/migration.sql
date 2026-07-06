-- AlterTable
ALTER TABLE "trabajadores" ADD COLUMN     "disciplina" TEXT;

-- AlterTable
ALTER TABLE "user_service_access" ADD COLUMN     "metadata" JSONB;

-- CreateTable
CREATE TABLE "areas" (
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "superintendencia" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("codigo")
);

-- CreateIndex
CREATE INDEX "areas_superintendencia_idx" ON "areas"("superintendencia");

-- CreateIndex
CREATE INDEX "areas_activo_idx" ON "areas"("activo");
