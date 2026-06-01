/**
 * Genera el par de claves RSA 2048-bit para firmar JWTs.
 * Ejecutar ANTES de levantar el servidor por primera vez.
 *
 * Uso: yarn keys:generate
 * Salida: keys/private.pem y keys/public.pem
 *
 * ⚠️ IMPORTANTE:
 *   - Nunca commitear private.pem al repositorio
 *   - En producción usar un secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
 *   - Añadir keys/ al .gitignore
 */
import { generateKeyPairSync } from 'crypto';
import * as fs   from 'fs';
import * as path from 'path';

const keysDir = path.resolve(__dirname, '..', 'keys');

if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir, { recursive: true });
}

const privatePath = path.join(keysDir, 'private.pem');
const publicPath  = path.join(keysDir, 'public.pem');

// No sobrescribir claves existentes en producción
if (fs.existsSync(privatePath) && process.env.NODE_ENV === 'production') {
  console.error('⛔ No se sobreescribirán claves existentes en producción.');
  process.exit(1);
}

console.log('🔐 Generando par de claves RSA 2048-bit...');

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength:  2048,
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

fs.writeFileSync(privatePath, privateKey,  { mode: 0o600 }); // Solo lectura para el propietario
fs.writeFileSync(publicPath,  publicKey,   { mode: 0o644 });

console.log(`✅ Clave privada: ${privatePath}`);
console.log(`✅ Clave pública: ${publicPath}`);
console.log('');
console.log('⚠️  IMPORTANTE:');
console.log('   1. Agrega keys/private.pem a .gitignore');
console.log('   2. En producción, usa un secrets manager para la clave privada');
console.log('   3. La clave pública (public.pem) puede compartirse con servicios hijos');
