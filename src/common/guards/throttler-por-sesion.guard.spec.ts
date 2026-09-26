import { createHash } from 'crypto';
import { ThrottlerPorSesionGuard } from './throttler-por-sesion.guard';

/**
 * `getTracker` es `protected`, que es lo correcto para quien use el guard pero
 * no para comprobarlo. Esta subclase lo expone sin tocar la implementación.
 */
class GuardDePrueba extends ThrottlerPorSesionGuard {
  public clavePara(req: Record<string, any>): Promise<string> {
    return this.getTracker(req);
  }
}

describe('ThrottlerPorSesionGuard', () => {
  /**
   * El guard se construye por DI en la aplicación. Aquí solo se ejercita
   * `getTracker`, que no usa ninguna de esas dependencias, así que se
   * instancia con las mínimas para que el constructor pase.
   */
  const guard = new GuardDePrueba(
    { throttlers: [] } as never,
    {} as never,
    {} as never,
  );

  const sha256 = (texto: string) =>
    createHash('sha256').update(texto).digest('hex');

  it('cuenta por sesión cuando la petición trae refresh token', async () => {
    const clave = await guard.clavePara({
      cookies: { refresh_token: 'token-de-sesion' },
      ip: '10.0.0.1',
    });

    expect(clave).toBe(`sesion:${sha256('token-de-sesion')}`);
  });

  it('nunca expone el token en crudo en la clave', async () => {
    const clave = await guard.clavePara({
      cookies: { refresh_token: 'token-de-sesion' },
      ip: '10.0.0.1',
    });

    expect(clave).not.toContain('token-de-sesion');
  });

  it('da la misma clave para la misma sesión, aunque cambie la IP', async () => {
    // Es el caso real: todos los refrescos salen del servidor de Next, pero
    // cada uno lleva la cookie de su usuario.
    const desdeUnSitio = await guard.clavePara({
      cookies: { refresh_token: 'mismo-token' },
      ip: '10.0.0.1',
    });
    const desdeOtro = await guard.clavePara({
      cookies: { refresh_token: 'mismo-token' },
      ip: '192.168.1.50',
    });

    expect(desdeUnSitio).toBe(desdeOtro);
  });

  it('da claves distintas a sesiones distintas desde la MISMA IP', async () => {
    // Esto es lo que arregla el problema: dos usuarios detrás del mismo
    // servidor dejan de gastarse el presupuesto el uno al otro.
    const usuarioA = await guard.clavePara({
      cookies: { refresh_token: 'token-a' },
      ip: '10.0.0.1',
    });
    const usuarioB = await guard.clavePara({
      cookies: { refresh_token: 'token-b' },
      ip: '10.0.0.1',
    });

    expect(usuarioA).not.toBe(usuarioB);
  });

  it('se repliega a la IP cuando no hay sesión', async () => {
    // `/auth/login` no lleva cookie de refresco —es lo que la crea—, así que
    // sigue contando por IP y la barrera contra fuerza bruta no se toca.
    const clave = await guard.clavePara({ cookies: {}, ip: '10.0.0.1' });

    expect(clave).not.toContain('sesion:');
    expect(clave).toContain('10.0.0.1');
  });

  it('se repliega a la IP si la cookie viene vacía o no es texto', async () => {
    const vacia = await guard.clavePara({
      cookies: { refresh_token: '' },
      ip: '10.0.0.1',
    });
    const rara = await guard.clavePara({
      cookies: { refresh_token: { algo: 'raro' } },
      ip: '10.0.0.1',
    });

    expect(vacia).not.toContain('sesion:');
    expect(rara).not.toContain('sesion:');
  });

  it('no se cae si la petición no trae cookies', async () => {
    await expect(guard.clavePara({ ip: '10.0.0.1' })).resolves.toContain(
      '10.0.0.1',
    );
  });
});
