import { q } from '../db.js';
import { bad, conflict, forbidden, notFound, int, str, date, today } from '../util.js';
import { audit } from './auditoria.js';

// ¿Puede este usuario registrar precios en esta sucursal?
export function puedeEscribir(user, suc) {
  if (user.rol === 'admin' || user.rol === 'fiscalizador') return true;
  if (user.rol === 'comercio') return user.id_comercio != null && user.id_comercio === suc.id_comercio;
  if (user.rol === 'sucursal') return user.id_sucursal != null && user.id_sucursal === suc.id_sucursal;
  return false;
}

// Valida y normaliza la entrada de un precio. Lanza errores 400 con mensajes claros.
export function validarEntrada(b) {
  const out = {
    id_producto: int(b.id_producto, 'Producto', { min: 1 }),
    id_sucursal: int(b.id_sucursal, 'Sucursal', { min: 1 }),
    valor_normal: int(b.valor_normal, 'Precio normal', { min: 1, max: 1000000 }),
    valor_oferta: int(b.valor_oferta, 'Precio de oferta', { min: 1, max: 1000000, opt: true }),
    vigencia_desde: date(b.vigencia_desde, 'Vigencia desde', { opt: true }),
    vigencia_hasta: date(b.vigencia_hasta, 'Vigencia hasta', { opt: true }),
    condiciones: str(b.condiciones, 'Condiciones', { max: 200, opt: true })
  };
  if (out.valor_oferta != null) {
    if (out.valor_oferta >= out.valor_normal) throw bad('El precio de oferta debe ser menor al precio normal.');
    if (!out.vigencia_desde || !out.vigencia_hasta) throw bad('Una oferta requiere fechas de vigencia (desde y hasta).');
    if (out.vigencia_hasta < out.vigencia_desde) throw bad('La vigencia hasta no puede ser anterior a la vigencia desde.');
    if (out.vigencia_hasta < today()) throw bad('La oferta ya está vencida: la fecha de término es anterior a hoy.');
  } else {
    out.vigencia_desde = null; out.vigencia_hasta = null;
  }
  return out;
}

// Detecta valores sospechosos ("dedo gordo"): lejos de la mediana del producto o de un salto brusco en la misma sucursal
export async function detectarAnomalia(db, { id_producto, id_sucursal, valor_normal }) {
  const { rows: otros } = await db.query(
    `SELECT valor_normal FROM precio WHERE id_producto = $1 AND estado = 'vigente' AND id_sucursal <> $2`,
    [id_producto, id_sucursal]);
  if (otros.length >= 2) {
    const a = otros.map((r) => r.valor_normal).sort((x, y) => x - y);
    const med = a[Math.floor(a.length / 2)];
    if (valor_normal > med * 3 || valor_normal < med / 3) {
      return { motivo: 'fuera_de_rango', detalle: `El valor $${valor_normal} está muy lejos de la mediana comunal ($${med}).` };
    }
  }
  const { rows: prev } = await db.query(
    `SELECT valor_normal FROM precio WHERE id_producto = $1 AND id_sucursal = $2 AND estado = 'vigente'`,
    [id_producto, id_sucursal]);
  if (prev[0]) {
    const p = prev[0].valor_normal;
    if (valor_normal > p * 2 || valor_normal < p / 2) {
      return { motivo: 'salto_brusco', detalle: `El valor $${valor_normal} cambia más de 50% respecto del vigente ($${p}).` };
    }
  }
  return null;
}

