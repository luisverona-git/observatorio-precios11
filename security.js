import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const msg = (error) => ({ error });

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", 'https://cdnjs.cloudflare.com'],
      'style-src': ["'self'", 'https://cdnjs.cloudflare.com'],
      'img-src': ["'self'", 'data:', 'https://*.tile.openstreetmap.org', 'https://cdnjs.cloudflare.com'],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
});

export function limiters(opts = {}) {
  const api = rateLimit({ windowMs: 15 * 60 * 1000, limit: opts.api ?? 600, standardHeaders: true, legacyHeaders: false,
    message: msg('Demasiadas solicitudes. Intenta más tarde.') });
  // Fuerza bruta: pocos intentos de login por IP
  const login = rateLimit({ windowMs: 15 * 60 * 1000, limit: opts.login ?? 10, standardHeaders: true, legacyHeaders: false,
    message: msg('Demasiados intentos de ingreso. Espera 15 minutos.') });
  return { api, login };
}
