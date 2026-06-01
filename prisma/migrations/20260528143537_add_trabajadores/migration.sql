-- CreateTable
CREATE TABLE "trabajadores" (
    "id" TEXT NOT NULL,
    "ci" TEXT NOT NULL,
    "nomina" TEXT NOT NULL,
    "puesto" TEXT NOT NULL,
    "superintendencia" TEXT NOT NULL,
    "area" TEXT,
    "jde" TEXT,
    "celular" TEXT,
    "residencia" TEXT,
    "noBloque" TEXT,
    "noHabitacion" TEXT,
    "fechaIngreso" TIMESTAMP(3),
    "tieneAccesoSistema" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trabajadores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trabajadores_ci_key" ON "trabajadores"("ci");

-- CreateIndex
CREATE UNIQUE INDEX "trabajadores_userId_key" ON "trabajadores"("userId");

-- CreateIndex
CREATE INDEX "trabajadores_ci_idx" ON "trabajadores"("ci");

-- CreateIndex
CREATE INDEX "trabajadores_nomina_idx" ON "trabajadores"("nomina");

-- CreateIndex
CREATE INDEX "trabajadores_superintendencia_idx" ON "trabajadores"("superintendencia");

-- CreateIndex
CREATE INDEX "trabajadores_area_idx" ON "trabajadores"("area");

-- CreateIndex
CREATE INDEX "trabajadores_userId_idx" ON "trabajadores"("userId");

-- AddForeignKey
ALTER TABLE "trabajadores" ADD CONSTRAINT "trabajadores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
