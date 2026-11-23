import { Router } from 'express';
import { q, tx } from '../db.js';
import { ah, bad, int, str, notFound, conflict } from '../util.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { registrarPrecio, resolverAlerta, validarEntrada } from '../services/precios.js';
import { audit } from '../services/auditoria.js';
import { desactivarVencidas } from '../services/vencimientos.js';

export default function staff() {
  const r = Router();
  const escribe = requireRole('admin', 'fiscalizador', 'comercio', 'sucursal');

  // Registro de precio y oferta (formulario). Retiene automaticamente los valores sospechosos.
  r.post('/precios', escribe, ah(async (req, res) => {
    const input = validarEntrada(req.body);
    const fuente = req.user.rol === 'fiscalizador' ? 'terreno' : 'formulario';
    const out = await tx((db) => registrarPrecio(db, req.user, input, { fuente }));
    res.status(out.estado === 'vigente' ? 201 : 202).json(out);
  }));

  // Lista de precios que el usuario puede gestionar (segun su alcance)
  r.get('/precios/mios', escribe, ah(async (req, res) => {
    const { rol, id_comercio, id_sucursal } = req.user;
    const { rows } = await q(
      `SELECT pr.id_precio, p.nombre AS producto, p.formato, s.nombre AS sucursal, pr.valor_normal, pr.valor_oferta,
              pr.vigencia_hasta, pr.estado, pr.fuente, pr.fecha_observacion, pr.condiciones
         FROM precio pr JOIN producto p USING (id_producto) JOIN sucursal s USING (id_sucursal)
        WHERE ($1 IN ('admin','fiscalizador') OR ($1 = 'comercio' AND s.id_comercio = $2) OR ($1 = 'sucursal' AND s.id_sucursal = $3))
        ORDER BY pr.creado DESC LIMIT 50`, [rol, id_comercio, id_sucursal]);
    res.json(rows);
  }));

  // Sucursales sobre las que el usuario puede escribir (para los formularios)
  r.get('/mis-sucursales', escribe, ah(async (req, res) => {
    const { rol, id_comercio, id_sucursal } = req.user;
    const { rows } = await q(
      `SELECT s.id_sucursal, s.nombre FROM sucursal s
        WHERE s.activa AND ($1 IN ('admin','fiscalizador') OR ($1 = 'comercio' AND s.id_comercio = $2) OR ($1 = 'sucursal' AND s.id_sucursal = $3))
        ORDER BY s.nombre`, [rol, id_comercio, id_sucursal]);
    res.json(rows);
  }));

  // Reporte ciudadano: "el precio en el local es distinto" -> tarea para el fiscalizador
  r.post('/reportes', requireAuth, ah(async (req, res) => {
    const id_producto = int(req.body.id_producto, 'Producto', { min: 1 });
    const id_sucursal = int(req.body.id_sucursal, 'Sucursal', { min: 1 });
    const valor = int(req.body.valor_observado, 'Precio observado', { min: 1, max: 1000000, opt: true });
    const comentario = str(req.body.comentario, 'Comentario', { max: 200, opt: true });
    const out = await tx(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO alerta (tipo,id_sucursal,id_producto,detalle,id_usuario) VALUES ('reporte',$1,$2,$3,$4) RETURNING id_alerta`,
        [id_sucursal, id_producto, JSON.stringify({ valor_observado: valor, comentario }), req.user.id_usuario]);
      await audit(db, req.user.id_usuario, 'REPORTAR', 'alerta', rows[0].id_alerta, null, { id_producto, id_sucursal, valor });
      return rows[0];
    });
    res.status(201).json(out);
  }));

  // Revision de alertas: el fiscalizador ve reportes; el admin ve todo y resuelve precios retenidos
  r.get('/alertas', requireRole('admin', 'fiscalizador'), ah(async (req, res) => {
    const soloReportes = req.user.rol === 'fiscalizador';
    const { rows } = await q(
      `SELECT a.id_alerta, a.tipo, a.estado, a.detalle, a.creada, p.nombre AS producto, p.formato, s.nombre AS sucursal,
              pr.valor_normal, pr.valor_oferta, pr.id_precio
         FROM alerta a LEFT JOIN producto p USING (id_producto) LEFT JOIN sucursal s USING (id_sucursal) LEFT JOIN precio pr USING (id_precio)
        WHERE a.estado = 'pendiente' AND ($1::boolean = false OR a.tipo = 'reporte')
        ORDER BY a.creada DESC LIMIT 200`, [soloReportes]);
    res.json(rows);
  }));

  r.post('/alertas/:id/aprobar', requireRole('admin'), ah(async (req, res) => {
    res.json(await tx((db) => resolverAlerta(db, req.user, int(req.params.id, 'Alerta', { min: 1 }), true)));
  }));
  r.post('/alertas/:id/rechazar', requireRole('admin'), ah(async (req, res) => {
    res.json(await tx((db) => resolverAlerta(db, req.user, int(req.params.id, 'Alerta', { min: 1 }), false)));
  }));
  // Un reporte ciudadano lo cierra el fiscalizador tras verificar en terreno
  r.post('/alertas/:id/cerrar', requireRole('admin', 'fiscalizador'), ah(async (req, res) => {
    const id = int(req.params.id, 'Alerta', { min: 1 });
    await tx(async (db) => {
      const { rows } = await db.query(`UPDATE alerta SET estado='aprobada', resuelta=now() WHERE id_alerta=$1 AND tipo='reporte' AND estado='pendiente' RETURNING id_alerta`, [id]);
      if (!rows[0]) throw notFound('No hay un reporte pendiente con ese id.');
      await audit(db, req.user.id_usuario, 'CERRAR', 'alerta', id);
    });
    res.json({ id_alerta: id, estado: 'aprobada' });
  }));

  r.post('/vencimientos/ejecutar', requireRole('admin'), ah(async (req, res) => {
    const n = await desactivarVencidas();
    await audit({ query: q }, req.user.id_usuario, 'VENCER', 'precio', '-', null, { ofertas_desactivadas: n });
    res.json({ ofertas_desactivadas: n });
  }));

  return r;
}
