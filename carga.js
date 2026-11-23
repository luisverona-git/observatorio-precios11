import { Router } from 'express';
import express from 'express';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { q, tx } from '../db.js';
import { ah, bad, HttpError } from '../util.js';
import { requireRole } from '../middleware/auth.js';
import { registrarPrecio, validarEntrada, puedeEscribir } from '../services/precios.js';
import { audit } from '../services/auditoria.js';

const COLS = ['producto_id', 'sucursal_id', 'precio_normal', 'precio_oferta', 'vigencia_desde', 'vigencia_hasta', 'condiciones'];
const MAX_FILAS = 2000;

const celda = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && 'result' in v) return celda(v.result);
  if (typeof v === 'object' && 'text' in v) return String(v.text);
  return String(v).trim();
};

// Lee CSV (texto) o XLSX (base64) y devuelve filas con las columnas de la plantilla
async function leerArchivo({ nombre, formato, contenido }) {
  if (!contenido || typeof contenido !== 'string') throw bad('Debes enviar el contenido del archivo.');
  let filas;
  if (formato === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(Buffer.from(contenido, 'base64')); } catch { throw bad('El archivo Excel no se pudo leer.'); }
    const ws = wb.worksheets[0];
    if (!ws) throw bad('El archivo Excel no tiene hojas.');
    const head = ws.getRow(1).values.slice(1).map((h) => celda(h).toLowerCase());
    filas = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return;
      const o = {};
      head.forEach((h, i) => { o[h] = celda(row.getCell(i + 1).value); });
      filas.push(o);
    });
  } else {
    try {
      filas = parse(contenido, { columns: (h) => h.map((x) => String(x).trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true, relax_column_count: false });
    } catch { throw bad('El CSV está mal formado (revisa comas, comillas y que todas las filas tengan las mismas columnas).'); }
  }
  if (!filas.length) throw bad('El archivo no tiene filas de datos.');
  if (filas.length > MAX_FILAS) throw bad(`El archivo supera el máximo de ${MAX_FILAS} filas.`);
  const faltan = COLS.filter((c) => c !== 'condiciones' && !(c in filas[0]));
  if (faltan.length) throw bad(`Faltan columnas obligatorias: ${faltan.join(', ')}. Descarga la plantilla.`);
  return filas;
}

const aEntrada = (f) => validarEntrada({
  id_producto: f.producto_id, id_sucursal: f.sucursal_id, valor_normal: f.precio_normal, valor_oferta: f.precio_oferta,
  vigencia_desde: f.vigencia_desde, vigencia_hasta: f.vigencia_hasta, condiciones: f.condiciones
});

// Valida fila por fila (sin escribir) y entrega el informe de errores por fila
async function validarFilas(user, filas) {
  const vistos = new Set();
  const ok = []; const errores = [];
  for (let i = 0; i < filas.length; i++) {
    const nFila = i + 2; // fila 1 = encabezado
    try {
      const e = aEntrada(filas[i]);
      const k = `${e.id_producto}-${e.id_sucursal}`;
      if (vistos.has(k)) throw bad('Fila duplicada dentro del archivo (mismo producto y sucursal).');
      vistos.add(k);
      const { rows: s } = await q('SELECT id_sucursal, id_comercio, activa FROM sucursal WHERE id_sucursal = $1', [e.id_sucursal]);
      if (!s[0] || !s[0].activa) throw bad('La sucursal no existe o está inactiva.');
      if (!puedeEscribir(user, s[0])) throw bad('No tienes permiso para registrar precios en esa sucursal.');
      const { rows: p } = await q('SELECT 1 FROM producto WHERE id_producto = $1 AND activo', [e.id_producto]);
      if (!p[0]) throw bad('El producto no existe en el catálogo.');
      ok.push({ fila: nFila, entrada: e });
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      errores.push({ fila: nFila, error: err.message });
    }
  }
  return { ok, errores };
}

export default function carga() {
  const r = Router();
  const rol = requireRole('admin', 'comercio');
  const big = express.json({ limit: '6mb' });

  r.get('/carga/plantilla.csv', rol, (_req, res) => {
    res.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="plantilla_precios.csv"');
    res.send('\ufeff' + COLS.join(',') + '\n1,1,890,790,2026-11-20,2026-11-30,"Compra mínima 2 kg"\n2,1,790,,,,\n');
  });

  // Vista previa: valida sin guardar
  r.post('/carga/previsualizar', rol, big, ah(async (req, res) => {
    const filas = await leerArchivo(req.body);
    const { ok, errores } = await validarFilas(req.user, filas);
    res.json({ total: filas.length, validas: ok.length, con_error: errores.length, errores: errores.slice(0, 200),
      muestra: ok.slice(0, 5).map((x) => ({ fila: x.fila, ...x.entrada })) });
  }));

  // Confirmacion: las filas validas quedan RETENIDAS y siguen el flujo de aprobacion de DIDESE
  r.post('/carga/confirmar', rol, big, ah(async (req, res) => {
    const filas = await leerArchivo(req.body);
    const { ok, errores } = await validarFilas(req.user, filas);
    if (!ok.length) throw bad('No hay filas válidas para cargar. Revisa el informe de errores.');
    const nombre = String(req.body.nombre || 'archivo').slice(0, 120);
    const out = await tx(async (db) => {
      const c = await db.query(
        `INSERT INTO carga_masiva (id_usuario,archivo,total,aceptadas,con_error,errores) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id_carga`,
        [req.user.id_usuario, nombre, filas.length, ok.length, errores.length, JSON.stringify(errores.slice(0, 200))]);
      const id_carga = c.rows[0].id_carga;
      let retenidos = 0; let duplicadosBD = 0;
      for (const f of ok) {
        try {
          await db.query('SAVEPOINT fila');
          await registrarPrecio(db, req.user, f.entrada, { fuente: 'carga_masiva', id_carga, forzarRetencion: true });
          await db.query('RELEASE SAVEPOINT fila');
          retenidos++;
        } catch (err) {
          await db.query('ROLLBACK TO SAVEPOINT fila');
          if (err instanceof HttpError) { errores.push({ fila: f.fila, error: err.message }); duplicadosBD++; } else throw err;
        }
      }
      await db.query('UPDATE carga_masiva SET aceptadas=$2, con_error=$3, errores=$4 WHERE id_carga=$1',
        [id_carga, retenidos, errores.length, JSON.stringify(errores.slice(0, 200))]);
      await audit(db, req.user.id_usuario, 'CARGAR', 'carga_masiva', id_carga, null, { archivo: nombre, total: filas.length, retenidos, con_error: errores.length });
      return { id_carga, total: filas.length, enviadas_a_aprobacion: retenidos, con_error: errores.length, errores: errores.slice(0, 200) };
    });
    res.status(202).json(out);
  }));

  return r;
}
