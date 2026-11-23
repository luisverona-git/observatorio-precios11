'use strict';
/* Observatorio de Precios PAC - portal (vanilla JS, sin innerHTML: todo el contenido se inserta como texto) */
const S = { token: sessionStorage.getItem('obs_token'), user: JSON.parse(sessionStorage.getItem('obs_user') || 'null'), canasta: [], loc: null, after: null };
const TIPOS = { feria: 'Feria', almacen: 'Almacén', supermercado: 'Supermercado', panaderia: 'Panadería', farmacia: 'Farmacia', otro: 'Otro' };
const FUENTES = { formulario: 'Ingreso del comercio', carga_masiva: 'Carga masiva validada', terreno: 'Fiscalización en terreno', api: 'Integración API' };
const ROLES = { admin: 'Administrador DIDESE', fiscalizador: 'Fiscalizador', comercio: 'Comercio', sucursal: 'Local / puesto', vecino: 'Vecino' };
const NAV = {
  publico: [['buscar', 'Buscar'], ['mapa', 'Mapa'], ['canasta', 'Canasta'], ['historial', 'Historial'], ['info', 'Información']],
  fiscalizador: [['ingreso', 'Ingreso'], ['alertas', 'Reportes'], ['buscar', 'Consultar'], ['mapa', 'Mapa']],
  comercio: [['ingreso', 'Mis precios'], ['carga', 'Carga masiva'], ['buscar', 'Consultar'], ['mapa', 'Mapa']],
  sucursal: [['ingreso', 'Mis precios'], ['buscar', 'Consultar'], ['mapa', 'Mapa']],
  admin: [['dash', 'Panel'], ['alertas', 'Alertas'], ['catalogo', 'Catálogo'], ['comercios', 'Locales'], ['usuarios', 'Usuarios'], ['auditoria', 'Auditoría'], ['buscar', 'Consultar'], ['mapa', 'Mapa']]
};

/* ---------- utilidades ---------- */
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'for') e.htmlFor = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (['value', 'type', 'id', 'href', 'download', 'min', 'max', 'step', 'placeholder', 'disabled', 'checked', 'required', 'selected', 'accept', 'autocomplete', 'inputMode', 'maxLength', 'rows', 'tabIndex'].includes(k)) e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
};
let uidN = 0;
const field = (label, input, hint) => { const id = 'f' + (++uidN); input.id = id; return h('div', {}, h('label', { for: id }, label), input, hint ? h('div', { class: 'm' }, hint) : null); };
const clp = (n) => (n == null ? '-' : '$' + Number(n).toLocaleString('es-CL'));
const fecha = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '-');
const km = (m) => (m == null ? '' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
const msg = (tipo, txt) => h('div', { class: 'msg ' + tipo, role: tipo === 'err' ? 'alert' : 'status' }, txt);
let avisoT;
function aviso(t) { const a = document.getElementById('aviso'); a.textContent = t; a.classList.add('v'); clearTimeout(avisoT); avisoT = setTimeout(() => a.classList.remove('v'), 3500); }

async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) { if (r.status === 401 && S.token) salir(); throw new Error((d && d.error) || 'Error ' + r.status); }
  return d;
}
async function bajar(path, nombre) {
  const r = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + S.token } });
  if (!r.ok) { let d = null; try { d = await r.json(); } catch { /* */ } throw new Error((d && d.error) || 'No se pudo descargar el archivo.'); }
  const a = h('a', { href: URL.createObjectURL(await r.blob()), download: nombre });
  document.body.append(a); a.click(); a.remove();
}
function tabla(caption, heads, rows) {
  return h('div', { class: 'scroll' }, h('table', {}, h('caption', { class: 'oculto' }, caption),
    h('thead', {}, h('tr', {}, heads.map((x) => h('th', { scope: 'col' }, x)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))));
}
const put = (el, ...k) => { el.replaceChildren(...k.flat(Infinity).filter((x) => x != null && x !== false)); return el; };
const sel = (opts, valor) => opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(valor) }, t));
function conCarga(btn, fn) { // evita doble envio y muestra errores
  return async (e) => { e.preventDefault(); btn.disabled = true; try { await fn(); } catch (err) { aviso(err.message); } finally { btn.disabled = false; } };
}

/* ---------- sesion ---------- */
function salir() { S.token = null; S.user = null; sessionStorage.removeItem('obs_token'); sessionStorage.removeItem('obs_user'); location.hash = '#/buscar'; pintarCabecera(); render(); }
function pintarCabecera() {
  const box = document.getElementById('sesion');
  put(box, S.user
    ? [h('span', {}, `${S.user.nombre} · ${ROLES[S.user.rol]}`), h('button', { class: 'sec', on: { click: salir } }, 'Salir')]
    : [h('button', { class: 'pr', on: { click: () => { location.hash = '#/login'; } } }, 'Ingresar')]);
  const items = NAV[S.user ? S.user.rol : 'publico'] || NAV.publico;
  const actual = (location.hash.split('/')[1] || 'buscar');
  put(document.getElementById('nav'), ...items.map(([v, t]) => h('button', { 'aria-current': v === actual ? 'page' : null, on: { click: () => { location.hash = '#/' + v; } } }, t)));
}

