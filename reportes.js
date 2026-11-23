import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { ah, int } from '../util.js';
import { requireRole } from '../middleware/auth.js';
import { indicadores } from '../services/indicadores.js';
import { audit } from '../services/auditoria.js';
import { q } from '../db.js';

const filtros = (req) => ({ dias: int(req.query.dias || 30, 'Días', { min: 7, max: 365 }), categoria: int(req.query.categoria, 'Categoría', { min: 1, opt: true }) });
const FUENTE = 'Observatorio de Precios PAC (DIDESE) - precios levantados por fiscalizadores, comercios y cargas validadas';
const clp = (n) => (n == null ? '-' : '$' + Number(n).toLocaleString('es-CL'));

export default function reportes() {
  const r = Router();
  const solo = requireRole('admin');

  r.get('/admin/indicadores', solo, ah(async (req, res) => res.json(await indicadores(filtros(req)))));

  r.get('/admin/reportes/indicadores.xlsx', solo, ah(async (req, res) => {
    const d = await indicadores(filtros(req));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Indicadores');
    ws.columns = [{ header: 'Producto', width: 28 }, { header: 'Formato', width: 18 }, { header: 'Categoría', width: 20 },
      { header: 'Promedio (CLP)', width: 16 }, { header: 'Mínimo (CLP)', width: 14 }, { header: 'Máximo (CLP)', width: 14 },
      { header: 'Locales', width: 10 }, { header: 'Variación (%)', width: 14 }];
    ws.getRow(1).font = { bold: true };
    d.productos.forEach((p) => ws.addRow([p.nombre, p.formato, p.categoria, p.promedio, p.minimo, p.maximo, p.locales, p.variacion_pct]));
    const m = wb.addWorksheet('Metadatos');
    [['Fecha de generación', new Date().toISOString()], ['Período analizado', `${d.periodo.desde} a ${d.periodo.hasta} (${d.periodo.dias} días)`],
      ['Filtro categoría', d.filtros.categoria ?? 'todas'], ['Unidades', d.unidades], ['Fuente', FUENTE],
      ['Productos monitoreados', d.kpis.productos_monitoreados], ['Ofertas vigentes', d.kpis.ofertas_vigentes], ['Cobertura de sucursales (%)', d.kpis.cobertura_pct]]
      .forEach((row) => m.addRow(row));
    m.getColumn(1).width = 28; m.getColumn(2).width = 80; m.getColumn(1).font = { bold: true };
    await audit({ query: q }, req.user.id_usuario, 'EXPORTAR', 'reporte', 'xlsx', null, d.filtros);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .set('Content-Disposition', 'attachment; filename="indicadores_observatorio.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  }));

  r.get('/admin/reportes/indicadores.pdf', solo, ah(async (req, res) => {
    const d = await indicadores(filtros(req));
    await audit({ query: q }, req.user.id_usuario, 'EXPORTAR', 'reporte', 'pdf', null, d.filtros);
    res.set('Content-Type', 'application/pdf').set('Content-Disposition', 'attachment; filename="indicadores_observatorio.pdf"');
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);
    doc.fontSize(16).text('Observatorio de Precios - Pedro Aguirre Cerda');
    doc.fontSize(11).text('Informe de indicadores').moveDown(0.5);
    doc.fontSize(9).text(`Fecha de generación: ${new Date().toLocaleString('es-CL')}`)
      .text(`Período analizado: ${d.periodo.desde} a ${d.periodo.hasta} (${d.periodo.dias} días)`)
      .text(`Filtro categoría: ${d.filtros.categoria ?? 'todas'}`).text(`Unidades: ${d.unidades}`).text(`Fuente: ${FUENTE}`).moveDown(0.5);
    doc.fontSize(10).text(`Productos monitoreados: ${d.kpis.productos_monitoreados}  |  Ofertas vigentes: ${d.kpis.ofertas_vigentes}  |  Cobertura: ${d.kpis.cobertura_pct}%  |  Alertas pendientes: ${d.kpis.alertas_pendientes}`).moveDown();
    const cols = [{ t: 'Producto', w: 150 }, { t: 'Promedio', w: 70 }, { t: 'Mín.', w: 60 }, { t: 'Máx.', w: 60 }, { t: 'Locales', w: 50 }, { t: 'Var. %', w: 60 }];
    let y = doc.y;
    const fila = (vals, bold) => {
      let x = 40;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      vals.forEach((v, i) => { doc.text(String(v), x, y, { width: cols[i].w }); x += cols[i].w; });
      y += 16;
      if (y > 760) { doc.addPage(); y = 40; }
    };
    fila(cols.map((c) => c.t), true);
    d.productos.forEach((p) => fila([`${p.nombre} (${p.formato})`, clp(p.promedio), clp(p.minimo), clp(p.maximo), p.locales, p.variacion_pct ?? '-'], false));
    doc.end();
  }));

  return r;
}
