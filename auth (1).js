import { Router } from 'express';
import { q } from '../db.js';
import { ah, bad, HttpError, str } from '../util.js';
import { hashPassword, verifyPassword, signToken, requireAuth } from '../middleware/auth.js';
import { audit } from '../services/auditoria.js';

export default function authRoutes({ loginLimiter }) {
  const r = Router();

  r.post('/login', loginLimiter, ah(async (req, res) => {
    const email = str(req.body.email, 'Correo', { max: 120 }).toLowerCase();
    const password = str(req.body.password, 'Contraseña', { max: 200 });
    const { rows } = await q(
      `SELECT u.*, r.nombre AS rol FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE u.email = $1 AND u.activo`, [email]);
    // Mismo mensaje para usuario inexistente o clave incorrecta (no revela cuentas)
    if (!rows[0] || !verifyPassword(password, rows[0].password_hash)) throw new HttpError(401, 'Correo o contraseña incorrectos.');
    const u = rows[0];
    res.json({ token: signToken(u), usuario: { nombre: u.nombre, email: u.email, rol: u.rol, id_comercio: u.id_comercio, id_sucursal: u.id_sucursal } });
  }));

  // Registro ciudadano: siempre rol "vecino" (nadie puede auto-asignarse otro rol)
  r.post('/registro', loginLimiter, ah(async (req, res) => {
    const nombre = str(req.body.nombre, 'Nombre', { max: 80 });
    const email = str(req.body.email, 'Correo', { max: 120 }).toLowerCase();
    const password = str(req.body.password, 'Contraseña', { max: 200 });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('El correo no es válido.');
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw bad('La contraseña debe tener al menos 8 caracteres, con letras y números.');
    const { rows: ex } = await q('SELECT 1 FROM usuario WHERE email = $1', [email]);
    if (ex[0]) throw new HttpError(409, 'Ya existe una cuenta con ese correo.');
    const { rows } = await q(
      `INSERT INTO usuario (email,nombre,password_hash,id_rol) VALUES ($1,$2,$3,(SELECT id_rol FROM rol WHERE nombre='vecino'))
       RETURNING id_usuario`, [email, nombre, hashPassword(password)]);
    await audit({ query: q }, rows[0].id_usuario, 'CREAR', 'usuario', rows[0].id_usuario, null, { email, rol: 'vecino' });
    res.status(201).json({ ok: true });
  }));

  r.get('/me', requireAuth, (req, res) => {
    const { nombre, email, rol, id_comercio, id_sucursal } = req.user;
    res.json({ nombre, email, rol, id_comercio, id_sucursal });
  });
  return r;
}