/* ---------- vistas publicas ---------- */
const VIEWS = {};
VIEWS.buscar = async (p) => {
  if (p) return comparador(p);
  const cats = await api('GET', '/categorias');
  const q = h('input', { type: 'search', placeholder: 'ej. ingredientes para cazuela, marraqueta, arroz', autocomplete: 'off' });
  const cat = h('select', {}, h('option', { value: '' }, 'Todas las categorías'), sel(cats.map((c) => [c.id_categoria, c.nombre])));
  const out = h('div', { 'aria-live': 'polite' });
  async function buscar() {
    const qs = new URLSearchParams(); if (q.value.trim()) qs.set('q', q.value.trim()); if (cat.value) qs.set('categoria', cat.value);
    const r = await api('GET', '/productos?' + qs);
    if (!r.length) return put(out, msg('warn', 'No encontramos resultados. Prueba con otro nombre, por ejemplo “papa” o “pan”.'));
    put(out, h('p', { class: 'm' }, `${r.length} producto(s) encontrados`), h('div', { class: 'card' }, r.map((x) => h('div', { class: 'row' },
      h('button', { class: 'linklike', on: { click: () => { location.hash = '#/buscar/' + x.id_producto; } } },
        h('strong', {}, `${x.nombre}${x.marca ? ' ' + x.marca : ''} · ${x.formato}`), h('div', { class: 'm' }, `${x.categoria} · ${x.locales} local(es)`)),
      h('div', { class: 'der precio' }, x.locales > 0 ? (x.precio_min === x.precio_max ? clp(x.precio_min) : `${clp(x.precio_min)} – ${clp(x.precio_max)}`) : 'Sin precios')))));
  }
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => buscar().catch((e) => aviso(e.message)), 300); });
  cat.addEventListener('change', () => buscar().catch((e) => aviso(e.message)));
  await buscar();
  return h('div', {}, h('h1', {}, 'Buscar productos'), h('div', { class: 'card inline' }, field('¿Qué necesitas?', q, 'Entendemos modismos (“marraqueta”) y pequeñas faltas de ortografía.'), field('Categoría', cat)), out);
};

async function comparador(id) {
  const orden = h('select', {}, sel([['precio', 'Precio (menor a mayor)'], ['distancia', 'Distancia'], ['vigencia', 'Vigencia de la oferta']]));
  const tipo = h('select', {}, h('option', { value: '' }, 'Todos'), sel(Object.entries(TIPOS)));
  const sector = h('select', {}, sel([['', 'Todos'], ['Sector Norte', 'Sector Norte'], ['Sector Centro', 'Sector Centro'], ['Sector Sur', 'Sector Sur']]));
  const out = h('div', { 'aria-live': 'polite' });
  const cab = h('div');
  async function cargar() {
    if (orden.value === 'distancia' && !S.loc) { orden.value = 'precio'; aviso('Para ordenar por distancia, primero usa tu ubicación.'); }
    const qs = new URLSearchParams({ orden: orden.value }); if (tipo.value) qs.set('tipo', tipo.value); if (sector.value) qs.set('sector', sector.value);
    if (S.loc) { qs.set('lat', S.loc.lat); qs.set('lng', S.loc.lng); }
    const d = await api('GET', `/productos/${id}/precios?` + qs);
    const p = d.producto;
    put(cab, h('h1', {}, `${p.nombre}${p.marca ? ' ' + p.marca : ''} · ${p.formato}`), h('p', { class: 'm' }, `${p.categoria} · precio por ${p.unidad_base === 'un' ? 'unidad' : p.unidad_base} cuando corresponde`));
    if (!d.resultados.length) return put(out, msg('warn', 'Este producto aún no tiene precios publicados en locales activos.'));
    const min = Math.min(...d.resultados.map((x) => x.valor_final));
    put(out, h('div', { class: 'card' }, d.resultados.map((x) => h('div', { class: 'row' },
      h('div', {},
        h('button', { class: 'linklike', on: { click: () => { location.hash = '#/local/' + x.id_sucursal; } } }, h('strong', {}, x.sucursal), x.valor_final === min ? h('span', { class: 'chip' }, 'Más barato') : null),
        h('div', { class: 'm' }, `${TIPOS[x.tipo]} · ${x.sector} · ${x.direccion}${x.metros != null ? ' · a ' + km(x.metros) : ''}`),
        x.condiciones ? h('div', { class: 'm' }, 'Condiciones: ' + x.condiciones) : null,
        h('div', { class: 'm' }, `Fuente: ${FUENTES[x.fuente]} · observado el ${fecha(x.fecha_observacion)}${x.oferta_activa ? ' · oferta hasta el ' + fecha(x.vigencia_hasta) : ''}`)),
      h('div', { class: 'der' },
        x.oferta_activa ? [h('span', { class: 'tachado' }, clp(x.valor_normal)), h('span', { class: 'precio' }, clp(x.valor_final)), h('span', { class: 'chip of' }, 'Oferta')] : h('span', { class: 'precio' }, clp(x.valor_final)),
        p.unidad_base !== 'un' || p.contenido !== 1 ? h('div', { class: 'm' }, `${clp(x.precio_unitario)} por ${p.unidad_base === 'un' ? 'unidad' : p.unidad_base}`) : null,
        S.user ? h('div', {}, h('button', { class: 'sec', on: { click: () => reportar(id, x) } }, 'Reportar precio distinto')) : null)))),
      h('p', { class: 'm' }, 'La disponibilidad de stock no está confirmada.'));
  }
  const geo = h('button', { class: 'sec', on: { click: () => {
    if (!navigator.geolocation) return aviso('Tu navegador no permite obtener la ubicación.');
    navigator.geolocation.getCurrentPosition((pos) => { S.loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }; aviso('Ubicación lista.'); orden.value = 'distancia'; cargar().catch((e) => aviso(e.message)); }, () => aviso('No pudimos obtener tu ubicación.'));
  } } }, 'Usar mi ubicación');
  for (const el of [orden, tipo, sector]) el.addEventListener('change', () => cargar().catch((e) => aviso(e.message)));
  await cargar();
  const info = (await api('GET', `/productos/${id}/precios`)).producto;
  return h('div', {}, h('p', {}, h('a', { href: '#/buscar' }, '← Volver a la búsqueda')), cab,
    h('div', { class: 'sub' },
      h('button', { class: 'pr', on: { click: () => { if (!S.canasta.some((c) => c.id === +id)) S.canasta.push({ id: +id, nombre: `${info.nombre} ${info.formato}` }); aviso('Agregado a la canasta'); } } }, 'Agregar a la canasta'),
      h('button', { on: { click: () => { location.hash = '#/historial/' + id; } } }, 'Ver historial'), geo),
    h('div', { class: 'card inline' }, field('Ordenar por', orden), field('Tipo de comercio', tipo), field('Sector', sector)), out);
}
async function reportar(idProd, x) {
  const v = prompt(`¿Qué precio viste en ${x.sucursal}? (número entero, en pesos)`);
  if (v == null) return;
  try { await api('POST', '/reportes', { id_producto: +idProd, id_sucursal: x.id_sucursal, valor_observado: v ? Number(v) : undefined }); aviso('Reporte enviado: un fiscalizador lo revisará.'); } catch (e) { aviso(e.message); }
}

