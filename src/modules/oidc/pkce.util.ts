import { createHash, timingSafeEqual } from 'crypto';

/**
 * Verifica un code_verifier PKCE contra un code_challenge usando S256.
 * challenge esperado = BASE64URL( SHA-256( verifier ) ).
 * Comparación en tiempo constante para evitar timing attacks.
 */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;

  const computed = createHash('sha256').update(verifier).digest('base64url');

  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
