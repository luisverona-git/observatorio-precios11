import { Router } from 'express';
import { q } from '../db.js';
import { ah, bad, int, norm, notFound, oneOf } from '../util.js';

const STOP = new Set(['para', 'con', 'los', 'las', 'una', 'unos', 'del', 'que', 'por', 'quiero', 'necesito', 'ingredientes']);

// Factor para llevar el contenido a la unidad base (kg, l o un): permite comparar precio por unidad de medida
const FACTOR = `(CASE p.unidad_medida WHEN 'g' THEN p.contenido/1000.0 WHEN 'ml' THEN p.contenido/1000.0 ELSE p.contenido END)`;
const BASE = `(CASE p.unidad_medida WHEN 'g' THEN 'kg' WHEN 'kg' THEN 'kg' WHEN 'ml' THEN 'l' WHEN 'l' THEN 'l' ELSE 'un' END)`;

export default function publico() {
  const r = Router();

  r.get('/categorias', ah(async (_req, res) => {
    const { rows } = await q('SELECT id_categoria, nombre FROM categoria ORDER BY nombre');
    res.json(rows);
  }));

  // Busqueda tolerante: sinonimos/modismos (cazuela, marraqueta) + similitud de texto (faltas de ortografia)
  r.get('/productos', ah(async (req, res) => {
    const texto = norm(req.query.q || '').slice(0, 80);
    const cat = int(req.query.categoria, 'Categoría', { min: 1, opt: true });
    const palabras = texto.split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
    let ids = null;
    if (texto) {
      const found = new Set();
      const sin = await q(
        `SELECT DISTINCT id_producto FROM sinonimo WHERE $1 LIKE '%' || termino || '%'
            OR EXISTS (SELECT 1 FROM unnest($2::text[]) w WHERE similarity(termino, w) > 0.5)`, [texto, palabras]);
      sin.rows.forEach((x) => found.add(x.id_producto));
      if (palabras.length || texto.length >= 2) {
        const dir = await q(
          `SELECT id_producto FROM producto WHERE activo AND (busqueda ILIKE '%' || $1 || '%'
              OR EXISTS (SELECT 1 FROM unnest($2::text[]) w WHERE busqueda ILIKE '%' || w || '%' OR word_similarity(w, busqueda) > 0.45))`,
          [texto, palabras]);
        dir.rows.forEach((x) => found.add(x.id_producto));
      }
      ids = [...found];
      if (!ids.length) return res.json([]);
    }
    const { rows } = await q(
      `SELECT p.id_producto, p.nombre, p.marca, p.formato, p.unidad_medida, c.nombre AS categoria,
              MIN(v.valor_final) AS precio_min, MAX(v.valor_final) AS precio_max, COUNT(v.id_precio) AS locales
         FROM producto p JOIN categoria c USING (id_categoria)
         LEFT JOIN v_precio_vigente v ON v.id_producto = p.id_producto
        WHERE p.activo AND ($1::int[] IS NULL OR p.id_producto = ANY($1)) AND ($2::int IS NULL OR p.id_categoria = $2)
        GROUP BY p.id_producto, c.nombre ORDER BY p.nombre, p.formato`, [ids, cat]);
    res.json(rows);
  }));

  // Comparador: distingue formatos y muestra condiciones, fuente y fecha (transparencia)
  r.get('/productos/:id/precios', ah(async (req, res) => {
    const id = int(req.params.id, 'Producto', { min: 1 });
    const orden = oneOf(req.query.orden || 'precio', 'Orden', ['precio', 'distancia', 'vigencia']);
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    if ((lat !== null && !(lat >= -90 && lat <= 90)) || (lng !== null && !(lng >= -180 && lng <= 180))) throw bad('Ubicación inválida.');
    if (orden === 'distancia' && (lat === null || lng === null)) throw bad('Para ordenar por distancia debes indicar tu ubicación (lat y lng).');
    const { rows: prod } = await q(
      `SELECT p.id_producto, p.nombre, p.marca, p.formato, p.contenido, p.unidad_medida, ${BASE} AS unidad_base, c.nombre AS categoria
         FROM producto p JOIN categoria c USING (id_categoria) WHERE p.id_producto = $1 AND p.activo`, [id]);
    if (!prod[0]) throw notFound('Producto no encontrado.');
    const order = { precio: 'v.valor_final ASC, metros ASC NULLS LAST', distancia: 'metros ASC, v.valor_final ASC', vigencia: 'v.vigencia_hasta ASC NULLS LAST, v.valor_final ASC' }[orden];
    const { rows } = await q(
      `SELECT v.id_precio, s.id_sucursal, s.nombre AS sucursal, c.razon_social AS comercio, c.tipo, s.direccion, s.sector,
              ST_Y(s.ubicacion::geometry) AS lat, ST_X(s.ubicacion::geometry) AS lng,
              CASE WHEN $2::float IS NULL THEN NULL
                   ELSE ST_Distance(s.ubicacion, ST_SetSRID(ST_MakePoint($3::float, $2::float), 4326)::geography) END AS metros,
              v.valor_normal, v.valor_oferta, v.oferta_activa, v.valor_final, v.vigencia_desde, v.vigencia_hasta, v.condiciones,
              v.fuente, v.fecha_observacion,
              ROUND(v.valor_final / ${FACTOR}) AS precio_unitario
         FROM v_precio_vigente v
         JOIN producto p ON p.id_producto = v.id_producto
         JOIN sucursal s ON s.id_sucursal = v.id_sucursal AND s.activa
         JOIN comercio c ON c.id_comercio = s.id_comercio AND c.activo
        WHERE v.id_producto = $1
          AND ($4::text IS NULL OR c.tipo = $4) AND ($5::text IS NULL OR s.sector = $5) AND ($6::int IS NULL OR c.id_comercio = $6)
        ORDER BY ${order}`,
      [id, lat, lng, req.query.tipo || null, req.query.sector || null, int(req.query.comercio, 'Comercio', { min: 1, opt: true })]);
    res.json({ producto: prod[0], resultados: rows });
  }));

  r.get('/sucursales', ah(async (req, res) => {
    const cat = int(req.query.categoria, 'Categoría', { min: 1, opt: true });
    const com = int(req.query.comercio, 'Comercio', { min: 1, opt: true });
    const { rows } = await q(
      `SELECT s.id_sucursal, s.nombre, s.direccion, s.sector, c.id_comercio, c.razon_social AS comercio, c.tipo,
              ST_Y(s.ubicacion::geometry) AS lat, ST_X(s.ubicacion::geometry) AS lng,
              (SELECT COUNT(*) FROM v_precio_vigente v JOIN producto p USING (id_producto)
                WHERE v.id_sucursal = s.id_sucursal AND ($1::int IS NULL OR p.id_categoria = $1)) AS productos
         FROM sucursal s JOIN comercio c USING (id_comercio)
        WHERE s.activa AND c.activo AND ($2::int IS NULL OR c.id_comercio = $2) AND ($3::text IS NULL OR s.sector = $3)
          AND ($4::text IS NULL OR c.tipo = $4)
          AND ($1::int IS NULL OR EXISTS (SELECT 1 FROM v_precio_vigente v JOIN producto p USING (id_producto)
                                           WHERE v.id_sucursal = s.id_sucursal AND p.id_categoria = $1))
        ORDER BY s.nombre`, [cat, com, req.query.sector || null, req.query.tipo || null]);
    res.json(rows);
  }));

  r.get('/sucursales/:id', ah(async (req, res) => {
    const id = int(req.params.id, 'Sucursal', { min: 1 });
    const { rows: s } = await q(
      `SELECT s.id_sucursal, s.nombre, s.direccion, s.sector, c.razon_social AS comercio, c.tipo FROM sucursal s
         JOIN comercio c USING (id_comercio) WHERE s.id_sucursal = $1 AND s.activa`, [id]);
    if (!s[0]) throw notFound('Sucursal no encontrada.');
    const { rows } = await q(
      `SELECT p.id_producto, p.nombre, p.formato, v.valor_normal, v.valor_oferta, v.oferta_activa, v.valor_final, v.vigencia_hasta,
              v.condiciones, v.fuente, v.fecha_observacion
         FROM v_precio_vigente v JOIN producto p USING (id_producto) WHERE v.id_sucursal = $1 ORDER BY p.nombre`, [id]);
    res.json({ sucursal: s[0], precios: rows });
  }));

  // Historial: actualizar un precio NO borra los anteriores
  r.get('/productos/:id/historial', ah(async (req, res) => {
    const id = int(req.params.id, 'Producto', { min: 1 });
    const agg = oneOf(req.query.agrupar || 'week', 'Agrupación', ['week', 'month']);
    const dias = int(req.query.dias || 90, 'Días', { min: 7, max: 730 });
    const suc = int(req.query.sucursal, 'Sucursal', { min: 1, opt: true });
    const { rows } = await q(
      `SELECT date_trunc('${agg}', x.fecha_observacion)::date AS periodo, s.id_sucursal, s.nombre AS sucursal,
              ROUND(AVG(x.efectivo))::int AS valor, COUNT(*) AS observaciones
         FROM (SELECT pr.*, CASE WHEN pr.valor_oferta IS NOT NULL AND pr.fecha_observacion::date BETWEEN pr.vigencia_desde AND pr.vigencia_hasta
                                 THEN pr.valor_oferta ELSE pr.valor_normal END AS efectivo
                 FROM precio pr WHERE pr.id_producto = $1 AND pr.estado IN ('vigente','inactivo')
                  AND pr.fecha_observacion >= now() - make_interval(days => $2)) x
         JOIN sucursal s ON s.id_sucursal = x.id_sucursal
        WHERE ($3::int IS NULL OR s.id_sucursal = $3)
        GROUP BY 1, s.id_sucursal, s.nombre ORDER BY 1, s.nombre`, [id, dias, suc]);
    res.json({ unidad: 'CLP por formato del producto', agrupacion: agg === 'week' ? 'semanal' : 'mensual', dias, serie: rows });
  }));

  r.post('/canasta/comparar', ah(async (req, res) => {
    const ids = Array.isArray(req.body.productos) ? [...new Set(req.body.productos.map((x) => int(x, 'Producto', { min: 1 })))] : [];
    if (!ids.length || ids.length > 30) throw bad('Indica entre 1 y 30 productos.');
    const { rows } = await q(
      `SELECT s.id_sucursal, s.nombre AS sucursal, c.tipo, SUM(v.valor_final)::int AS total
         FROM v_precio_vigente v JOIN sucursal s ON s.id_sucursal = v.id_sucursal AND s.activa
         JOIN comercio c ON c.id_comercio = s.id_comercio AND c.activo
        WHERE v.id_producto = ANY($1) GROUP BY s.id_sucursal, s.nombre, c.tipo
       HAVING COUNT(DISTINCT v.id_producto) = $2 ORDER BY total`, [ids, ids.length]);
    res.json(rows);
  }));

  r.get('/transparencia', (_req, res) => res.json({
    metodo: 'Los precios son levantados por fiscalizadores municipales en terreno, ingresados por los propios comercios (formulario o planilla) o recibidos por API. Todo precio inusual o cargado en lote pasa por revisión de DIDESE antes de publicarse.',
    campos: 'Cada precio indica comercio y sucursal, fuente, fecha de observación, vigencia y condiciones de compra.',
    advertencia: 'La disponibilidad de stock no está confirmada: un precio publicado no garantiza que el producto esté disponible.',
    actualizacion: 'Los precios vigentes reemplazan al anterior, que se conserva en el historial. Las ofertas vencidas dejan de mostrarse automáticamente.'
  }));

  return r;
}
