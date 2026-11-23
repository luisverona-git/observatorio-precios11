import { Router } from 'express';
import { q, tx } from '../db.js';
import { ah, bad, conflict, int, norm, notFound, num, oneOf, str } from '../util.js';
import { requireRole } from '../middleware/auth.js';
import { hashPassword } from '../middleware/auth.js';
import { audit } from '../services/auditoria.js';

const TIPOS = ['feria', 'almacen', 'supermercado', 'panaderia', 'farmacia', 'otro'];
const UNIDADES = ['kg', 'g', 'l', 'ml', 'un'];
const ROLES = ['admin', 'fiscalizador', 'comercio', 'sucursal', 'vecino'];

const claveProducto = (n, m, f) => norm(`${n}|${m || ''}|${f}`).replace(/ /g, '');

function productoInput(b) {
  const o = {
    id_categoria: int(b.id_categoria, 'Categoría', { min: 1 }),
    nombre: str(b.nombre, 'Nombre', { max: 80 }),
    marca: str(b.marca, 'Marca', { max: 60, opt: true }),
    formato: str(b.formato, 'Formato', { max: 40 }),
    contenido: num(b.contenido, 'Contenido', { min: 0.001, max: 100000 }),
    unidad_medida: oneOf(b.unidad_medida, 'Unidad de medida', UNIDADES)
  };
  o.clave = claveProducto(o.nombre, o.marca, o.formato);
  o.busqueda = norm(`${o.nombre} ${o.marca || ''}`);
  return o;
}

