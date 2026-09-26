import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limiting contado **por sesión** cuando la petición trae una, y por IP
 * cuando no.
 *
 * ## Por qué
 *
 * `ThrottlerGuard` cuenta por IP. Eso funciona cuando quien llama es el
 * navegador del usuario, pero el refresco de sesión de FormNext **no lo hace
 * el navegador**: lo hace su servidor de Next, con un `fetch`
 * servidor-a-servidor contra `/auth/refresh`. IAM ve siempre la misma IP —la
 * del servidor— para todos los usuarios de la instalación.
 *
 * Con `@Throttle({ strict: { limit: 10, ttl: 300_000 } })` en ese endpoint,
 * los diez refrescos cada cinco minutos no eran por persona: eran **para todo
 * el mundo a la vez**. Cada usuario rota una vez por ciclo de token, así que
 * el techo salía en torno a treinta usuarios concurrentes; pasado eso, el
 * refresco de cualquiera empezaba a devolver `429`, su token vencía sin
 * renovarse y el siguiente guardado moría.
 *
 * ## Qué cambia y qué no
 *
 * Cuando hay `refresh_token` en las cookies, la cuenta va por sesión: cada
 * usuario tiene su propio presupuesto y no gasta el de nadie.
 *
 * Cuando no lo hay, se cae al comportamiento de siempre. Eso deja **intacta la
 * protección donde importa**: `/auth/login` se llama sin cookie de sesión —es
 * lo que la crea—, así que sigue contando por IP y la barrera contra fuerza
 * bruta no se toca. Lo mismo para cualquier ruta pública.
 *
 * El efecto de fondo es que los endpoints autenticados pasan de contarse por
 * IP a contarse por sesión. Es lo que hace falta cuando todo el tráfico sale
 * por una sola IP —un servidor intermedio, o una faena entera detrás del mismo
 * NAT—, donde contar por IP castiga a los usuarios legítimos entre sí sin
 * frenar a nadie.
 */
@Injectable()
export class ThrottlerPorSesionGuard extends ThrottlerGuard {
  /**
   * La clave de conteo.
   *
   * Se usa el hash del token y nunca el token en crudo: la clave acaba en el
   * almacén del throttler, y un refresh token ahí dentro es un refresh token
   * fuera de la cookie httpOnly donde debe vivir. El algoritmo es el mismo que
   * usa `TokenService.hashToken` para guardarlo en base de datos.
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const refreshToken = (req?.cookies as Record<string, unknown> | undefined)
      ?.refresh_token;

    if (typeof refreshToken === 'string' && refreshToken.length > 0) {
      const hash = createHash('sha256').update(refreshToken).digest('hex');
      return `sesion:${hash}`;
    }

    return super.getTracker(req);
  }
}