VIEWS.local = async (id) => {
  const d = await api('GET', '/sucursales/' + id);
  return h('div', {}, h('p', {}, h('a', { href: '#/mapa' }, '← Volver al mapa')), h('h1', {}, d.sucursal.nombre),
    h('p', { class: 'm' }, `${TIPOS[d.sucursal.tipo]} · ${d.sucursal.sector} · ${d.sucursal.direccion}`),
    h('div', { class: 'card' }, d.precios.length ? d.precios.map((x) => h('div', { class: 'row' },
      h('div', {}, h('strong', {}, `${x.nombre} · ${x.formato}`), h('div', { class: 'm' }, `${x.condiciones ? x.condiciones + ' · ' : ''}observado el ${fecha(x.fecha_observacion)}`)),
      h('div', { class: 'der' }, x.oferta_activa ? [h('span', { class: 'tachado' }, clp(x.valor_normal)), ' '] : null, h('span', { class: 'precio' }, clp(x.valor_final)), x.oferta_activa ? h('span', { class: 'chip of' }, 'Oferta') : null))) : h('p', {}, 'Sin precios publicados.')));
};

VIEWS.mapa = async () => {
  const cats = await api('GET', '/categorias');
  const cat = h('select', {}, h('option', { value: '' }, 'Todas'), sel(cats.map((c) => [c.id_categoria, c.nombre])));
  const tipo = h('select', {}, h('option', { value: '' }, 'Todos'), sel(Object.entries(TIPOS)));
  const sector = h('select', {}, sel([['', 'Todos'], ['Sector Norte', 'Sector Norte'], ['Sector Centro', 'Sector Centro'], ['Sector Sur', 'Sector Sur']]));
  const mapDiv = h('div', { class: 'mapa', role: 'region', 'aria-label': 'Mapa de locales. Debajo hay una lista equivalente.' });
  const lista = h('div', { class: 'card' });
  let map; let capa;
  async function pintar() {
    const qs = new URLSearchParams(); if (cat.value) qs.set('categoria', cat.value); if (tipo.value) qs.set('tipo', tipo.value); if (sector.value) qs.set('sector', sector.value);
    const r = await api('GET', '/sucursales?' + qs);
    put(lista, h('h2', {}, `Locales (${r.length})`), r.length ? r.map((s) => h('div', { class: 'row' },
      h('div', {}, h('strong', {}, s.nombre), h('div', { class: 'm' }, `${TIPOS[s.tipo]} · ${s.sector} · ${s.direccion}`)),
      h('a', { class: 'btn', href: '#/local/' + s.id_sucursal }, `Ver precios (${s.productos})`))) : h('p', {}, 'No hay locales con esos filtros.'));
    if (map && capa) {
      capa.clearLayers();
      r.forEach((s) => { const c = h('div', {}, h('strong', {}, s.nombre), h('div', {}, s.direccion), h('a', { href: '#/local/' + s.id_sucursal }, 'Ver precios')); window.L.marker([s.lat, s.lng]).addTo(capa).bindPopup(c); });
    }
  }
  for (const el of [cat, tipo, sector]) el.addEventListener('change', () => pintar().catch((e) => aviso(e.message)));
  S.after = () => {
    if (window.L) { map = window.L.map(mapDiv).setView([-33.4915, -70.665], 14); window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map); capa = window.L.layerGroup().addTo(map); }
    else put(mapDiv, h('p', { class: 'm' }, 'El mapa no pudo cargarse. Usa la lista de locales de abajo.'));
    pintar().catch((e) => aviso(e.message));
  };
  return h('div', {}, h('h1', {}, 'Mapa de locales'), h('div', { class: 'card inline' }, field('Categoría', cat), field('Tipo de comercio', tipo), field('Sector', sector)), mapDiv, lista);
};