export default function admin() {
  const r = Router();
  const solo = requireRole('admin');

  // ---- Catalogo de productos ----
  r.get('/admin/productos', solo, ah(async (_req, res) => {
    const { rows } = await q(`SELECT p.*, c.nombre AS categoria FROM producto p JOIN categoria c USING (id_categoria) ORDER BY p.nombre, p.formato`);
    res.json(rows);
  }));
  r.post('/admin/productos', solo, ah(async (req, res) => {
    const o = productoInput(req.body);
    const out = await tx(async (db) => {
      const dup = await db.query('SELECT id_producto FROM producto WHERE clave = $1', [o.clave]);
      if (dup.rows[0]) throw conflict('Ya existe un producto con el mismo nombre, marca y formato (duplicado).');
      const { rows } = await db.query(
        `INSERT INTO producto (id_categoria,nombre,marca,formato,contenido,unidad_medida,clave,busqueda)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_producto`,
        [o.id_categoria, o.nombre, o.marca, o.formato, o.contenido, o.unidad_medida, o.clave, o.busqueda]);
      await audit(db, req.user.id_usuario, 'CREAR', 'producto', rows[0].id_producto, null, o);
      return rows[0];
    });
    res.status(201).json(out);
  }));
  r.put('/admin/productos/:id', solo, ah(async (req, res) => {
    const id = int(req.params.id, 'Producto', { min: 1 });
    const o = productoInput(req.body);
    const activo = req.body.activo === undefined ? true : !!req.body.activo;
    await tx(async (db) => {
      const prev = await db.query('SELECT * FROM producto WHERE id_producto = $1', [id]);
      if (!prev.rows[0]) throw notFound('Producto no encontrado.');
      const dup = await db.query('SELECT id_producto FROM producto WHERE clave = $1 AND id_producto <> $2', [o.clave, id]);
      if (dup.rows[0]) throw conflict('Ya existe otro producto con el mismo nombre, marca y formato (duplicado).');
      await db.query(
        `UPDATE producto SET id_categoria=$2,nombre=$3,marca=$4,formato=$5,contenido=$6,unidad_medida=$7,clave=$8,busqueda=$9,activo=$10 WHERE id_producto=$1`,
        [id, o.id_categoria, o.nombre, o.marca, o.formato, o.contenido, o.unidad_medida, o.clave, o.busqueda, activo]);
      await audit(db, req.user.id_usuario, 'EDITAR', 'producto', id, prev.rows[0], { ...o, activo });
    });
    res.json({ id_producto: id });
  }));

  // ---- Comercios y sucursales ----
  r.get('/admin/comercios', solo, ah(async (_req, res) => {
    const { rows } = await q(
      `SELECT c.*, (SELECT COUNT(*) FROM sucursal s WHERE s.id_comercio = c.id_comercio) AS sucursales FROM comercio c ORDER BY c.razon_social`);
    res.json(rows);
  }));
  r.post('/admin/comercios', solo, ah(async (req, res) => {
    const rut = str(req.body.rut, 'RUT', { max: 12 });
    if (!/^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/.test(rut)) throw bad('El RUT debe tener formato 12.345.678-9.');
    const razon = str(req.body.razon_social, 'Razón social', { max: 120 });
    const tipo = oneOf(req.body.tipo, 'Tipo de comercio', TIPOS);
    const out = await tx(async (db) => {
      const dup = await db.query('SELECT 1 FROM comercio WHERE rut = $1', [rut]);
      if (dup.rows[0]) throw conflict('Ya existe un comercio con ese RUT.');
      const { rows } = await db.query('INSERT INTO comercio (rut,razon_social,tipo) VALUES ($1,$2,$3) RETURNING id_comercio', [rut, razon, tipo]);
      await audit(db, req.user.id_usuario, 'CREAR', 'comercio', rows[0].id_comercio, null, { rut, razon, tipo });
      return rows[0];
    });
    res.status(201).json(out);
  }));
  r.put('/admin/comercios/:id/activo', solo, ah(async (req, res) => {
    const id = int(req.params.id, 'Comercio', { min: 1 });
    const activo = !!req.body.activo;
    await tx(async (db) => {
      const { rows } = await db.query('UPDATE comercio SET activo=$2 WHERE id_comercio=$1 RETURNING id_comercio', [id, activo]);
      if (!rows[0]) throw notFound('Comercio no encontrado.');
      await audit(db, req.user.id_usuario, activo ? 'ACTIVAR' : 'DESACTIVAR', 'comercio', id);
    });
    res.json({ id_comercio: id, activo });
  }));
  r.get('/admin/sucursales', solo, ah(async (_req, res) => {
    const { rows } = await q(
      `SELECT s.id_sucursal, s.id_comercio, c.razon_social AS comercio, s.nombre, s.direccion, s.sector, s.activa,
              ST_Y(s.ubicacion::geometry) AS lat, ST_X(s.ubicacion::geometry) AS lng
         FROM sucursal s JOIN comercio c USING (id_comercio) ORDER BY c.razon_social, s.nombre`);
    res.json(rows);
  }));
  r.post('/admin/sucursales', solo, ah(async (req, res) => {
    const o = {
      id_comercio: int(req.body.id_comercio, 'Comercio', { min: 1 }),
      nombre: str(req.body.nombre, 'Nombre', { max: 120 }),
      direccion: str(req.body.direccion, 'Dirección', { max: 160 }),
      sector: str(req.body.sector, 'Sector', { max: 40 }),
      lat: num(req.body.lat, 'Latitud', { min: -90, max: 90 }),
      lng: num(req.body.lng, 'Longitud', { min: -180, max: 180 })
    };
    const out = await tx(async (db) => {
      const c = await db.query('SELECT 1 FROM comercio WHERE id_comercio = $1', [o.id_comercio]);
      if (!c.rows[0]) throw notFound('El comercio no existe.');
      const { rows } = await db.query(
        `INSERT INTO sucursal (id_comercio,nombre,direccion,sector,ubicacion) VALUES ($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($6,$5),4326)::geography)
         RETURNING id_sucursal`, [o.id_comercio, o.nombre, o.direccion, o.sector, o.lat, o.lng]);
      await audit(db, req.user.id_usuario, 'CREAR', 'sucursal', rows[0].id_sucursal, null, o);
      return rows[0];
    });
    res.status(201).json(out);
  }));
  r.put('/admin/sucursales/:id/activa', solo, ah(async (req, res) => {
    const id = int(req.params.id, 'Sucursal', { min: 1 });
    const activa = !!req.body.activa;
    await tx(async (db) => {
      const { rows } = await db.query('UPDATE sucursal SET activa=$2 WHERE id_sucursal=$1 RETURNING id_sucursal', [id, activa]);
      if (!rows[0]) throw notFound('Sucursal no encontrada.');
      await audit(db, req.user.id_usuario, activa ? 'ACTIVAR' : 'DESACTIVAR', 'sucursal', id);
    });
    res.json({ id_sucursal: id, activa });
  }));

  // ---- Usuarios y roles ----
  r.get('/admin/usuarios', solo, ah(async (_req, res) => {
    const { rows } = await q(
      `SELECT u.id_usuario, u.email, u.nombre, r.nombre AS rol, u.id_comercio, u.id_sucursal, u.activo, u.creado
         FROM usuario u JOIN rol r USING (id_rol) ORDER BY u.creado DESC`);
    res.json(rows);
  }));
  r.post('/admin/usuarios', solo, ah(async (req, res) => {
    const email = str(req.body.email, 'Correo', { max: 120 }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('El correo no es válido.');
    const nombre = str(req.body.nombre, 'Nombre', { max: 80 });
    const password = str(req.body.password, 'Contraseña', { max: 200 });
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw bad('La contraseña debe tener al menos 8 caracteres, con letras y números.');
    const rol = oneOf(req.body.rol, 'Rol', ROLES);
    const id_comercio = int(req.body.id_comercio, 'Comercio', { min: 1, opt: true });
    const id_sucursal = int(req.body.id_sucursal, 'Sucursal', { min: 1, opt: true });
    if (rol === 'comercio' && !id_comercio) throw bad('Un usuario de comercio debe tener un comercio asignado.');
    if (rol === 'sucursal' && !id_sucursal) throw bad('Un usuario de sucursal debe tener una sucursal asignada.');
    const out = await tx(async (db) => {
      const dup = await db.query('SELECT 1 FROM usuario WHERE email = $1', [email]);
      if (dup.rows[0]) throw conflict('Ya existe un usuario con ese correo.');
      const { rows } = await db.query(
        `INSERT INTO usuario (email,nombre,password_hash,id_rol,id_comercio,id_sucursal)
         VALUES ($1,$2,$3,(SELECT id_rol FROM rol WHERE nombre=$4),$5,$6) RETURNING id_usuario`,
        [email, nombre, hashPassword(password), rol, id_comercio, id_sucursal]);
      await audit(db, req.user.id_usuario, 'CREAR', 'usuario', rows[0].id_usuario, null, { email, rol, id_comercio, id_sucursal });
      return rows[0];
    });
    res.status(201).json(out);
  }));
  r.put('/admin/usuarios/:id/activo', solo, ah(async (req, res) => {
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw bad('Identificador inválido.');
    if (id === req.user.id_usuario) throw bad('No puedes desactivar tu propia cuenta.');
    const activo = !!req.body.activo;
    await tx(async (db) => {
      const { rows } = await db.query('UPDATE usuario SET activo=$2 WHERE id_usuario=$1 RETURNING id_usuario', [id, activo]);
      if (!rows[0]) throw notFound('Usuario no encontrado.');
      await audit(db, req.user.id_usuario, activo ? 'ACTIVAR' : 'DESACTIVAR', 'usuario', id);
    });
    res.json({ id_usuario: id, activo });
  }));

  // ---- Auditoria (solo lectura, restringida a administradores) ----
  r.get('/admin/auditoria', solo, ah(async (req, res) => {
    const limite = int(req.query.limite || 100, 'Límite', { min: 1, max: 500 });
    const { rows } = await q(
      `SELECT l.id_log, l.fecha, l.accion, l.entidad, l.id_entidad, l.valor_previo, l.valor_nuevo, u.email AS usuario
         FROM log_auditoria l LEFT JOIN usuario u USING (id_usuario) ORDER BY l.id_log DESC LIMIT $1`, [limite]);
    res.json(rows);
  }));

  return r;
}
