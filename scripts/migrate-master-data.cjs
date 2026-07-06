/**
 * Migración de datos maestros: normaliza superintendencias y liga áreas + trabajadores.
 *  1. Crea Superintendencia (entidad) desde los nombres string de las áreas.
 *  2. Setea Area.superintendenciaId.
 *  3. Best-effort: liga Trabajador.areaCodigo (match por código o nombre de área)
 *     y deriva su superintendencia denormalizada.
 *
 * Idempotente. Uso: node scripts/migrate-master-data.cjs
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const areas = await prisma.area.findMany();
  console.log(`Áreas en catálogo: ${areas.length}`);

  // 1 + 2. Superintendencias únicas desde los strings de las áreas
  const nombresSup = [...new Set(areas.map((a) => a.superintendencia).filter(Boolean))];
  const supByNombre = new Map();
  for (const nombre of nombresSup) {
    const sup = await prisma.superintendencia.upsert({
      where: { nombre },
      update: {},
      create: { nombre },
    });
    supByNombre.set(nombre, sup.id);
  }
  console.log(`✅ Superintendencias creadas/normalizadas: ${supByNombre.size}`);

  let areasLigadas = 0;
  for (const a of areas) {
    const supId = supByNombre.get(a.superintendencia);
    if (supId && a.superintendenciaId !== supId) {
      await prisma.area.update({ where: { codigo: a.codigo }, data: { superintendenciaId: supId } });
      areasLigadas++;
    }
  }
  console.log(`✅ Áreas ligadas a su superintendencia: ${areasLigadas}`);

  // 3. Best-effort: ligar Trabajador.areaCodigo por código o nombre de área
  const areaByCodigo = new Map(areas.map((a) => [a.codigo, a]));
  const areaByNombre = new Map(areas.map((a) => [a.nombre.toLowerCase().trim(), a]));

  const trabajadores = await prisma.trabajador.findMany({
    where: { areaCodigo: null, area: { not: null } },
    select: { id: true, area: true },
  });
  let trabLigados = 0;
  for (const t of trabajadores) {
    const raw = (t.area || "").trim();
    const match = areaByCodigo.get(raw) || areaByNombre.get(raw.toLowerCase());
    if (match) {
      await prisma.trabajador.update({
        where: { id: t.id },
        data: { areaCodigo: match.codigo, superintendencia: match.superintendencia, area: match.nombre },
      });
      trabLigados++;
    }
  }
  console.log(`✅ Trabajadores ligados a un área: ${trabLigados} / ${trabajadores.length} evaluados`);
  console.log("🎉 Migración de datos maestros completada");
}

main()
  .catch((e) => { console.error("❌", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
