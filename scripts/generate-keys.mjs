/**
 * Genera el par de claves RSA 2048-bit para firmar JWTs.
 *
 * Uso:  node scripts/generate-keys.mjs
 *       yarn keys:generate
 *
 * Salida: keys/private.pem y keys/public.pem
 */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const keysDir   = resolve(__dirname, '..', 'keys');

if (!existsSync(keysDir)) {
  mkdirSync(keysDir, { recursive: true });
}

const privatePath = join(keysDir, 'private.pem');
const publicPath  = join(keysDir, 'public.pem');

if (existsSync(privatePath) && process.env.NODE_ENV === 'production') {
  console.error('⛔ No se sobreescribirán claves existentes en producción.');
  process.exit(1);
}

console.log('🔐 Generando par de claves RSA 2048-bit...');

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength:      2048,
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

writeFileSync(privatePath, privateKey, { mode: 0o600 });
writeFileSync(publicPath,  publicKey,  { mode: 0o644 });

console.log(`✅ Clave privada: ${privatePath}`);
console.log(`✅ Clave pública: ${publicPath}`);
console.log('');
console.log('⚠️  IMPORTANTE:');
console.log('   1. Agrega keys/private.pem a .gitignore');
console.log('   2. En producción, usa un secrets manager para la clave privada');
console.log('   3. La clave pública (public.pem) puede compartirse con servicios hijos');
