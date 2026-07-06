-- AlterTable
ALTER TABLE "services" ADD COLUMN     "permissionCatalog" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rolePermissions" JSONB;
