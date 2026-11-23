import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { q } from '../db.js';
import { HttpError, ah } from '../util.js';

// En produccion JWT_SECRET debe definirse; si falta se usa uno aleatorio (las sesiones se pierden al reiniciar)
const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  try {
    const [alg, saltHex, hashHex] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
  } catch { return false; }
}
export const signToken = (u) => jwt.sign({ sub: u.id_usuario }, SECRET, { expiresIn: '8h' });

// Carga req.user si viene un token valido (no obliga a autenticarse)
export const authOpcional = ah(async (req, _res, next) => {
  const h = req.get('authorization') || '';
  if (h.startsWith('Bearer ')) {
    try {
      const { sub } = jwt.verify(h.slice(7), SECRET);
      const { rows } = await q(
        `SELECT u.id_usuario, u.email, u.nombre, r.nombre AS rol, u.id_comercio, u.id_sucursal
           FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE u.id_usuario = $1 AND u.activo`, [sub]);
      if (rows[0]) req.user = rows[0];
    } catch { /* token invalido o vencido: se trata como anonimo */ }
  }
  next();
});

export const requireAuth = (req, _res, next) =>
  next(req.user ? undefined : new HttpError(401, 'Debes iniciar sesión.'));

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Debes iniciar sesión.'));
  if (!roles.includes(req.user.rol)) return next(new HttpError(403, 'No tienes permisos para esta acción.'));
  next();
};
