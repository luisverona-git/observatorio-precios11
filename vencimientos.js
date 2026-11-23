import { q } from '../db.js';

// Desactiva ofertas vencidas: se conserva el registro (historial) y deja de mostrarse como oferta activa
export async function desactivarVencidas() {
  const { rowCount } = await q(
    `UPDATE precio SET estado_oferta = 'vencida'
      WHERE valor_oferta IS NOT NULL AND estado_oferta = 'activa' AND vigencia_hasta < CURRENT_DATE`);
  return rowCount;
}

// Equivalente a la tarea nocturna del diseno: corre al iniciar y cada hora
export function programarVencimientos() {
  const run = () => desactivarVencidas().catch((e) => console.error('Error al desactivar ofertas:', e.message));
  run();
  const t = setInterval(run, 60 * 60 * 1000);
  t.unref();
  return t;
}
