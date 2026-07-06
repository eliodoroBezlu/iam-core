-- AlterTable
ALTER TABLE "areas" ADD COLUMN     "superintendenciaId" TEXT;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "availableRoles" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "trabajadores" ADD COLUMN     "areaCodigo" TEXT,
ADD COLUMN     "esContratista" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "superintendencias" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "superintendencias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "superintendencias_nombre_key" ON "superintendencias"("nombre");

-- CreateIndex
CREATE INDEX "superintendencias_activo_idx" ON "superintendencias"("activo");

-- CreateIndex
CREATE INDEX "areas_superintendenciaId_idx" ON "areas"("superintendenciaId");

-- CreateIndex
CREATE INDEX "trabajadores_areaCodigo_idx" ON "trabajadores"("areaCodigo");

-- AddForeignKey
ALTER TABLE "trabajadores" ADD CONSTRAINT "trabajadores_areaCodigo_fkey" FOREIGN KEY ("areaCodigo") REFERENCES "areas"("codigo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_superintendenciaId_fkey" FOREIGN KEY ("superintendenciaId") REFERENCES "superintendencias"("id") ON DELETE SET NULL ON UPDATE CASCADE;