VIEWS.canasta = async () => {
  const out = h('div');
  const lista = h('div', { class: 'card' });
  function pintarLista() {
    put(lista, S.canasta.length ? S.canasta.map((c) => h('div', { class: 'row' }, h('span', {}, c.nombre), h('button', { class: 'sec', on: { click: () => { S.canasta = S.canasta.filter((x) => x.id !== c.id); pintarLista(); put(out, ); } } }, 'Quitar')))
      : msg('warn', 'Aún no hay productos. Busca un producto y agrégalo para comparar el total por local.'));
  }
  pintarLista();
  const btn = h('button', { class: 'pr' }, 'Comparar total por local');
  btn.addEventListener('click', conCarga(btn, async () => {
    if (!S.canasta.length) return aviso('Agrega productos primero.');
    const r = await api('POST', '/canasta/comparar', { productos: S.canasta.map((c) => c.id) });
    put(out, h('h2', {}, 'Total por local'), r.length ? h('div', { class: 'card' }, r.map((x, i) => h('div', { class: 'row' }, h('span', {}, x.sucursal, i === 0 ? h('span', { class: 'chip' }, 'Más barato') : null), h('span', { class: 'precio' }, clp(x.total)))))
      : msg('warn', 'Ningún local tiene todos los productos de tu canasta.'));
  }));
  return h('div', {}, h('h1', {}, 'Mi canasta'), lista, btn, out);
};

