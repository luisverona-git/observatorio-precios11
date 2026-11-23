import { q } from '../db.js';

// Indicadores del observatorio. Cada resultado incluye el periodo y los filtros usados.
export async function indicadores({ dias = 30, categoria = null } = {}) {
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - dias * 86400000);
  const { rows: productos } = await q(
    `WITH hist AS (
        SELECT pr.id_producto, pr.fecha_observacion,
               CASE WHEN pr.valor_oferta IS NOT NULL AND pr.fecha_observacion::date BETWEEN pr.vigencia_desde AND pr.vigencia_hasta
                    THEN pr.valor_oferta ELSE pr.valor_normal END AS ef
          FROM precio pr JOIN producto p USING (id_producto)
         WHERE pr.estado IN ('vigente','inactivo') AND pr.fecha_observacion >= now() - make_interval(days => $1 * 2)
           AND ($2::int IS NULL OR p.id_categoria = $2)),
      act AS (SELECT id_producto, AVG(ef) a FROM hist WHERE fecha_observacion >= now() - make_interval(days => $1) GROUP BY 1),
      prev AS (SELECT id_producto, AVG(ef) a FROM hist WHERE fecha_observacion < now() - make_interval(days => $1) GROUP BY 1)
     SELECT p.id_producto, p.nombre, p.formato, c.nombre AS categoria,
            ROUND(AVG(v.valor_final))::int AS promedio, MIN(v.valor_final) AS minimo, MAX(v.valor_final) AS maximo,
            COUNT(*) AS locales,
            CASE WHEN prev.a > 0 AND act.a IS NOT NULL THEN ROUND(((act.a - prev.a) / prev.a * 100)::numeric, 1) END AS variacion_pct
       FROM v_precio_vigente v JOIN producto p USING (id_producto) JOIN categoria c USING (id_categoria)
       LEFT JOIN act ON act.id_producto = p.id_producto LEFT JOIN prev ON prev.id_producto = p.id_producto
      WHERE ($2::int IS NULL OR p.id_categoria = $2)
      GROUP BY p.id_producto, p.nombre, p.formato, c.nombre, act.a, prev.a ORDER BY p.nombre, p.formato`, [dias, categoria]);
  const { rows: k } = await q(
    `SELECT (SELECT COUNT(DISTINCT id_producto) FROM v_precio_vigente) AS productos_monitoreados,
            (SELECT COUNT(DISTINCT id_sucursal) FROM v_precio_vigente) AS sucursales_con_precios,
            (SELECT COUNT(*) FROM sucursal WHERE activa) AS sucursales_activas,
            (SELECT COUNT(*) FROM v_precio_vigente WHERE oferta_activa) AS ofertas_vigentes,
            (SELECT COUNT(*) FROM alerta WHERE estado = 'pendiente') AS alertas_pendientes`);
  const kp = k[0];
  return {
    periodo: { dias, desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10) },
    filtros: { categoria },
    unidades: 'CLP por formato del producto (el precio por kg/l/un se ve en el comparador)',
    kpis: { ...kp, cobertura_pct: kp.sucursales_activas ? Math.round((kp.sucursales_con_precios / kp.sucursales_activas) * 100) : 0 },
    productos
  };
}
