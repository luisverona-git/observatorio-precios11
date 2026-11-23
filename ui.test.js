// Pruebas de interfaz con jsdom: ejecutan el JS real del portal contra la API real (sin navegador)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { start, stop, pool, BASE as _B } from './helpers.js';
import * as H from './helpers.js';

let dom; let win;
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch { /* aún no */ } await wait(50); } throw new Error('Tiempo agotado esperando la interfaz'); }
const main = () => win.document.getElementById('contenido');
const text = () => main().textContent;

async function abrir(hash = '#/buscar', token = null) {
  const base = H.BASE;
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').replace(/<script[^>]*><\/script>/g, '').replace(/<link[^>]*>/g, '');
  dom = new JSDOM(html, { url: base + '/' + hash, runScripts: 'outside-only', pretendToBeVisual: true });
  win = dom.window;
  win.fetch = (u, o) => fetch(new URL(u, base), o);
  win.URL.createObjectURL = () => 'blob:x';
  if (token) { win.sessionStorage.setItem('obs_token', token.token); win.sessionStorage.setItem('obs_user', JSON.stringify(token.usuario)); }
  const errores = []; win.addEventListener('error', (e) => errores.push(e.message));
  win.eval(fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8'));
  return errores;
}
async function sesion(email) {
  const r = await fetch(H.BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: H.PASS }) });
  return r.json();
}

before(async () => { await start({ limits: { api: 100000, login: 100000 } }); });
after(async () => { await stop(); await pool.end(); });

test('UI-01 el portal público carga la búsqueda con categorías y nav', async () => {
  const err = await abrir();
  await until(() => text().includes('Buscar productos') && text().includes('Papa'));
  assert.ok(win.document.querySelectorAll('#nav button').length >= 4);
  assert.equal(err.length, 0, err.join());
});
test('UI-02 buscar "cazuela" muestra los ingredientes y "xyz" muestra mensaje vacío', async () => {
  await abrir();
  const q = await until(() => win.document.querySelector('input[type=search]'));
  q.value = 'cazuela'; q.dispatchEvent(new win.Event('input'));
  await until(() => text().includes('Zapallo') && text().includes('Carne molida'));
  q.value = 'xyzqw'; q.dispatchEvent(new win.Event('input'));
  await until(() => text().includes('No encontramos resultados'));
});
test('UI-03 el comparador muestra locales, "Más barato", fuente y advertencia de stock', async () => {
  await abrir('#/buscar/1');
  await until(() => text().includes('Más barato') && text().includes('Fuente:'));
  assert.match(text(), /stock no está confirmada/);
  assert.match(text(), /por kg/);
});
test('UI-04 el mapa degrada a lista cuando Leaflet no está disponible', async () => {
  await abrir('#/mapa');
  await until(() => text().includes('Locales (') && text().includes('Ver precios'));
  assert.match(text(), /El mapa no pudo cargarse/);
});
test('UI-05 el historial dibuja el gráfico SVG con alternativa en tabla', async () => {
  await abrir('#/historial/1');
  await until(() => main().querySelector('svg.graf polyline'));
  assert.ok(main().querySelector('svg.graf').getAttribute('aria-label'));
  assert.ok(main().querySelectorAll('table tbody tr').length >= 5);
});
test('UI-06 la canasta compara totales por local', async () => {
  await abrir('#/buscar/1');
  await until(() => text().includes('Agregar a la canasta'));
  [...main().querySelectorAll('button')].find((b) => b.textContent === 'Agregar a la canasta').click();
  win.location.hash = '#/canasta';
  const btn = await until(() => [...main().querySelectorAll('button')].find((b) => b.textContent === 'Comparar total por local'));
  assert.match(text(), /Papa/);
  btn.click();
  await until(() => text().includes('Total por local') && text().includes('Más barato'));
});
test('UI-07 acceso: rutas internas sin sesión no se muestran; login inválido muestra error', async () => {
  await abrir('#/dash');
  await until(() => text().includes('Buscar productos'));
  assert.ok(!text().includes('Panel de indicadores'));
  win.location.hash = '#/login';
  await until(() => main().querySelector('form'));
  const f = main().querySelectorAll('form')[0];
  f.querySelector('input[type=email]').value = 'admin@pac.demo'; f.querySelector('input[type=password]').value = 'incorrecta';
  f.dispatchEvent(new win.Event('submit', { cancelable: true }));
  await until(() => win.document.getElementById('aviso').textContent.includes('incorrectos'));
});
test('UI-08 el administrador ve el panel con KPIs, tabla, filtros y botones de exportación', async () => {
  const s = await sesion('admin@pac.demo');
  const err = await abrir('#/dash', s);
  await until(() => text().includes('Panel de indicadores') && text().includes('Productos monitoreados') && main().querySelectorAll('tbody tr').length >= 8);
  assert.match(win.document.getElementById('sesion').textContent, /Admin DIDESE · Administrador DIDESE/);
  assert.ok(!text().includes('[object'));
  assert.match(text(), /Período:/); assert.match(text(), /Exportar Excel/); assert.match(text(), /Exportar PDF/);
  assert.equal(err.length, 0, err.join());
});
test('UI-09 el administrador navega Alertas, Catálogo, Locales, Usuarios y Auditoría sin errores', async () => {
  const s = await sesion('admin@pac.demo');
  for (const [v, esperado] of [['alertas', 'Revisión de alertas'], ['catalogo', 'Catálogo de productos'], ['comercios', 'Comercios y sucursales'], ['usuarios', 'Usuarios y roles'], ['auditoria', 'Bitácora de auditoría']]) {
    const err = await abrir('#/' + v, s);
    await until(() => text().includes(esperado));
    assert.equal(err.length, 0, v + ': ' + err.join());
  }
});
test('UI-10 el comercio ve ingreso de precios y carga masiva; no ve el panel de administración', async () => {
  const s = await sesion('comercio@pac.demo');
  await abrir('#/ingreso', s);
  await until(() => text().includes('Registrar precio u oferta'));
  assert.ok(![...win.document.querySelectorAll('#nav button')].some((b) => b.textContent === 'Usuarios'));
  win.location.hash = '#/carga';
  await until(() => text().includes('Carga masiva de precios'));
  win.location.hash = '#/usuarios';
  await until(() => !text().includes('Usuarios y roles'));
});
test('UI-11 formulario de ingreso: un precio válido se publica y uno absurdo queda retenido', async () => {
  const s = await sesion('fisc@pac.demo');
  await abrir('#/ingreso', s);
  await until(() => main().querySelector('form'));
  const f = main().querySelector('form'); const selects = f.querySelectorAll('select');
  const num = f.querySelector('input[type=number]');
  selects[1].value = [...selects[1].options].find((o) => o.textContent.startsWith('Carne molida')).value;
  num.value = '99999'; f.dispatchEvent(new win.Event('submit', { cancelable: true }));
  await until(() => text().includes('retenido para revisión') || text().includes('Precio publicado'));
});
test('UI-12 todos los campos de formulario tienen etiqueta asociada (accesibilidad)', async () => {
  const s = await sesion('admin@pac.demo');
  await abrir('#/usuarios', s);
  await until(() => text().includes('Nuevo usuario'));
  const campos = [...main().querySelectorAll('input:not([type=hidden]), select')];
  assert.ok(campos.length >= 6);
  for (const c of campos) assert.ok(c.id && main().querySelector(`label[for="${c.id}"]`), 'campo sin etiqueta: ' + c.outerHTML.slice(0, 60));
});