const COLORES = ['#C8102E', '#1a5fd0', '#14663a', '#b86e00', '#6b2fa0'];
const DASH = ['', '7 4', '2 3', '9 3 2 3', '4 2'];
function grafico(serie) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a, ...k) => { const e = document.createElementNS(NS, t); for (const [x, v] of Object.entries(a || {})) e.setAttribute(x, v); k.forEach((c) => e.append(c)); return e; };
  const per = [...new Set(serie.map((s) => s.periodo))].sort();
  const sucs = [...new Map(serie.map((s) => [s.id_sucursal, s.sucursal]))];
  const vals = serie.map((s) => s.valor); const min = Math.min(...vals); const max = Math.max(...vals);
  const pad = (max - min) * 0.15 || max * 0.1; const y0 = Math.max(0, min - pad); const y1 = max + pad;
  const W = 640; const H = 280; const ml = 60; const mr = 14; const mt = 14; const mb = 40;
  const X = (i) => ml + (per.length === 1 ? (W - ml - mr) / 2 : (i * (W - ml - mr)) / (per.length - 1));
  const Y = (v) => mt + (H - mt - mb) * (1 - (v - y0) / (y1 - y0));
  const svg = el('svg', { class: 'graf', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Gráfico de evolución del precio por semana o mes, con una línea por local. Los mismos datos están en la tabla de abajo.' });
  for (let i = 0; i <= 4; i++) {
    const v = y0 + ((y1 - y0) * i) / 4;
    svg.append(el('line', { class: 'gl', x1: ml, x2: W - mr, y1: Y(v), y2: Y(v) }), el('text', { x: ml - 6, y: Y(v) + 4, 'text-anchor': 'end' }, clp(Math.round(v))));
  }
  svg.append(el('line', { class: 'ax', x1: ml, x2: ml, y1: mt, y2: H - mb }), el('line', { class: 'ax', x1: ml, x2: W - mr, y1: H - mb, y2: H - mb }));
  [0, Math.floor((per.length - 1) / 2), per.length - 1].filter((v, i, a) => a.indexOf(v) === i).forEach((i) => svg.append(el('text', { x: X(i), y: H - mb + 18, 'text-anchor': 'middle' }, fecha(per[i]).slice(0, 5))));
  svg.append(el('text', { x: W / 2, y: H - 4, 'text-anchor': 'middle' }, 'Semana de observación (día-mes)'));
  sucs.forEach(([id], k) => {
    const pts = serie.filter((s) => s.id_sucursal === id).map((s) => [X(per.indexOf(s.periodo)), Y(s.valor)]);
    svg.append(el('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: COLORES[k % 5], 'stroke-width': 2.5, 'stroke-dasharray': DASH[k % 5] }));
    pts.forEach((p) => svg.append(el('circle', { cx: p[0], cy: p[1], r: 3.5, fill: COLORES[k % 5] })));
  });
  const ley = h('div', { class: 'leyenda' }, sucs.map(([, n], k) => h('span', {}, h('span', { class: 'sw', style: null }), n)));
  ley.querySelectorAll('.sw').forEach((s, k) => { s.style.borderTopColor = COLORES[k % 5]; s.style.borderTopStyle = DASH[k % 5] ? 'dashed' : 'solid'; });
  return [svg, ley];
}
VIEWS.historial = async (p) => {
  const prods = await api('GET', '/productos');
  const prod = h('select', {}, sel(prods.map((x) => [x.id_producto, `${x.nombre} · ${x.formato}`]), p || prods[0].id_producto));
  const agr = h('select', {}, sel([['week', 'Semanal'], ['month', 'Mensual']]));
  const dias = h('select', {}, sel([[30, 'Últimos 30 días'], [90, 'Últimos 90 días'], [180, 'Últimos 6 meses']], 90));
  const out = h('div', { 'aria-live': 'polite' });
  async function cargar() {
    const d = await api('GET', `/productos/${prod.value}/historial?agrupar=${agr.value}&dias=${dias.value}`);
    if (!d.serie.length) return put(out, msg('warn', 'No hay observaciones en ese período.'));
    put(out, h('p', { class: 'm' }, `Evolución ${d.agrupacion} · ${d.unidad}`), ...grafico(d.serie),
      h('h2', {}, 'Datos del gráfico'), tabla('Historial de precios', ['Período', 'Local', 'Precio', 'Observaciones'], d.serie.map((s) => [fecha(s.periodo), s.sucursal, clp(s.valor), s.observaciones])));
  }
  for (const el of [prod, agr, dias]) el.addEventListener('change', () => cargar().catch((e) => aviso(e.message)));
  await cargar();
  return h('div', {}, h('h1', {}, 'Historial de precios'), h('div', { class: 'card inline' }, field('Producto', prod), field('Agrupar', agr), field('Período', dias)), out);
};

VIEWS.info = async () => {
  const t = await api('GET', '/transparencia');
  return h('div', {}, h('h1', {}, 'Transparencia: cómo obtenemos los precios'),
    h('div', { class: 'card' }, h('h2', {}, 'Método de recolección'), h('p', {}, t.metodo), h('h2', {}, 'Qué se muestra'), h('p', {}, t.campos), h('h2', {}, 'Actualización'), h('p', {}, t.actualizacion), h('div', { class: 'msg warn' }, t.advertencia)));
};

/* ---------- acceso ---------- */
VIEWS.login = async () => {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const b = h('button', { class: 'pr', type: 'submit' }, 'Ingresar');
  const f = h('form', { class: 'card' }, h('h2', {}, 'Ingresar'), field('Correo', email), field('Contraseña', pass), b);
  f.addEventListener('submit', conCarga(b, async () => {
    const r = await api('POST', '/auth/login', { email: email.value, password: pass.value });
    S.token = r.token; S.user = r.usuario; sessionStorage.setItem('obs_token', r.token); sessionStorage.setItem('obs_user', JSON.stringify(r.usuario));
    location.hash = '#/' + NAV[r.usuario.rol === 'vecino' ? 'publico' : r.usuario.rol][0][0]; pintarCabecera(); render();
  }));
  const rn = h('input', { type: 'text', autocomplete: 'name', required: true }); const re = h('input', { type: 'email', autocomplete: 'email', required: true });
  const rp = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const rb = h('button', { type: 'submit' }, 'Crear cuenta de vecino');
  const rf = h('form', { class: 'card' }, h('h2', {}, 'Crear cuenta'), field('Nombre', rn), field('Correo', re), field('Contraseña', rp, 'Mínimo 8 caracteres, con letras y números.'), rb);
  rf.addEventListener('submit', conCarga(rb, async () => { await api('POST', '/auth/registro', { nombre: rn.value, email: re.value, password: rp.value }); aviso('Cuenta creada. Ya puedes ingresar.'); rf.reset(); }));
  return h('div', { class: 'grid dos' }, f, rf);
};

/* ---------- personal autorizado ---------- */
VIEWS.ingreso = async () => {
  const [sucs, prods, mios] = await Promise.all([api('GET', '/mis-sucursales'), api('GET', '/productos'), api('GET', '/precios/mios')]);
  const suc = h('select', {}, sel(sucs.map((s) => [s.id_sucursal, s.nombre])));
  const prod = h('select', {}, sel(prods.map((x) => [x.id_producto, `${x.nombre} · ${x.formato}`])));
  const normal = h('input', { type: 'number', inputMode: 'numeric', min: 1, step: 1, required: true });
  const oferta = h('input', { type: 'number', inputMode: 'numeric', min: 1, step: 1 });
  const desde = h('input', { type: 'date' }); const hasta = h('input', { type: 'date' });
  const cond = h('input', { type: 'text', maxLength: 200, placeholder: 'ej. compra mínima 2 kg, pago con tarjeta' });
  const salida = h('div', { 'aria-live': 'polite' });
  const b = h('button', { class: 'pr', type: 'submit' }, 'Publicar precio');
  const f = h('form', { class: 'card' }, h('h2', {}, 'Registrar precio u oferta'), field('Local', suc), field('Producto', prod), field('Precio normal (CLP)', normal),
    h('div', { class: 'inline' }, field('Precio de oferta (opcional)', oferta), field('Oferta desde', desde), field('Oferta hasta', hasta)), field('Condiciones (opcional)', cond), b, salida);
  f.addEventListener('submit', conCarga(b, async () => {
    const r = await api('POST', '/precios', { id_sucursal: +suc.value, id_producto: +prod.value, valor_normal: Number(normal.value), valor_oferta: oferta.value ? Number(oferta.value) : null,
      vigencia_desde: desde.value || null, vigencia_hasta: hasta.value || null, condiciones: cond.value || null });
    salida.replaceChildren(r.estado === 'vigente' ? msg('ok', 'Precio publicado. El valor anterior quedó en el historial.') : msg('warn', `Precio retenido para revisión de DIDESE. ${r.motivo || ''}`));
    setTimeout(render, 1200);
  }));
  return h('div', {}, h('h1', {}, 'Ingreso de precios'), f, h('h2', {}, 'Últimos registros'),
    tabla('Últimos precios registrados', ['Producto', 'Local', 'Precio', 'Oferta', 'Estado', 'Fecha'], mios.map((x) => [`${x.producto} · ${x.formato}`, x.sucursal, clp(x.valor_normal), x.valor_oferta ? clp(x.valor_oferta) : '-', x.estado, fecha(x.fecha_observacion)])));
};

VIEWS.carga = async () => {
  const file = h('input', { type: 'file', accept: '.csv,.xlsx' }); const out = h('div', { 'aria-live': 'polite' }); let payload = null;
  const leer = () => new Promise((res, rej) => {
    const f = file.files[0]; if (!f) return rej(new Error('Selecciona un archivo CSV o Excel.'));
    const r = new FileReader(); const xlsx = /\.xlsx$/i.test(f.name);
    r.onerror = () => rej(new Error('No se pudo leer el archivo.'));
    r.onload = () => {
      let contenido;
      if (xlsx) { const bytes = new Uint8Array(r.result); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); contenido = btoa(s); } else contenido = r.result;
      res({ nombre: f.name, formato: xlsx ? 'xlsx' : 'csv', contenido });
    };
    if (xlsx) r.readAsArrayBuffer(f); else r.readAsText(f);
  });
  const bPrev = h('button', { class: 'pr' }, 'Vista previa'); const bOk = h('button', { disabled: true }, 'Confirmar carga');
  bPrev.addEventListener('click', conCarga(bPrev, async () => {
    payload = await leer(); const r = await api('POST', '/carga/previsualizar', payload);
    put(out, msg(r.con_error ? 'warn' : 'ok', `${r.total} filas: ${r.validas} válidas y ${r.con_error} con error.`),
      r.errores.length ? tabla('Errores por fila', ['Fila', 'Error'], r.errores.map((e) => [e.fila, e.error])) : null,
      r.muestra.length ? [h('h3', {}, 'Muestra de filas válidas'), tabla('Muestra', ['Fila', 'Producto', 'Local', 'Precio'], r.muestra.map((m) => [m.fila, m.id_producto, m.id_sucursal, clp(m.valor_normal)]))] : null);
    bOk.disabled = r.validas === 0;
  }));
  bOk.addEventListener('click', conCarga(bOk, async () => {
    const r = await api('POST', '/carga/confirmar', payload); bOk.disabled = true;
    put(out, msg('ok', `Carga recibida: ${r.enviadas_a_aprobacion} precio(s) enviados a aprobación de DIDESE, ${r.con_error} fila(s) con error.`));
  }));
  const plantilla = h('button', { on: { click: () => bajar('/carga/plantilla.csv', 'plantilla_precios.csv').catch((e) => aviso(e.message)) } }, 'Descargar plantilla CSV');
  return h('div', {}, h('h1', {}, 'Carga masiva de precios'),
    h('div', { class: 'card' }, h('p', {}, 'Sube un archivo CSV o Excel con las columnas de la plantilla. Primero se valida (vista previa) y, al confirmar, los precios pasan por revisión antes de publicarse.'), plantilla, field('Archivo (.csv o .xlsx)', file), h('div', { class: 'sub' }, bPrev, bOk)), out);
};

VIEWS.alertas = async () => {
  const r = await api('GET', '/alertas'); const admin = S.user.rol === 'admin';
  const etiqueta = { anomalia: 'Precio sospechoso', carga_masiva: 'Carga masiva', reporte: 'Reporte ciudadano' };
  const act = async (id, accion) => { await api('POST', `/alertas/${id}/${accion}`); aviso('Listo'); render(); };
  return h('div', {}, h('h1', {}, admin ? 'Revisión de alertas' : 'Reportes ciudadanos'),
    r.length ? h('div', { class: 'card' }, r.map((a) => h('div', { class: 'row' },
      h('div', {}, h('strong', {}, `${etiqueta[a.tipo]} · ${a.producto || ''} ${a.formato || ''}`), h('div', { class: 'm' }, `${a.sucursal || ''} · ${fecha(a.creada)}`),
        h('div', { class: 'm' }, a.tipo === 'reporte' ? `Precio visto: ${a.detalle && a.detalle.valor_observado ? clp(a.detalle.valor_observado) : 'no indicado'} ${a.detalle && a.detalle.comentario ? '· ' + a.detalle.comentario : ''}` : `${a.detalle && a.detalle.texto ? a.detalle.texto : ''} Valor propuesto: ${clp(a.valor_normal)}`)),
      h('div', { class: 'sub' }, a.tipo === 'reporte' ? h('button', { class: 'pr', on: { click: () => act(a.id_alerta, 'cerrar').catch((e) => aviso(e.message)) } }, 'Marcar revisado')
        : admin ? [h('button', { class: 'pr', on: { click: () => act(a.id_alerta, 'aprobar').catch((e) => aviso(e.message)) } }, 'Aprobar y publicar'), h('button', { on: { click: () => act(a.id_alerta, 'rechazar').catch((e) => aviso(e.message)) } }, 'Rechazar')] : null))))
      : msg('ok', 'No hay alertas pendientes.'));
};

VIEWS.dash = async () => {
  const cats = await api('GET', '/categorias');
  const dias = h('select', {}, sel([[30, '30 días'], [60, '60 días'], [90, '90 días']], 30));
  const cat = h('select', {}, h('option', { value: '' }, 'Todas'), sel(cats.map((c) => [c.id_categoria, c.nombre])));
  const out = h('div', { 'aria-live': 'polite' });
  const qs = () => `?dias=${dias.value}${cat.value ? '&categoria=' + cat.value : ''}`;
  async function cargar() {
    const d = await api('GET', '/admin/indicadores' + qs()); const k = d.kpis; const maxP = Math.max(...d.productos.map((p) => p.promedio), 1);
    put(out, h('p', { class: 'm' }, `Período: ${fecha(d.periodo.desde)} al ${fecha(d.periodo.hasta)} (${d.periodo.dias} días) · Categoría: ${d.filtros.categoria ? cats.find((c) => c.id_categoria === d.filtros.categoria).nombre : 'todas'} · ${d.unidades}`),
      h('div', { class: 'kpis' }, [['Productos monitoreados', k.productos_monitoreados], ['Ofertas vigentes', k.ofertas_vigentes], ['Cobertura de locales', k.cobertura_pct + '%'], ['Alertas pendientes', k.alertas_pendientes]]
        .map(([t, v]) => h('div', { class: 'kpi' }, h('b', {}, v), t))),
      h('h2', {}, 'Precios por producto'),
      tabla('Indicadores por producto', ['Producto', 'Promedio', 'Mínimo', 'Máximo', 'Locales', 'Variación', ''], d.productos.map((p) => {
        const bar = h('div', { class: 'bar', 'aria-hidden': 'true' }); bar.style.width = Math.round((p.promedio / maxP) * 100) + '%';
        const v = p.variacion_pct; return [`${p.nombre} · ${p.formato}`, clp(p.promedio), clp(p.minimo), clp(p.maximo), p.locales, v == null ? '-' : h('span', { class: v > 0 ? 'pos' : 'neg' }, `${v > 0 ? '▲' : v < 0 ? '▼' : '='} ${Math.abs(v).toString().replace('.', ',')}%`), bar];
      })));
  }
  for (const el of [dias, cat]) el.addEventListener('change', () => cargar().catch((e) => aviso(e.message)));
  await cargar();
  const xl = h('button', { on: { click: () => bajar('/admin/reportes/indicadores.xlsx' + qs(), 'indicadores_observatorio.xlsx').catch((e) => aviso(e.message)) } }, 'Exportar Excel');
  const pdf = h('button', { on: { click: () => bajar('/admin/reportes/indicadores.pdf' + qs(), 'indicadores_observatorio.pdf').catch((e) => aviso(e.message)) } }, 'Exportar PDF');
  return h('div', {}, h('h1', {}, 'Panel de indicadores'), h('div', { class: 'card inline' }, field('Período', dias), field('Categoría', cat), h('div', { class: 'sub' }, xl, pdf)), out);
};

VIEWS.catalogo = async () => {
  const [cats, prods] = await Promise.all([api('GET', '/categorias'), api('GET', '/admin/productos')]);
  const c = h('select', {}, sel(cats.map((x) => [x.id_categoria, x.nombre])));
  const nombre = h('input', { type: 'text', required: true, maxLength: 80 }); const marca = h('input', { type: 'text', maxLength: 60 }); const formato = h('input', { type: 'text', required: true, maxLength: 40, placeholder: 'ej. 1 kg' });
  const cont = h('input', { type: 'number', step: 'any', min: 0.001, required: true }); const uni = h('select', {}, sel([['kg', 'kg'], ['g', 'g'], ['l', 'l'], ['ml', 'ml'], ['un', 'unidad']]));
  const b = h('button', { class: 'pr', type: 'submit' }, 'Crear producto');
  const f = h('form', { class: 'card' }, h('h2', {}, 'Nuevo producto'), h('div', { class: 'inline' }, field('Categoría', c), field('Nombre', nombre), field('Marca', marca)),
    h('div', { class: 'inline' }, field('Formato', formato), field('Contenido', cont), field('Unidad de medida', uni)), b);
  f.addEventListener('submit', conCarga(b, async () => { await api('POST', '/admin/productos', { id_categoria: +c.value, nombre: nombre.value, marca: marca.value || null, formato: formato.value, contenido: Number(cont.value), unidad_medida: uni.value }); aviso('Producto creado'); render(); }));
  return h('div', {}, h('h1', {}, 'Catálogo de productos'), f, tabla('Productos', ['Producto', 'Marca', 'Formato', 'Categoría', 'Activo'], prods.map((p) => [p.nombre, p.marca || '-', p.formato, p.categoria, p.activo ? 'Sí' : 'No'])));
};

VIEWS.comercios = async () => {
  const [com, suc] = await Promise.all([api('GET', '/admin/comercios'), api('GET', '/admin/sucursales')]);
  const rut = h('input', { type: 'text', required: true, placeholder: '12.345.678-9' }); const rz = h('input', { type: 'text', required: true }); const tp = h('select', {}, sel(Object.entries(TIPOS)));
  const b1 = h('button', { class: 'pr', type: 'submit' }, 'Crear comercio');
  const f1 = h('form', { class: 'card' }, h('h2', {}, 'Nuevo comercio'), h('div', { class: 'inline' }, field('RUT', rut), field('Razón social', rz), field('Tipo', tp)), b1);
  f1.addEventListener('submit', conCarga(b1, async () => { await api('POST', '/admin/comercios', { rut: rut.value, razon_social: rz.value, tipo: tp.value }); aviso('Comercio creado'); render(); }));
  const sc = h('select', {}, sel(com.map((c) => [c.id_comercio, c.razon_social]))); const sn = h('input', { type: 'text', required: true }); const sd = h('input', { type: 'text', required: true });
  const ss = h('select', {}, sel([['Sector Norte', 'Sector Norte'], ['Sector Centro', 'Sector Centro'], ['Sector Sur', 'Sector Sur']]));
  const la = h('input', { type: 'number', step: 'any', required: true, placeholder: '-33.4915' }); const lo = h('input', { type: 'number', step: 'any', required: true, placeholder: '-70.6650' });
  const b2 = h('button', { class: 'pr', type: 'submit' }, 'Crear sucursal');
  const f2 = h('form', { class: 'card' }, h('h2', {}, 'Nueva sucursal'), h('div', { class: 'inline' }, field('Comercio', sc), field('Nombre', sn), field('Dirección', sd)), h('div', { class: 'inline' }, field('Sector', ss), field('Latitud', la), field('Longitud', lo)), b2);
  f2.addEventListener('submit', conCarga(b2, async () => { await api('POST', '/admin/sucursales', { id_comercio: +sc.value, nombre: sn.value, direccion: sd.value, sector: ss.value, lat: Number(la.value), lng: Number(lo.value) }); aviso('Sucursal creada'); render(); }));
  const toggle = (ruta, clave, id, valor) => h('button', { class: 'sec', on: { click: () => api('PUT', `${ruta}/${id}/${clave === 'activo' ? 'activo' : 'activa'}`, { [clave]: !valor }).then(render).catch((e) => aviso(e.message)) } }, valor ? 'Desactivar' : 'Activar');
  return h('div', {}, h('h1', {}, 'Comercios y sucursales'), f1, f2,
    tabla('Comercios', ['Comercio', 'Tipo', 'Sucursales', 'Estado', ''], com.map((c) => [c.razon_social, TIPOS[c.tipo], c.sucursales, c.activo ? 'Activo' : 'Inactivo', toggle('/admin/comercios', 'activo', c.id_comercio, c.activo)])),
    h('h2', {}, 'Sucursales'), tabla('Sucursales', ['Sucursal', 'Comercio', 'Dirección', 'Sector', 'Estado', ''], suc.map((s) => [s.nombre, s.comercio, s.direccion, s.sector, s.activa ? 'Activa' : 'Inactiva', toggle('/admin/sucursales', 'activa', s.id_sucursal, s.activa)])));
};

VIEWS.usuarios = async () => {
  const [us, com, suc] = await Promise.all([api('GET', '/admin/usuarios'), api('GET', '/admin/comercios'), api('GET', '/admin/sucursales')]);
  const em = h('input', { type: 'email', required: true }); const nm = h('input', { type: 'text', required: true }); const pw = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const rl = h('select', {}, sel(Object.entries(ROLES))); const cm = h('select', {}, h('option', { value: '' }, '(ninguno)'), sel(com.map((c) => [c.id_comercio, c.razon_social])));
  const sc = h('select', {}, h('option', { value: '' }, '(ninguna)'), sel(suc.map((s) => [s.id_sucursal, s.nombre])));
  const b = h('button', { class: 'pr', type: 'submit' }, 'Crear usuario');
  const f = h('form', { class: 'card' }, h('h2', {}, 'Nuevo usuario'), h('div', { class: 'inline' }, field('Correo', em), field('Nombre', nm), field('Contraseña', pw, 'Mín. 8 caracteres con letras y números')),
    h('div', { class: 'inline' }, field('Rol', rl), field('Comercio asignado', cm), field('Local asignado', sc)), b);
  f.addEventListener('submit', conCarga(b, async () => { await api('POST', '/admin/usuarios', { email: em.value, nombre: nm.value, password: pw.value, rol: rl.value, id_comercio: cm.value ? +cm.value : null, id_sucursal: sc.value ? +sc.value : null }); aviso('Usuario creado'); render(); }));
  return h('div', {}, h('h1', {}, 'Usuarios y roles'), f, tabla('Usuarios', ['Nombre', 'Correo', 'Rol', 'Estado', ''], us.map((u) => [u.nombre, u.email, ROLES[u.rol], u.activo ? 'Activo' : 'Inactivo',
    h('button', { class: 'sec', on: { click: () => api('PUT', `/admin/usuarios/${u.id_usuario}/activo`, { activo: !u.activo }).then(render).catch((e) => aviso(e.message)) } }, u.activo ? 'Desactivar' : 'Activar')])));
};

VIEWS.auditoria = async () => {
  const r = await api('GET', '/admin/auditoria?limite=150');
  return h('div', {}, h('h1', {}, 'Bitácora de auditoría'), h('p', { class: 'm' }, 'Solo lectura: los registros no pueden editarse ni borrarse.'),
    tabla('Bitácora', ['Fecha', 'Usuario', 'Acción', 'Entidad', 'Detalle'], r.map((l) => [new Date(l.fecha).toLocaleString('es-CL'), l.usuario || 'sistema', l.accion, `${l.entidad} ${l.id_entidad || ''}`,
      l.valor_nuevo ? JSON.stringify(l.valor_nuevo).slice(0, 90) : ''])));
};

/* ---------- enrutador ---------- */
async function render() {
  const main = document.getElementById('contenido');
  const [, vista, param] = (location.hash || '#/buscar').split('/');
  const rol = S.user ? S.user.rol : 'publico';
  const permitidas = new Set([...(NAV[rol] || NAV.publico).map((x) => x[0]), 'buscar', 'local', 'info', 'login', 'historial', 'canasta', 'mapa']);
  let v = vista || 'buscar';
  if (!VIEWS[v] || !permitidas.has(v)) v = (NAV[rol] || NAV.publico)[0][0];
  if (['ingreso', 'carga', 'alertas', 'dash', 'catalogo', 'comercios', 'usuarios', 'auditoria'].includes(v) && !S.user) { v = 'login'; }
  pintarCabecera();
  put(main, h('p', { class: 'm', role: 'status' }, 'Cargando…'));
  S.after = null;
  try { put(main, await VIEWS[v](param)); } catch (e) { put(main, msg('err', e.message)); }
  if (S.after) { const f = S.after; S.after = null; f(); }
  document.title = 'Observatorio de Precios · PAC';
  main.focus({ preventScroll: true });
}
window.addEventListener('hashchange', render);
render();
