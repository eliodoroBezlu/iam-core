-- Marca de "debe cambiar la contraseña": se activa al restablecerla un admin
-- o al invalidarla (p. ej. por una filtración); el login exige una nueva.
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
