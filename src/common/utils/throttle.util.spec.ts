import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { pideLimiteStrict } from './throttle.util';

class ConStrictEnMetodo {
  @Throttle({ strict: { limit: 10, ttl: 300_000 } })
  login() { return 'ok'; }

  @SkipThrottle()
  catalogo() { return 'ok'; }

  sinDecorador() { return 'ok'; }
}

@Throttle({ strict: { limit: 5, ttl: 60_000 } })
class ConStrictEnClase {
  cualquiera() { return 'ok'; }
}

function contexto(clase: new () => object, metodo: string): ExecutionContext {
  return {
    getHandler: () => (clase.prototype as Record<string, unknown>)[metodo],
    getClass:   () => clase,
  } as unknown as ExecutionContext;
}

describe('pideLimiteStrict', () => {
  it('aplica en rutas con @Throttle({ strict }) en el método', () => {
    expect(pideLimiteStrict(contexto(ConStrictEnMetodo, 'login'))).toBe(true);
  });

  it('aplica en rutas cuyo controlador tiene @Throttle({ strict })', () => {
    expect(pideLimiteStrict(contexto(ConStrictEnClase, 'cualquiera'))).toBe(true);
  });

  it('no aplica en rutas sin decorador ni con @SkipThrottle() a secas', () => {
    expect(pideLimiteStrict(contexto(ConStrictEnMetodo, 'sinDecorador'))).toBe(false);
    expect(pideLimiteStrict(contexto(ConStrictEnMetodo, 'catalogo'))).toBe(false);
  });
});