// Publica un precio (vigente) o lo retiene para revision (anomalia o carga masiva).
// Debe llamarse dentro de una transaccion (db = client).
export async function registrarPrecio(db, user, input, { fuente = 'formulario', id_carga = null, forzarRetencion = false } = {}) {
  const { rows: s } = await db.query(
    'SELECT id_sucursal, id_comercio, activa FROM sucursal WHERE id_sucursal = $1', [input.id_sucursal]);
  if (!s[0] || !s[0].activa) throw notFound('La sucursal no existe o está inactiva.');
  if (!puedeEscribir(user, s[0])) throw forbidden('Solo puedes registrar precios de tu propio comercio o sucursal.');
  const { rows: p } = await db.query('SELECT id_producto FROM producto WHERE id_producto = $1 AND activo', [input.id_producto]);
  if (!p[0]) throw notFound('El producto no existe en el catálogo.');

  // Duplicado exacto del precio vigente
  const { rows: dup } = await db.query(
    `SELECT id_precio FROM precio WHERE id_producto=$1 AND id_sucursal=$2 AND estado='vigente'
        AND valor_normal=$3 AND valor_oferta IS NOT DISTINCT FROM $4 AND vigencia_hasta IS NOT DISTINCT FROM $5::date`,
    [input.id_producto, input.id_sucursal, input.valor_normal, input.valor_oferta, input.vigencia_hasta]);
  if (dup[0]) throw conflict('Ese precio ya está registrado como vigente (duplicado).');

  const anomalia = await detectarAnomalia(db, input);
  const retener = forzarRetencion || !!anomalia;
  const estadoOferta = input.valor_oferta != null ? 'activa' : 'ninguna';

  if (!retener) {
    await db.query(`UPDATE precio SET estado = 'inactivo' WHERE id_producto=$1 AND id_sucursal=$2 AND estado='vigente'`,
      [input.id_producto, input.id_sucursal]);
  }
  const { rows } = await db.query(
    `INSERT INTO precio (id_producto,id_sucursal,id_usuario,id_carga,valor_normal,valor_oferta,vigencia_desde,vigencia_hasta,
                         condiciones,fuente,estado,estado_oferta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id_precio, estado`,
    [input.id_producto, input.id_sucursal, user.id_usuario, id_carga, input.valor_normal, input.valor_oferta,
      input.vigencia_desde, input.vigencia_hasta, input.condiciones, fuente, retener ? 'retenido' : 'vigente', estadoOferta]);
  const id_precio = rows[0].id_precio;

  let id_alerta = null;
  if (retener) {
    const tipo = anomalia ? 'anomalia' : 'carga_masiva';
    const det = anomalia ? { motivo: anomalia.motivo, texto: anomalia.detalle } : { motivo: 'carga_masiva', texto: 'Precio cargado en lote pendiente de aprobación.' };
    const r = await db.query(
      `INSERT INTO alerta (tipo,id_precio,id_sucursal,id_producto,detalle) VALUES ($1,$2,$3,$4,$5) RETURNING id_alerta`,
      [tipo, id_precio, input.id_sucursal, input.id_producto, JSON.stringify(det)]);
    id_alerta = r.rows[0].id_alerta;
  }
  await audit(db, user.id_usuario, retener ? 'RETENER' : 'CREAR', 'precio', id_precio, null, { ...input, fuente, estado: retener ? 'retenido' : 'vigente' });
  return { id_precio, estado: retener ? 'retenido' : 'vigente', id_alerta, motivo: anomalia?.detalle ?? null };
}

// Aprueba o rechaza un precio retenido (solo administrador)
export async function resolverAlerta(db, user, id_alerta, aprobar) {
  const { rows } = await db.query('SELECT * FROM alerta WHERE id_alerta = $1 FOR UPDATE', [id_alerta]);
  const a = rows[0];
  if (!a) throw notFound('La alerta no existe.');
  if (a.estado !== 'pendiente') throw conflict('La alerta ya fue resuelta.');
  if (a.id_precio) {
    if (aprobar) {
      await db.query(`UPDATE precio SET estado='inactivo' WHERE id_producto=$1 AND id_sucursal=$2 AND estado='vigente'`, [a.id_producto, a.id_sucursal]);
      await db.query(`UPDATE precio SET estado='vigente' WHERE id_precio=$1`, [a.id_precio]);
    } else {
      await db.query(`UPDATE precio SET estado='rechazado' WHERE id_precio=$1`, [a.id_precio]);
    }
  }
  await db.query(`UPDATE alerta SET estado=$2, resuelta=now() WHERE id_alerta=$1`, [id_alerta, aprobar ? 'aprobada' : 'rechazada']);
  await audit(db, user.id_usuario, aprobar ? 'APROBAR' : 'RECHAZAR', 'alerta', id_alerta, { estado: 'pendiente', id_precio: a.id_precio }, { estado: aprobar ? 'aprobada' : 'rechazada' });
  return { id_alerta, estado: aprobar ? 'aprobada' : 'rechazada' };
}
